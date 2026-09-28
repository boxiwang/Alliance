// Alliance realtime backend: one Durable Object ("world room") that holds the
// shared player registry (cities on the star map) and a live chat channel.
// Free-tier friendly: hibernatable WebSockets, event-driven, bounded storage.
// Personal economy/city is progressively mirrored to D1; public presence + chat
// stay in a hibernatable Durable Object for low-latency coordination.

import { verifySession } from "./auth";
import { handlePlayerApi, sharedClaims, sharedCommandRoute, sharedCutover, sharedSyncRoute, type BackendEnv, type SharedWorldPort } from "./player-api";
import { defaultN } from "../src/lib/numbers";
import {
  advanceSharedWorld, applySharedCommand, createSharedWorld, joinSharedWorld, nextSharedEventAt, openQuadrants, openSharedQuadrant,
  clusterTargets, playerSlice, rebalanceSharedEcology, rebuildSharedWorld, searchShared, setSharedHome, sharedClusters, sharedHasPlayer, sharedView,
  type SearchKind, type SharedWorldState,
} from "../src/lib/shared-world";
import type { WorldAuthoritySession } from "../src/lib/world-authority";
import type { WorldEntity } from "../src/lib/world-engine";
import { STORE_PREFIX, assembleShared, chunkDelta, clustersFromChunk, sectorKeysForRect, sharedChunks, targetsFromSectorChunks } from "../src/lib/shared-store";
import { DORMANT_MAX_CORE, QUADRANT_CAPACITY, assignOuterRingCoord, clampViewRect, dormantCandidates, quadrantOfCoord, spawnQuadrant, type ViewRect, type WorldCoord } from "./world-coords";
import { projectGameJson } from "./economy";
import { capacity } from "../src/lib/game";

export interface Env extends BackendEnv {
  WORLD_ROOM: DurableObjectNamespace;
}

const ALLOWED_ORIGINS = [
  "https://alliance-7q2.pages.dev",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:5174",
  "http://127.0.0.1:5174",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
];

function originAllowed(origin: string | null): boolean {
  if (!origin) return false;
  try {
    const url = new URL(origin);
    return ALLOWED_ORIGINS.includes(origin) || (url.protocol === "https:" && url.hostname.endsWith(".alliance-7q2.pages.dev"));
  } catch {
    return false;
  }
}

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = originAllowed(origin) ? origin! : ALLOWED_ORIGINS[0];
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    "access-control-allow-headers": "authorization,content-type",
  };
}

function addCors(response: Response, origin: string | null): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders(origin))) headers.set(key, value);
  headers.set("vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin");
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
    if (url.pathname === "/health") return new Response("ok", { headers: corsHeaders(origin) });
    if (url.pathname === "/ws") {
      if (!originAllowed(origin)) return new Response("origin not allowed", { status: 403 });
      if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      const claims = await verifySession(env.AUTH_SECRET, url.searchParams.get("token") || "");
      if (!claims) return new Response("unauthorized", { status: 401 });
      const player = await env.DB.prepare("SELECT display_name, status FROM players WHERE id = ?").bind(claims.sub)
        .first<{ display_name: string; status: string }>();
      if (!player || player.status !== "active") return new Response("account unavailable", { status: 403 });
      const id = env.WORLD_ROOM.idFromName("frontier-1"); // single shared world for the beta
      const headers = new Headers(req.headers);
      headers.set("x-alliance-player", claims.sub);
      headers.set("x-alliance-name", player.display_name);
      headers.set("x-alliance-session", claims.sid);
      return env.WORLD_ROOM.get(id).fetch(new Request(req, { headers }));
    }
    const api = await handlePlayerApi(req, env);
    if (api) return addCors(api, origin);
    return new Response("Alliance realtime", { status: 200, headers: corsHeaders(origin) });
  },
};

const MAX_CHAT = 80;         // stored chat history (ring, per channel/thread)
const RETAIN_MS = 7 * 24 * 60 * 60 * 1000; // drop chat older than a week (save storage)
const COORD_VERSION = 3; // 3 = map 2048 (docs/MAP-2048.md); older coordinates are reassigned

type PlayerRow = {
  id: string; name: string; coords: { x: number; y: number };
  might: number; keepLevel: number; faction: string | null;
  cosmetics: unknown; online: boolean; lastSeen: number; coordVersion?: number;
  avatar?: string | null;
};
type ChatRow = { id: string; pid: string; name: string; text: string; ts: number; faction: string | null; to?: string; intel?: unknown; signal?: string | null };

// Server-authoritative per-player combat/intel reports (scouted / incoming /
// battle). Delivered on join (offline players see them on return) and live.
type ServerReport = { id: string; kind: "scouted" | "incoming" | "battle" | "relocated"; ts: number; by?: string; byName?: string; payload?: Record<string, unknown> };

// Returning dormant players respawn on a random outer-ring slot (see dormantCandidates).
const DORMANT_SWEEP_EVERY_MS = 60 * 60 * 1000;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// Server-tracked attack march (Phase 2: telegraph — visible to both sides with an
// ETA; the defender is warned. Battle resolution/economy changes are Phase 3.)
type MarchRow = {
  id: string; attacker: string; attackerName: string; defender: string; defenderName: string;
  from: WorldCoord; to: WorldCoord; departAt: number; arriveAt: number; armyTotal: number;
};
const MARCH_SPEED = 8;        // world units per second
const MARCH_MIN_MS = 20_000;  // floor so even neighbours take a moment

function armyTotalOf(gameJson: string | null | undefined): number {
  const game: any = projectGameJson(gameJson, Date.now());
  if (!game) return 0;
  let total = 0;
  for (const arm of ["army", "navy", "air"]) {
    const tiers = game?.troops?.[arm];
    if (tiers && typeof tiers === "object") for (const n of Object.values(tiers)) total += num(n);
  }
  return total;
}

// Build a scout intel snapshot from a target's mirrored game state + presence.
// Estimates (recon is not exact): troop totals per arm, resources, wall, shield.
function buildScoutSnapshot(player: PlayerRow, gameJson: string | null | undefined): Record<string, unknown> {
  // Project the mirrored state to now with the shared engine, so recon reflects
  // current resources + any training/builds that have since completed.
  const game: any = projectGameJson(gameJson, Date.now());
  const armTotal = (arm: string): number => {
    const tiers = game?.troops?.[arm];
    return tiers && typeof tiers === "object" ? Object.values(tiers).reduce((s: number, n) => s + num(n), 0) : 0;
  };
  const res = game?.res || {};
  const safe = game ? capacity(game) : 0;
  const keepLevel = num(game?.buildings?.keep?.lvl) || player.keepLevel || 1;
  return {
    keepLevel,
    might: player.might || 0,
    faction: player.faction || null,
    troops: { army: armTotal("army"), navy: armTotal("navy"), air: armTotal("air") },
    wounded: num(game?.wounded),
    resources: {
      cash: Math.max(0, num(res.cash) - safe),
      oil: Math.max(0, num(res.oil) - safe),
      power: Math.max(0, num(res.power) - safe),
    },
    safePerResource: safe,
    wallLevel: num(game?.buildings?.wall?.lvl),
    // v1 shield estimate: cities under Keep 10 are protected (attack-drops-it is a
    // later refinement). Presence has no PvP-active flag yet.
    shielded: keepLevel < 10,
  };
}

// A player's equipped chat name-signature, so everyone (not just the sender)
// sees the effect in chat. Read from the sanitized cosmetics on the player row.
function chatSignalOf(player?: PlayerRow): string | null {
  const cos = player?.cosmetics as { chatSignal?: string } | null | undefined;
  return cos && typeof cos.chatSignal === "string" ? cos.chatSignal : null;
}
type SocketAttachment = { pid: string; name: string; sessionId: string; windowStart: number; messageCount: number; view?: ViewRect; viewAt?: number };

// Location privacy (docs/BETA-P0.md P0-4): other players' coordinates are only sent
// for cities inside the viewer's current map view, never as a full roster.
type PublicPlayerRow = Omit<PlayerRow, "coords"> & { coords: WorldCoord | null };
const VIEW_MIN_INTERVAL_MS = 250;
const VIEW_MAX_CITIES = 600;
const VIEW_TARGET_BUDGET = 400; // above this a view gets clusters instead of planets
const publicPlayer = (player: PlayerRow): PublicPlayerRow => ({ ...player, coords: null });
const inView = (rect: ViewRect | undefined, coord: WorldCoord | null | undefined): boolean =>
  !!rect && !!coord && coord.x >= rect.x0 && coord.x <= rect.x1 && coord.y >= rect.y0 && coord.y <= rect.y1;


function prune(arr: ChatRow[]): ChatRow[] {
  const cut = Date.now() - RETAIN_MS;
  const out = arr.filter((m) => m.ts >= cut);
  while (out.length > MAX_CHAT) out.shift();
  return out;
}
const dmKey = (a: string, b: string) => [a, b].sort().join("|");

// Accept a relayed intel payload only when it is a small, shaped object — never
// trust arbitrary client JSON into stored/broadcast chat.
function sanitizeIntel(value: unknown): unknown | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  // Commander card: identity only, never a location (location-privacy rule).
  if (v.kind === "commander") {
    if (typeof v.playerId !== "string" || typeof v.name !== "string" || v.playerId.length > 64 || v.name.length > 48) return null;
    const faction = typeof v.faction === "string" ? v.faction.replace(/[^a-z0-9_$.-]/gi, "").slice(0, 24) : null;
    const avatar = typeof v.avatar === "string" && /^[a-z0-9-]{1,24}$/.test(v.avatar) ? v.avatar : null;
    return { kind: "commander", id: String(v.id || "").slice(0, 120), playerId: v.playerId, name: v.name, faction: faction || null,
      coreLevel: Math.max(1, Math.min(30, Math.floor(Number(v.coreLevel) || 1))), avatar, createdAt: Number(v.createdAt) || Date.now() };
  }
  const pos = v.position as { x?: unknown; y?: unknown } | undefined;
  if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return null;
  if (v.kind !== "coordinate" && v.kind !== "scout-intel") return null;
  let json: string;
  try { json = JSON.stringify(v); } catch { return null; }
  if (json.length > 2000) return null;
  return JSON.parse(json);
}

function sanitizeCosmetics(value: unknown): unknown | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const allowed = ["planetBody", "marchSignature", "strikeSignature", "chatSignal", "halo", "surface", "orbit", "glyph", "trail", "title", "cursor"];
  const input = value as Record<string, unknown>;
  const output: Record<string, string | null> = {};
  for (const key of allowed) {
    const item = input[key];
    if (item === null) output[key] = null;
    else if (typeof item === "string" && item.length <= 48 && /^[a-z0-9-]*$/i.test(item)) output[key] = item;
  }
  return output;
}

function finiteInteger(value: unknown, min: number, max: number): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.floor(number))) : null;
}

const LEGACY_CHUNK_KEY = "sw:count"; // pre-chunked-store format (one JSON split in pieces)
const WARP_SPACING = 6;

export class WorldRoom {
  state: DurableObjectState;
  env: Env;
  // The one shared engine world (docs/SHARED-ECOLOGY.md), cached in memory.
  shared?: SharedWorldState;
  // Serializes shared-world work: D1 awaits would otherwise let requests interleave.
  chain: Promise<unknown> = Promise.resolve();
  constructor(state: DurableObjectState, env: Env) { this.state = state; this.env = env; }

  locked<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  // What storage holds right now (chunk key → JSON), so a save writes only the changes.
  savedChunks = new Map<string, string>();

  loading: Promise<SharedWorldState> | null = null;

  async loadShared(): Promise<SharedWorldState> {
    if (this.shared) return this.shared;
    if (!this.loading) this.loading = this.readShared().finally(() => { this.loading = null; });
    return this.loading;
  }

  private async readShared(): Promise<SharedWorldState> {
    const stored = await this.state.storage.list<string>({ prefix: STORE_PREFIX });
    const chunks = new Map<string, string>();
    for (const [key, value] of stored) if (typeof value === "string") chunks.set(key, value);
    this.savedChunks = chunks;
    let loaded = assembleShared(chunks);
    if (!loaded) {
      // Older single-blob save (sw:*): read it once, then move to the chunked store.
      const count = (await this.state.storage.get<number>(LEGACY_CHUNK_KEY)) || 0;
      if (count > 0) {
        const keys = Array.from({ length: count }, (_, index) => `sw:${index}`);
        const parts = await this.state.storage.get<string>(keys);
        try { loaded = JSON.parse(keys.map((key) => parts.get(key) || "").join("")) as SharedWorldState; } catch { loaded = null; }
        if (loaded) {
          await this.saveShared(loaded);
          await this.state.storage.delete([LEGACY_CHUNK_KEY, ...keys]);
        }
      }
    }
    if (!loaded) { await this.saveShared(createSharedWorld(Date.now(), defaultN())); return this.shared!; }
    if (loaded.world.config.width !== Number(defaultN().world?.state?.width)) loaded = await this.migrateMapSize(loaded);
    // numbers.json density changes (e.g. fewer planets) apply to the live world on load.
    if (rebalanceSharedEcology(loaded, Date.now(), defaultN())) await this.saveShared(loaded);
    this.shared = loaded;
    return loaded;
  }

  /**
   * One-time move of the shared world to the configured map size (docs/MAP-2048.md):
   * every player on the roster gets a new outer-ring home by the quadrant rule, fleets
   * come home, targets regenerate. Old coordinates and telegraph marches are dropped.
   */
  async migrateMapSize(old: SharedWorldState): Promise<SharedWorldState> {
    const now = Date.now();
    const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
    const ids = new Set([...Object.keys(players).filter((id) => players[id].coords), ...Object.keys(old.world.players)]);
    const homes: Record<string, WorldCoord> = {};
    const taken: WorldCoord[] = [];
    const counts = [0, 0, 0, 0];
    const open = [0];
    for (const id of ids) {
      const pick = spawnQuadrant(counts, open);
      if (pick.opens !== null) open.push(pick.opens);
      const coord = assignOuterRingCoord(taken, Math.random, pick.quadrant);
      taken.push(coord); counts[quadrantOfCoord(coord)] += 1; homes[id] = coord;
      await this.state.storage.put(`coord:v${COORD_VERSION}:${id}`, coord);
      if (players[id]) { players[id].coords = coord; players[id].coordVersion = COORD_VERSION; }
    }
    await this.state.storage.put("players", players);
    await this.state.storage.put("marches", []);
    const rebuilt = rebuildSharedWorld(old, homes, now, defaultN());
    await this.saveShared(rebuilt);
    return rebuilt;
  }

  /**
   * A new home on the outer ring of the active quadrant; opens the next quadrant (and fills
   * its ecology) when the active one is full. `inLock` = already inside the world lock.
   */
  async assignSpawn(players: Record<string, PlayerRow>, exclude: string, inLock: boolean): Promise<WorldCoord> {
    const placed = Object.values(players).filter((player) => player.id !== exclude && player.coordVersion === COORD_VERSION && player.coords);
    const counts = [0, 0, 0, 0];
    for (const player of placed) counts[quadrantOfCoord(player.coords)] += 1;
    const shared = await this.loadShared();
    const pick = spawnQuadrant(counts, openQuadrants(shared));
    if (pick.opens !== null) {
      const open = async () => { const current = await this.loadShared(); await this.saveShared(openSharedQuadrant(current, pick.opens!, Date.now(), defaultN())); };
      if (inLock) await open(); else await this.locked(open);
      await this.sendQuadrants(null, players);
    }
    return assignOuterRingCoord(placed.map((player) => player.coords), Math.random, pick.quadrant);
  }

  /** True once any shared world exists in storage (new or legacy format). */
  async hasShared(): Promise<boolean> {
    if (this.shared) return true;
    if ((await this.state.storage.list({ prefix: `${STORE_PREFIX}meta`, limit: 1 })).size) return true;
    return !!(await this.state.storage.get<number>(LEGACY_CHUNK_KEY));
  }

  // Writes only the chunks whose content changed, atomically.
  async saveShared(next: SharedWorldState) {
    const chunks = sharedChunks(next);
    const { put, remove } = chunkDelta(this.savedChunks, chunks);
    if (put.size || remove.length) {
      await this.state.storage.transaction(async (txn) => {
        const entries = [...put];
        for (let index = 0; index < entries.length; index += 128) await txn.put(Object.fromEntries(entries.slice(index, index + 128)));
        for (let index = 0; index < remove.length; index += 128) await txn.delete(remove.slice(index, index + 128));
      });
    }
    this.savedChunks = chunks;
    this.shared = next;
  }

  /** Drop uncommitted in-place changes: the next read reloads the last saved world. */
  forgetShared() { this.shared = undefined; }

  sessionSlice(state: SharedWorldState, playerId: string): WorldAuthoritySession {
    // version 7 = the client LocalWorldSession version, so it never re-runs private-world migrations on a slice.
    return { version: 7, address: playerId, playerId, world: playerSlice(state, playerId)!, syncedGame: state.synced[playerId], createdAt: 0, migratedLegacyAt: 0 };
  }

  async coordFor(playerId: string): Promise<WorldCoord> {
    const key = `coord:v${COORD_VERSION}:${playerId}`;
    const existing = await this.state.storage.get<WorldCoord>(key);
    if (existing) return existing;
    const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
    const coord = await this.assignSpawn(players, playerId, true);
    await this.state.storage.put(key, coord);
    return coord;
  }

  async moveCoord(playerId: string, coord: WorldCoord) {
    await this.state.storage.put(`coord:v${COORD_VERSION}:${playerId}`, coord);
    const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
    if (players[playerId]) {
      players[playerId].coords = coord;
      await this.state.storage.put("players", players);
      this.sendPlayerUpdate(players[playerId]);
    }
  }

  // A pending view of the shared world for one D1 transaction (see SharedWorldPort).
  async makePort(): Promise<SharedWorldPort> {
    const numbers = defaultN();
    const telegraph = (await this.state.storage.get<MarchRow[]>("marches")) || [];
    const roster = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
    let pending: SharedWorldState | null = null;
    let warpTo: { playerId: string; coord: WorldCoord } | null = null;
    let done = false;
    const base = () => pending ?? this.shared!;
    return {
      has: (playerId) => sharedHasPlayer(base(), playerId),
      join: async (playerId, game, carry, now) => {
        const coord = await this.coordFor(playerId);
        pending = joinSharedWorld(base(), { playerId, coord, game, carry, now, numbers });
      },
      apply: (playerId, game, command, now) => {
        const fail = (reason: string) => ({ game, ok: false, reason, session: this.sessionSlice(base(), playerId) });
        if (command.type === "world.warp") {
          const live = telegraph.filter((march) => march.arriveAt > now);
          if (live.some((march) => march.defender === playerId)) return fail("under_attack");
          if (live.some((march) => march.attacker === playerId)) return fail("fleets_away");
        }
        const result = applySharedCommand(base(), playerId, game, command, now, numbers);
        if (command.type === "world.warp" && result.ok && result.position) {
          // Cities not yet in the shared world still hold their roster slot.
          const target = result.position;
          const clash = Object.values(roster).some((player) => player.id !== playerId && player.coords && !result.state.world.players[player.id]
            && Math.hypot(player.coords.x - target.x, player.coords.y - target.y) < WARP_SPACING);
          if (clash) return fail("too_close_city");
          warpTo = { playerId, coord: target };
        }
        pending = result.state;
        return {
          game: result.game, ok: result.ok, reason: result.reason, position: result.position, targetId: result.targetId, spawned: result.spawned,
          session: this.sessionSlice(result.state, playerId),
        };
      },
      commit: async () => {
        if (done) return;
        done = true;
        if (pending) await this.saveShared(pending);
        if (warpTo) await this.moveCoord(warpTo.playerId, warpTo.coord);
        await this.scheduleAlarm();
      },
      discard: () => {
        if (done) return;
        done = true; warpTo = null;
        // The shared world is mutated in place: forget it so the last committed copy reloads.
        if (pending) this.forgetShared();
        pending = null;
      },
    };
  }

  // /world/command and /world/sync: cutover once, then run through the D1 pipeline.
  async worldRoute(req: Request, kind: "command" | "sync"): Promise<Response> {
    const claims = await sharedClaims(req, this.env);
    if (!claims) return Response.json({ error: "unauthorized" }, { status: 401 });
    return this.locked(async () => {
      await this.loadShared();
      const cut = await sharedCutover(this.env, claims.sub, await this.makePort());
      if (cut) return cut;
      return kind === "command"
        ? sharedCommandRoute(req, this.env, claims, await this.makePort())
        : sharedSyncRoute(this.env, claims, await this.makePort());
    });
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/coordinate") {
      const pid = (url.searchParams.get("player") || "").slice(0, 64);
      if (!pid) return Response.json({ coord: null }, { status: 400 });
      const coord = await this.state.storage.get<WorldCoord>(`coord:v${COORD_VERSION}:${pid}`);
      return Response.json({ coord: coord || null });
    }
    if (url.pathname === "/relocate" && req.method === "POST") return this.relocate(req);
    if (url.pathname === "/world/command" && req.method === "POST") return this.worldRoute(req, "command");
    if (url.pathname === "/world/sync") return this.worldRoute(req, "sync");
    if (url.pathname === "/roster") return this.roster();
    if (url.pathname === "/release" && req.method === "POST") return this.release(req);
    const pid = (req.headers.get("x-alliance-player") || "").slice(0, 64);
    const name = (req.headers.get("x-alliance-name") || "Commander").slice(0, 24);
    const sessionId = (req.headers.get("x-alliance-session") || "").slice(0, 64);
    if (!pid || !sessionId) return new Response("unauthorized", { status: 401 });
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.state.acceptWebSocket(server, [pid]);
    server.serializeAttachment({ pid, name, sessionId, windowStart: Date.now(), messageCount: 0 } satisfies SocketAttachment);
    await this.onJoin(server, pid, name);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Warp: reserve a new shared coordinate for `player` (internal only — the
  // public entry forwards just /ws). Rejects a spot inside another commander's
  // spacing and any warp while a real-player march involves this commander.
  // `revert` restores a prior coordinate when the D1 commit loses a race.
  async relocate(req: Request): Promise<Response> {
    let body: { player?: string; x?: number; y?: number; minSpacing?: number; revert?: boolean } = {};
    try { body = await req.json(); } catch {}
    const pid = String(body.player || "").slice(0, 64);
    const x = Number(body.x), y = Number(body.y);
    if (!pid || !Number.isFinite(x) || !Number.isFinite(y)) return Response.json({ ok: false, error: "invalid" }, { status: 400 });
    const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
    const coordKey = `coord:v${COORD_VERSION}:${pid}`;
    const previous = (await this.state.storage.get<WorldCoord>(coordKey)) || null;
    if (!body.revert) {
      const now = Date.now();
      const marches = (await this.state.storage.get<MarchRow[]>("marches")) || [];
      const live = marches.filter((march) => march.arriveAt > now);
      if (live.some((march) => march.defender === pid)) return Response.json({ ok: false, error: "under_attack" }, { status: 409 });
      if (live.some((march) => march.attacker === pid)) return Response.json({ ok: false, error: "fleets_away" }, { status: 409 });
      const spacing = Math.max(1, Number(body.minSpacing) || 6);
      const clash = Object.values(players).some((player) => player.id !== pid && player.coordVersion === COORD_VERSION && player.coords
        && Math.hypot(player.coords.x - x, player.coords.y - y) < spacing);
      if (clash) return Response.json({ ok: false, error: "too_close_city" }, { status: 409 });
    }
    const coord = { x, y };
    await this.state.storage.put(coordKey, coord);
    if (players[pid]) {
      players[pid].coords = coord;
      await this.state.storage.put("players", players);
      this.sendPlayerUpdate(players[pid]);
    }
    return Response.json({ ok: true, coord, previous });
  }

  // GM ops (internal only, reached through the GM-gated /gm/world/* API).
  async roster(): Promise<Response> {
    const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
    const live = this.liveIds();
    const rows = Object.values(players).map((player) => ({
      id: player.id, name: player.name, keepLevel: player.keepLevel, lastSeen: player.lastSeen, online: live.has(player.id),
    }));
    return Response.json({ players: rows });
  }

  // Release map slots (ghost/test players). The D1 account is untouched; a released
  // player respawns on a random outer-ring slot with a welcome-back notice.
  async release(req: Request): Promise<Response> {
    let body: { ids?: unknown } = {};
    try { body = await req.json(); } catch {}
    const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id).slice(0, 64)).slice(0, 500) : [];
    const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
    const live = this.liveIds();
    const released = ids.filter((id) => players[id] && !live.has(id));
    for (const id of released) {
      delete players[id];
      await this.state.storage.delete(`coord:v${COORD_VERSION}:${id}`);
      await this.state.storage.put(`dormant:${id}`, Date.now());
    }
    if (released.length) await this.state.storage.put("players", players);
    for (const id of released) this.broadcast({ type: "player_removed", id });
    return Response.json({ released, skippedOnline: ids.filter((id) => live.has(id)) });
  }

  // The authoritative "who's online" set is the currently-open sockets, not a
  // stored flag — a socket that dies without a clean close (tab crash, network
  // drop, hibernation) would otherwise leave a ghost marked online forever.
  liveIds(): Set<string> {
    const ids = new Set<string>();
    for (const ws of this.state.getWebSockets()) {
      const a = ((ws.deserializeAttachment() || {}) as Partial<SocketAttachment>).pid;
      if (a) ids.add(a);
    }
    return ids;
  }

  // Sync every player's `online` flag to the live socket set. Returns the ids
  // whose state flipped so callers can broadcast just those.
  reconcileOnline(players: Record<string, PlayerRow>): string[] {
    const live = this.liveIds();
    const changed: string[] = [];
    for (const p of Object.values(players)) {
      const on = live.has(p.id);
      if (p.online !== on) { p.online = on; changed.push(p.id); }
    }
    return changed;
  }

  // Release the map slots of small, long-inactive cities (at most once an hour).
  // Presence keepLevel is client-reported, so D1 confirms the Core level first.
  async retireDormant(players: Record<string, PlayerRow>, now: number): Promise<string[]> {
    const last = (await this.state.storage.get<number>("dormancySweepAt")) || 0;
    if (now - last < DORMANT_SWEEP_EVERY_MS) return [];
    await this.state.storage.put("dormancySweepAt", now);
    const candidates = dormantCandidates(Object.values(players), this.liveIds(), now);
    const retired: string[] = [];
    for (const player of candidates) {
      const row = await this.env.DB.prepare("SELECT game_json FROM player_state WHERE player_id = ?").bind(player.id).first<{ game_json: string | null }>();
      const game: any = projectGameJson(row?.game_json, now);
      if (num(game?.buildings?.keep?.lvl) > DORMANT_MAX_CORE) continue;
      delete players[player.id];
      await this.state.storage.delete(`coord:v${COORD_VERSION}:${player.id}`);
      await this.state.storage.put(`dormant:${player.id}`, now);
      retired.push(player.id);
    }
    return retired;
  }

  async onJoin(ws: WebSocket, pid: string, name: string) {
    // A pending map-size migration rewrites the roster: let it finish before reading it.
    if (await this.hasShared()) await this.locked(() => this.loadShared());
    const players = ((await this.state.storage.get<Record<string, PlayerRow>>("players")) || {});
    const retired = await this.retireDormant(players, Date.now());
    const coordKey = `coord:v${COORD_VERSION}:${pid}`;
    let coord = await this.state.storage.get<WorldCoord>(coordKey);
    const returning = await this.state.storage.get<number>(`dormant:${pid}`);
    if (returning) await this.state.storage.delete(`dormant:${pid}`);
    if (!coord) {
      coord = await this.assignSpawn(players, pid, false);
      await this.state.storage.put(coordKey, coord);
    }
    if (!players[pid]) {
      players[pid] = { id: pid, name, coords: coord, might: 0, keepLevel: 1, faction: null, cosmetics: null, online: true, lastSeen: Date.now(), coordVersion: COORD_VERSION };
    } else {
      players[pid].name = name; players[pid].coords = coord; players[pid].coordVersion = COORD_VERSION; players[pid].lastSeen = Date.now();
    }
    const home = coord;
    await this.locked(async () => {
      if (!(await this.hasShared())) return;
      const shared = await this.loadShared();
      if (!sharedHasPlayer(shared, pid)) return;
      const moved = setSharedHome(shared, pid, home);
      if (moved !== shared) await this.saveShared(moved);
    });
    // This socket is already accepted, so liveIds() includes it; this both marks
    // the joiner online and clears any stale ghosts from earlier dead sockets.
    const flipped = this.reconcileOnline(players);
    await this.state.storage.put("players", players);
    const storedChat = prune((await this.state.storage.get<ChatRow[]>("chat:cosmos")) || []);
    const chat = storedChat.map((message) => message.name === "Commander" && players[message.pid]?.name
      ? { ...message, name: players[message.pid].name }
      : message);
    if (chat.some((message, index) => message.name !== storedChat[index]?.name)) await this.state.storage.put("chat:cosmos", chat);
    // Only this player's DM threads, pruned to the retention window.
    const dmsAll = (await this.state.storage.get<Record<string, ChatRow[]>>("dms")) || {};
    const dms: Record<string, ChatRow[]> = {};
    for (const [k, arr] of Object.entries(dmsAll)) {
      if (k.split("|").includes(pid)) {
        const p = prune(arr).map((message) => message.name === "Commander" && players[message.pid]?.name
          ? { ...message, name: players[message.pid].name }
          : message);
        if (p.length) dms[k] = p;
      }
    }
    if (returning) {
      await this.pushReport(pid, { id: crypto.randomUUID(), kind: "relocated", ts: Date.now(), payload: {
        summary: `Welcome back. Your city was moved to a new outer-ring sector while you were away. Progress is intact.`,
      } });
    }
    const reports = (await this.state.storage.get<ServerReport[]>(`reports:${pid}`)) || [];
    const allMarches = (await this.state.storage.get<MarchRow[]>("marches")) || [];
    const marches = allMarches.filter((m) => m.arriveAt > Date.now() && (m.attacker === pid || m.defender === pid));
    const roster = Object.values(players).map((player) => player.id === pid ? player : publicPlayer(player));
    ws.send(JSON.stringify({ type: "snapshot", you: pid, players: roster, chat, dms, reports, marches }));
    await this.sendQuadrants(ws, players);
    this.sendPlayerUpdate(players[pid], ws);
    // Tell everyone about any ghosts we just cleared (or others revived).
    for (const id of flipped) if (id !== pid) this.sendPlayerUpdate(players[id]);
    for (const id of retired) this.broadcast({ type: "player_removed", id });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const rawLength = typeof message === "string" ? message.length : message.byteLength;
    if (rawLength > 12_000) { ws.close(1009, "message too large"); return; }
    let data: any;
    try { data = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)); } catch { return; }
    const att = (ws.deserializeAttachment() || {}) as Partial<SocketAttachment>;
    const pid = att.pid;
    if (!pid) return;
    const now = Date.now();
    // Map view queries are throttled on their own and do not count against chat.
    if (data?.type === "view") { await this.handleView(ws, att as SocketAttachment, data.rect, now, !!data.strategic); return; }
    if (!att.windowStart || now - att.windowStart >= 10_000) { att.windowStart = now; att.messageCount = 0; }
    att.messageCount = (att.messageCount || 0) + 1;
    ws.serializeAttachment(att);
    if (att.messageCount > 25) { ws.close(1008, "rate limit"); return; }

    if (data.type === "search") { await this.handleSearch(ws, pid, data); return; }
    if (data.type === "chat") {
      const text = String(data.text || "").slice(0, 500).trim();
      if (!text) return;
      const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
      // A relayed coordinate/recon rides along as a small JSON payload so the
      // message renders as a clickable star-map card, not just a text line.
      const intel = sanitizeIntel(data.intel);
      const msg: ChatRow = { id: crypto.randomUUID(), pid, name: players[pid]?.name || att.name || "Commander", text, ts: Date.now(), faction: players[pid]?.faction || null, signal: chatSignalOf(players[pid]), ...(intel ? { intel } : {}) };
      const chat = (await this.state.storage.get<ChatRow[]>("chat:cosmos")) || [];
      chat.push(msg);
      await this.state.storage.put("chat:cosmos", prune(chat));
      this.broadcast({ type: "chat", msg });
    } else if (data.type === "dm") {
      const to = String(data.to || "").slice(0, 64);
      const text = String(data.text || "").slice(0, 500).trim();
      if (!to || !text || to === pid) return;
      const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
      const key = dmKey(pid, to);
      const dmsAll = (await this.state.storage.get<Record<string, ChatRow[]>>("dms")) || {};
      const arr = dmsAll[key] || [];
      const msg: ChatRow = { id: crypto.randomUUID(), pid, to, name: players[pid]?.name || att.name || "Commander", text, ts: Date.now(), faction: players[pid]?.faction || null, signal: chatSignalOf(players[pid]) };
      arr.push(msg);
      dmsAll[key] = prune(arr);
      await this.state.storage.put("dms", dmsAll);
      const payload = JSON.stringify({ type: "dm", key, msg });
      for (const sock of this.state.getWebSockets()) {
        const a = ((sock.deserializeAttachment() || {}) as Partial<SocketAttachment>).pid;
        if (a === pid || a === to) { try { sock.send(payload); } catch {} }
      }
    } else if (data.type === "scout") {
      const to = String(data.to || "").slice(0, 64);
      if (!to || to === pid) return;
      const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
      if (!players[to]) return; // unknown target
      const row = await this.env.DB.prepare("SELECT game_json FROM player_state WHERE player_id = ?").bind(to).first<{ game_json: string | null }>();
      const snapshot = buildScoutSnapshot(players[to], row?.game_json);
      this.sendToPlayer(pid, { type: "scout_result", target: to, name: players[to].name, snapshot });
      // Alert the target they were scouted (persisted → seen even if offline now).
      await this.pushReport(to, { id: crypto.randomUUID(), kind: "scouted", ts: Date.now(), by: pid, byName: players[pid]?.name || "A commander" });
    } else if (data.type === "march") {
      const to = String(data.to || "").slice(0, 64);
      if (!to || to === pid) return;
      const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
      const attacker = players[pid], defender = players[to];
      if (!attacker || !defender || !attacker.coords || !defender.coords) return;
      // v1 gate: no attacking a shielded city (Keep < 10 estimate). Same-alliance
      // blocking arrives with the alliance system.
      const defRow = await this.env.DB.prepare("SELECT game_json FROM player_state WHERE player_id = ?").bind(to).first<{ game_json: string | null }>();
      const defSnap = buildScoutSnapshot(defender, defRow?.game_json);
      if (defSnap.shielded) { this.sendToPlayer(pid, { type: "march_rejected", reason: "shielded" }); return; }
      const atkRow = await this.env.DB.prepare("SELECT game_json FROM player_state WHERE player_id = ?").bind(pid).first<{ game_json: string | null }>();
      const armyTotal = armyTotalOf(atkRow?.game_json);
      if (armyTotal <= 0) { this.sendToPlayer(pid, { type: "march_rejected", reason: "no_troops" }); return; }
      const dist = Math.hypot(defender.coords.x - attacker.coords.x, defender.coords.y - attacker.coords.y);
      const departAt = Date.now();
      const arriveAt = departAt + Math.max(MARCH_MIN_MS, Math.round(dist / MARCH_SPEED * 1000));
      const march: MarchRow = {
        id: crypto.randomUUID(), attacker: pid, attackerName: attacker.name, defender: to, defenderName: defender.name,
        from: attacker.coords, to: defender.coords, departAt, arriveAt, armyTotal,
      };
      const marches = (await this.state.storage.get<MarchRow[]>("marches")) || [];
      marches.push(march);
      await this.state.storage.put("marches", marches);
      // Warn the defender (System + live), tell the attacker it launched, show both the march.
      const etaSec = Math.round((arriveAt - departAt) / 1000);
      await this.pushReport(to, { id: crypto.randomUUID(), kind: "incoming", ts: departAt, by: pid, byName: attacker.name, payload: { arriveAt, etaSec, armyTotal, attackerCoords: attacker.coords } });
      this.sendToPlayer(pid, { type: "march", march });
      this.sendToPlayer(to, { type: "march", march });
      await this.scheduleAlarm();
    } else if (data.type === "presence") {
      const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
      const p = players[pid]; if (!p) return;
      const account = await this.env.DB.prepare("SELECT display_name FROM players WHERE id = ?").bind(pid).first<{ display_name: string }>();
      if (account?.display_name) p.name = account.display_name;
      const cosmetics = sanitizeCosmetics(data.cosmetics);
      if (cosmetics) p.cosmetics = cosmetics;
      if (typeof data.avatar === "string" && /^[a-z0-9-]{1,24}$/.test(data.avatar)) p.avatar = data.avatar;
      const might = finiteInteger(data.might, 0, 10_000_000_000);
      const keepLevel = finiteInteger(data.keepLevel, 1, 30);
      if (might !== null) p.might = might;
      if (keepLevel !== null) p.keepLevel = keepLevel;
      if (data.faction === null) p.faction = null;
      else if (typeof data.faction === "string") p.faction = data.faction.replace(/[^a-z0-9_$.-]/gi, "").slice(0, 24) || null;
      p.online = true; p.lastSeen = Date.now();
      await this.state.storage.put("players", players);
      this.sendPlayerUpdate(p);
    }
  }

  async webSocketClose(ws: WebSocket) {
    const att = (ws.deserializeAttachment() || {}) as Partial<SocketAttachment>;
    const pid = att.pid; if (!pid) return;
    // A player may hold several sockets (multiple tabs). Only mark offline once
    // no other open socket carries this pid — the closing socket may still be
    // present in getWebSockets(), so exclude it explicitly.
    let stillOnline = false;
    for (const sock of this.state.getWebSockets()) {
      if (sock === ws) continue;
      const a = ((sock.deserializeAttachment() || {}) as Partial<SocketAttachment>).pid;
      if (a === pid) { stillOnline = true; break; }
    }
    const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
    if (players[pid] && players[pid].online !== stillOnline) {
      players[pid].online = stillOnline; players[pid].lastSeen = Date.now();
      await this.state.storage.put("players", players);
      this.sendPlayerUpdate(players[pid]);
    }
  }

  async webSocketError(ws: WebSocket) { await this.webSocketClose(ws); }

  broadcast(obj: unknown, except?: WebSocket) {
    const s = JSON.stringify(obj);
    for (const ws of this.state.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(s); } catch {}
    }
  }

  // A viewer's map rect → the cities (with coordinates) inside it, capped.
  async handleView(ws: WebSocket, att: SocketAttachment, raw: unknown, now: number, strategic = false) {
    if (att.viewAt && now - att.viewAt < VIEW_MIN_INTERVAL_MS) return;
    att.viewAt = now;
    // Strategic zoom: only the public target aggregate (no players, no coordinates of cities).
    // A hibernated room answers from the precomputed chunk instead of loading the world.
    if (strategic) {
      ws.serializeAttachment(att);
      const clusters = this.shared ? sharedClusters(this.shared) : clustersFromChunk(await this.state.storage.get<string>(`${STORE_PREFIX}x:clusters`));
      try { ws.send(JSON.stringify({ type: "view_clusters", clusters })); } catch {}
      return;
    }
    const rect = clampViewRect(raw);
    if (!rect) return;
    att.view = rect;
    ws.serializeAttachment(att);
    const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
    const visible = Object.values(players)
      .filter((player) => player.id !== att.pid && player.coordVersion === COORD_VERSION && inView(rect, player.coords))
      .slice(0, VIEW_MAX_CITIES);
    // Shared world: public targets in view + which player's fleet occupies them (no march paths).
    // In memory: query it. Hibernated: read only the sector chunks under the rect (the room
    // is evicted between messages, and reloading the whole world cost ~50 ms per view).
    let view: { targets: WorldEntity[]; occupiers: Record<string, string> } | null = null;
    if (this.shared) view = sharedView(this.shared, rect);
    else {
      const parts = await this.state.storage.get<string>(sectorKeysForRect(rect));
      if (parts.size) view = { targets: targetsFromSectorChunks(parts.values(), rect), occupiers: {} };
    }
    // Dense Field views: the client draws clusters there anyway, so send the aggregate
    // (a few KB) instead of every planet (hundreds of KB and most of this message's CPU).
    const dense = !!view && view.targets.length > VIEW_TARGET_BUDGET;
    const cell = 2 ** Math.round(Math.log2(Math.max(16, (rect.x1 - rect.x0) / 10)));
    const payload = !view ? {} : dense ? { clusters: clusterTargets(view.targets, cell) } : { targets: view.targets, occupiers: view.occupiers };
    try { ws.send(JSON.stringify({ type: "view_players", rect, players: visible, ...payload })); } catch {}
  }

  // Map 2048: which quadrants are open and how full each is (drives the Dust labels).
  async sendQuadrants(ws: WebSocket | null, players?: Record<string, PlayerRow>) {
    if (!(await this.hasShared())) return;
    const shared = await this.loadShared();
    const roster = players ?? ((await this.state.storage.get<Record<string, PlayerRow>>("players")) || {});
    const counts = [0, 0, 0, 0];
    for (const player of Object.values(roster)) if (player.coordVersion === COORD_VERSION && player.coords) counts[quadrantOfCoord(player.coords)] += 1;
    const message = JSON.stringify({ type: "quadrants", open: openQuadrants(shared), counts, capacity: QUADRANT_CAPACITY });
    if (ws) { try { ws.send(message); } catch {} } else this.broadcastRaw(message);
  }

  broadcastRaw(message: string) {
    for (const socket of this.state.getWebSockets()) { try { socket.send(message); } catch {} }
  }

  // Nearest free target of a kind/level from the player's home (Star Map Search).
  async handleSearch(ws: WebSocket, pid: string, data: any) {
    const kind = String(data.kind || "") as SearchKind;
    if (!["monster", "cash", "oil", "power"].includes(kind)) return;
    const level = Math.max(1, Math.floor(Number(data.level) || 1));
    const index = Math.max(0, Math.floor(Number(data.index) || 0));
    const shared = (await this.hasShared()) ? await this.loadShared() : undefined;
    const found = shared ? searchShared(shared, pid, kind, level, index) : { target: null, total: 0 };
    try { ws.send(JSON.stringify({ type: "search_result", kind, level, index, total: found.total, target: found.target })); } catch {}
  }

  // Presence update: full row (with coordinates) only to the player themself and to
  // sockets whose current view contains the city; everyone else gets it without coords.
  sendPlayerUpdate(player: PlayerRow | undefined, except?: WebSocket) {
    if (!player) return;
    const full = JSON.stringify({ type: "player", player });
    const masked = JSON.stringify({ type: "player", player: publicPlayer(player) });
    for (const ws of this.state.getWebSockets()) {
      if (ws === except) continue;
      const a = (ws.deserializeAttachment() || {}) as Partial<SocketAttachment>;
      try { ws.send(a.pid === player.id || inView(a.view, player.coords) ? full : masked); } catch {}
    }
  }

  // Send to every open socket for one player (multi-tab safe). No-op if offline.
  sendToPlayer(pid: string, obj: unknown) {
    const s = JSON.stringify(obj);
    for (const ws of this.state.getWebSockets()) {
      const a = ((ws.deserializeAttachment() || {}) as Partial<SocketAttachment>).pid;
      if (a === pid) { try { ws.send(s); } catch {} }
    }
  }

  // Persist a report for a player (so an offline target sees it on return) and
  // deliver it live if they're connected. Pruned to the retention window + cap.
  async pushReport(pid: string, report: ServerReport) {
    const key = `reports:${pid}`;
    const list = (await this.state.storage.get<ServerReport[]>(key)) || [];
    list.push(report);
    const cut = Date.now() - RETAIN_MS;
    const pruned = list.filter((r) => r.ts >= cut).slice(-60);
    await this.state.storage.put(key, pruned);
    this.sendToPlayer(pid, { type: "report", report });
  }

  // Wake at the next telegraph arrival or shared-world event, whichever is first.
  async scheduleAlarm() {
    const marches = (await this.state.storage.get<MarchRow[]>("marches")) || [];
    const shared = this.shared ?? ((await this.hasShared()) ? await this.loadShared() : undefined);
    const next = Math.min(...marches.map((m) => m.arriveAt), shared ? nextSharedEventAt(shared) ?? Infinity : Infinity);
    if (!Number.isFinite(next)) return;
    const current = await this.state.storage.getAlarm();
    if (current === null || next < current || current < Date.now()) await this.state.storage.setAlarm(Math.max(next, Date.now() + 50));
  }

  // Fired when a march arrives. Phase 2: telegraph only — notify both sides that
  // the army reached the target; no economy change yet (battle math = Phase 3).
  async alarm() {
    const now = Date.now();
    const marches = (await this.state.storage.get<MarchRow[]>("marches")) || [];
    const due = marches.filter((m) => m.arriveAt <= now);
    const remaining = marches.filter((m) => m.arriveAt > now);
    for (const m of due) {
      await this.pushReport(m.defender, { id: crypto.randomUUID(), kind: "battle", ts: now, by: m.attacker, byName: m.attackerName, payload: { attackerCoords: m.from, summary: `${m.attackerName}'s army reached your city (${m.armyTotal.toLocaleString()} troops). Battle resolution arrives with the next build.` } });
      await this.pushReport(m.attacker, { id: crypto.randomUUID(), kind: "battle", ts: now, by: m.defender, byName: m.defenderName, payload: { summary: `Your army reached ${m.defenderName}. Battle resolution arrives with the next build; troops return home.` } });
      this.sendToPlayer(m.attacker, { type: "march_done", id: m.id });
      this.sendToPlayer(m.defender, { type: "march_done", id: m.id });
    }
    if (due.length) await this.state.storage.put("marches", remaining);
    // Shared world: resolve every due arrival, gather, return and respawn, owners online or not.
    await this.locked(async () => {
      if (!(await this.hasShared())) return;
      const shared = await this.loadShared();
      const nextEvent = nextSharedEventAt(shared);
      if (nextEvent !== null && nextEvent <= now) await this.saveShared(advanceSharedWorld(shared, now, defaultN()));
    });
    await this.scheduleAlarm();
  }
}
