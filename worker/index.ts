// Alliance realtime backend: one Durable Object ("world room") that holds the
// shared player registry (cities on the star map) and a live chat channel.
// Free-tier friendly: hibernatable WebSockets, event-driven, bounded storage.
// Personal economy/city is progressively mirrored to D1; public presence + chat
// stay in a hibernatable Durable Object for low-latency coordination.

import { bioLooksLikeLink } from "../src/lib/profile";
import { verifySession } from "./auth";
import { handlePlayerApi, purgeDueAccounts, sharedClaims, sharedCommandRoute, sharedCutover, sharedSyncRoute, type BackendEnv, type SharedWorldPort } from "./player-api";
import { defaultN } from "../src/lib/numbers";
import {
  advanceSharedWorld, applySharedCommand, createSharedWorld, joinSharedWorld, nextSharedEventAt, openQuadrants, openSharedQuadrant,
  clusterTargets, playerSlice, rebalanceSharedEcology, rebuildSharedWorld, searchShared, setSharedHome, sharedClusters, sharedHasPlayer, sharedView,
  type SearchKind, type SharedWorldState,
} from "../src/lib/shared-world";
import type { WorldAuthoritySession } from "../src/lib/world-authority";
import { energyAt, worldEngineConfig, type WorldEntity } from "../src/lib/world-engine";
import { shieldActive } from "../src/lib/shield";
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

/** Quantum Warp is locked from this long before a hostile attack lands until it is resolved. */
const QUANTUM_LOCK_MS = 5_000;
/** Senders at this Core level or above pass a recipient's new-commander DM filter. */
const DM_FILTER_MIN_CORE = 10;
/** A sigil id ("genesis") or an uploaded portrait version ("u1790000000000"). */
const AVATAR_TOKEN = /^(?:[a-z0-9-]{1,24}|u\d{10,14})$/;
/** Bio: plain text, one line, <= 80 chars. */
function cleanBio(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  // No links or wallet addresses: an introduction must not be a scam vector.
  return text && !bioLooksLikeLink(text) ? text : null;
}

const MAX_CHAT = 80;         // stored chat history (ring, per channel/thread)
const RETAIN_MS = 7 * 24 * 60 * 60 * 1000; // drop chat older than a week (save storage)
const COORD_VERSION = 3; // 3 = map 2048 (docs/MAP-2048.md); older coordinates are reassigned

type PlayerRow = {
  id: string; name: string; coords: { x: number; y: number };
  might: number; keepLevel: number; faction: string | null;
  cosmetics: unknown; online: boolean; lastSeen: number; coordVersion?: number;
  avatar?: string | null;
  /** Self-introduction shown on the commander card (<= 80 chars, plain text). */
  bio?: string | null;
  /** Game Settings · Privacy: only alliance members and Core 10+ commanders may start a DM. */
  dmFilter?: boolean;
  /** Shield item expiry (GM grant now; the weekly shield later). Public, like the dome. */
  shieldUntil?: number;
};
type ChatRow = { id: string; pid: string; name: string; text: string; ts: number; faction: string | null; to?: string; toName?: string; intel?: unknown; signal?: string | null };

// Server-authoritative per-player combat/intel reports (scouted / incoming /
// battle). Delivered on join (offline players see them on return) and live.
type ServerReport = { id: string; kind: "scouted" | "incoming" | "battle" | "relocated" | "recon"; ts: number; by?: string; byName?: string; payload?: Record<string, unknown> };

// Returning dormant players respawn on a random outer-ring slot (see dormantCandidates).
const DORMANT_SWEEP_EVERY_MS = 60 * 60 * 1000;

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// Server-tracked attack march (Phase 2: telegraph — visible to both sides with an
// ETA; the defender is warned. Battle resolution/economy changes are Phase 3.)
type MarchRow = {
  id: string; attacker: string; attackerName: string; defender: string; defenderName: string;
  from: WorldCoord; to: WorldCoord; departAt: number; arriveAt: number; armyTotal: number;
  /** "scout": a recon fleet — only the sender sees it; the target is alerted on arrival. */
  kind?: "scout";
  /** Oil paid for this scout (refunded if the target is gone on arrival). */
  cost?: number;
};
const MARCH_SPEED = 8;        // world units per second
const MARCH_MIN_MS = 20_000;  // floor so even neighbours take a moment
const SCOUT_MIN_MS = 10_000;
/** GM "shield on" = permanent for testing (2100-01-01). */
const PERMANENT_SHIELD_UNTIL = 4_102_444_800_000;

/** Recon flight time: the real march pace (s/tile) divided by the scout speed multiplier. */
function scoutTravelMs(from: WorldCoord, to: WorldCoord): number {
  const numbers = defaultN();
  const perTile = worldEngineConfig(numbers).travelSecondsPerTile;
  const multiplier = Math.max(1, Number(numbers.global?.march?.scoutSpeedMultiplier) || 3);
  return Math.max(SCOUT_MIN_MS, Math.round(Math.hypot(to.x - from.x, to.y - from.y) * perTile / multiplier * 1000));
}

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
    // Shield (src/lib/shield.ts): Core under protectedUntilKeepLevel, or a shield item.
    // Attack-drops-it arrives with P0-5 (no PvP-active flag server-side yet).
    shielded: shieldActive({ keepLevel, shieldUntil: player.shieldUntil }, Date.now(), defaultN()),
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
// A DM thread lives until 30 days pass with no new message (then it is cleared whole).
const DM_RETAIN_MS = 30 * 24 * 60 * 60 * 1000;
function pruneDm(arr: ChatRow[], now = Date.now()): ChatRow[] {
  const last = arr[arr.length - 1];
  if (!last || now - last.ts > DM_RETAIN_MS) return [];
  return arr.length > MAX_CHAT ? arr.slice(-MAX_CHAT) : arr;
}

// Accept a relayed intel payload only when it is a small, shaped object — never
// trust arbitrary client JSON into stored/broadcast chat.
function sanitizeIntel(value: unknown): unknown | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  // Commander card: identity only, never a location (location-privacy rule).
  if (v.kind === "commander") {
    if (typeof v.playerId !== "string" || typeof v.name !== "string" || v.playerId.length > 64 || v.name.length > 48) return null;
    const faction = typeof v.faction === "string" ? v.faction.replace(/[^a-z0-9_$.-]/gi, "").slice(0, 24) : null;
    const avatar = typeof v.avatar === "string" && AVATAR_TOKEN.test(v.avatar) ? v.avatar : null;
    const bio = cleanBio(v.bio);
    // The sender chose to share where the planet is (and any recon they hold); the
    // system itself still never volunteers coordinates.
    const p = v.position as { x?: unknown; y?: unknown } | null | undefined;
    const position = p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number(p.x) >= 0 && Number(p.y) >= 0 && Number(p.x) <= 8192 && Number(p.y) <= 8192
      ? { x: Number(p.x), y: Number(p.y) } : null;
    const signal = typeof v.signal === "string" && /^[a-z0-9-]{1,32}$/.test(v.signal) ? v.signal : null;
    const recon = sanitizeRecon(v.recon);
    return { kind: "commander", id: String(v.id || "").slice(0, 120), playerId: v.playerId, name: v.name, faction: faction || null,
      coreLevel: Math.max(1, Math.min(30, Math.floor(Number(v.coreLevel) || 1))), avatar, createdAt: Number(v.createdAt) || Date.now(),
      position, signal, recon, bio };
  }
  const pos = v.position as { x?: unknown; y?: unknown } | undefined;
  if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return null;
  if (v.kind !== "coordinate" && v.kind !== "scout-intel") return null;
  let json: string;
  try { json = JSON.stringify(v); } catch { return null; }
  if (json.length > 2000) return null;
  return JSON.parse(json);
}

/** Relayed recon on a commander card: numbers only, and never valid beyond one day. */
function sanitizeRecon(value: unknown): { snapshot: Record<string, unknown>; expiresAt: number } | null {
  const v = value as { snapshot?: Record<string, unknown>; expiresAt?: unknown } | null | undefined;
  if (!v || !v.snapshot || typeof v.snapshot !== "object") return null;
  const expiresAt = Number(v.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now() || expiresAt > Date.now() + 86_400_000) return null;
  const n = (x: unknown) => Math.max(0, Math.min(1e13, Math.floor(Number(x) || 0)));
  const s = v.snapshot;
  const troops = (s.troops || {}) as Record<string, unknown>, resources = (s.resources || {}) as Record<string, unknown>;
  return { expiresAt, snapshot: {
    keepLevel: n(s.keepLevel), might: n(s.might), wounded: n(s.wounded), wallLevel: n(s.wallLevel), shielded: s.shielded === true, faction: null,
    troops: { army: n(troops.army), navy: n(troops.navy), air: n(troops.air) },
    resources: { cash: n(resources.cash), oil: n(resources.oil), power: n(resources.power) },
  } };
}

function sanitizeCosmetics(value: unknown): unknown | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const allowed = ["planetBody", "marchSignature", "warpSignature", "strikeSignature", "chatSignal", "halo", "surface", "orbit", "glyph", "trail", "title", "cursor"];
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

  /**
   * Quantum Warp: the warping commander's own attacks and scouts in flight are called off, and
   * attacks on their way to them miss (the target is gone) — both sides get a report.
   */
  async cancelMarchesFor(pid: string) {
    const now = Date.now();
    const marches = (await this.state.storage.get<MarchRow[]>("marches")) || [];
    const own = marches.filter((march) => march.attacker === pid && march.arriveAt > now);
    const incoming = marches.filter((march) => march.defender === pid && march.kind !== "scout" && march.arriveAt > now);
    if (!own.length && !incoming.length) return;
    const gone = new Set([...own, ...incoming].map((march) => march.id));
    await this.state.storage.put("marches", marches.filter((march) => !gone.has(march.id)));
    for (const march of own) {
      this.sendToPlayer(pid, { type: "march_done", id: march.id });
      if (march.kind !== "scout") this.sendToPlayer(march.defender, { type: "march_done", id: march.id });
    }
    for (const march of incoming) {
      this.sendToPlayer(march.attacker, { type: "march_done", id: march.id });
      this.sendToPlayer(pid, { type: "march_done", id: march.id });
      await this.pushReport(march.attacker, { id: crypto.randomUUID(), kind: "battle", ts: now, by: pid, byName: march.defenderName, payload: { summary: `${march.defenderName} used a Quantum Warp before your army arrived. The target is gone; your troops return home.` } });
      await this.pushReport(pid, { id: crypto.randomUUID(), kind: "battle", ts: now, by: march.attacker, byName: march.attackerName, payload: { summary: `You warped away before ${march.attackerName}'s attack landed.` } });
    }
    await this.scheduleAlarm();
  }

  /** A committed warp in the shared world: move the roster city and play the show for watchers. */
  async moveCoord(playerId: string, coord: WorldCoord) {
    await this.state.storage.put(`coord:v${COORD_VERSION}:${playerId}`, coord);
    const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
    if (players[playerId]) {
      const before = players[playerId].coords;
      players[playerId].coords = coord;
      await this.state.storage.put("players", players);
      if (before) this.sendWarpFx(players[playerId], before, coord);
      this.sendPlayerUpdate(players[playerId]);
    }
  }

  // A pending view of the shared world for one D1 transaction (see SharedWorldPort).
  async makePort(): Promise<SharedWorldPort> {
    const numbers = defaultN();
    const telegraph = (await this.state.storage.get<MarchRow[]>("marches")) || [];
    const roster = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
    let pending: SharedWorldState | null = null;
    let warpTo: { playerId: string; coord: WorldCoord; quantum?: boolean } | null = null;
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
        const quantum = command.type === "world.warp" && command.args.mode === "quantum";
        if (command.type === "world.warp") {
          const live = telegraph.filter((march) => march.arriveAt > now);
          if (quantum) {
            // Quantum Warp escapes an attack on its way, but not one that is landing / resolving.
            if (telegraph.some((march) => march.defender === playerId && march.kind !== "scout" && march.arriveAt <= now + QUANTUM_LOCK_MS)) return fail("battle_in_progress");
          } else {
            if (live.some((march) => march.defender === playerId && march.kind !== "scout")) return fail("under_attack");
            if (live.some((march) => march.attacker === playerId)) return fail("fleets_away");
          }
        }
        const result = applySharedCommand(base(), playerId, game, command, now, numbers);
        if (command.type === "world.warp" && result.ok && result.position) {
          // Cities not yet in the shared world still hold their roster slot.
          const target = result.position;
          const clash = Object.values(roster).some((player) => player.id !== playerId && player.coords && !result.state.world.players[player.id]
            && Math.hypot(player.coords.x - target.x, player.coords.y - target.y) < WARP_SPACING);
          if (clash) return fail("too_close_city");
          warpTo = { playerId, coord: target, quantum };
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
        if (warpTo?.quantum) await this.cancelMarchesFor(warpTo.playerId);
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
    if (url.pathname === "/account-freeze" && req.method === "POST") return this.accountFreeze(req);
    if (url.pathname === "/purge-deleted" && req.method === "POST") {
      const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
      return Response.json({ purged: await this.purgeDeletedAccounts(players, Date.now(), true) });
    }
    if (url.pathname === "/grant-shield" && req.method === "POST") return this.grantShield(req);
    if (url.pathname === "/player-effect" && req.method === "POST") return this.playerEffect(req);
    if (url.pathname === "/scout-quote" && req.method === "POST") return this.scoutOrder(req, false);
    if (url.pathname === "/scout-launch" && req.method === "POST") return this.scoutOrder(req, true);
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
    let body: { player?: string; x?: number; y?: number; minSpacing?: number; revert?: boolean; quantum?: boolean } = {};
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
      if (body.quantum) {
        if (marches.some((march) => march.defender === pid && march.kind !== "scout" && march.arriveAt <= now + QUANTUM_LOCK_MS)) return Response.json({ ok: false, error: "battle_in_progress" }, { status: 409 });
      } else {
        if (live.some((march) => march.defender === pid && march.kind !== "scout")) return Response.json({ ok: false, error: "under_attack" }, { status: 409 });
        if (live.some((march) => march.attacker === pid)) return Response.json({ ok: false, error: "fleets_away" }, { status: 409 });
      }
      const spacing = Math.max(1, Number(body.minSpacing) || 6);
      const clash = Object.values(players).some((player) => player.id !== pid && player.coordVersion === COORD_VERSION && player.coords
        && Math.hypot(player.coords.x - x, player.coords.y - y) < spacing);
      if (clash) return Response.json({ ok: false, error: "too_close_city" }, { status: 409 });
    }
    const coord = { x, y };
    await this.state.storage.put(coordKey, coord);
    if (body.quantum && !body.revert) await this.cancelMarchesFor(pid);
    if (players[pid]) {
      const before = players[pid].coords ?? previous;
      players[pid].coords = coord;
      await this.state.storage.put("players", players);
      // Warp show for commanders already watching either spot — sent before the coordinate
      // update so their client can hide the city until its arrival effect delivers it.
      if (!body.revert && before) this.sendWarpFx(players[pid], before, coord);
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
      shieldUntil: player.shieldUntil || 0,
    }));
    return Response.json({ players: rows });
  }

  // Release map slots (ghost/test players). The D1 account is untouched; a released
  // player respawns on a random outer-ring slot with a welcome-back notice.
  /**
   * Account deletion requested (frozen) or cancelled by signing in (unfrozen). A frozen
   * commander is taken off the map for everyone and disconnected; the coordinate is kept, so
   * cancelling brings the city back where it was.
   */
  async accountFreeze(req: Request): Promise<Response> {
    let body: { player?: unknown; frozen?: unknown } = {};
    try { body = await req.json(); } catch {}
    const pid = String(body.player || "").slice(0, 64);
    if (!pid) return Response.json({ ok: false }, { status: 400 });
    if (body.frozen === false) { await this.state.storage.delete(`frozen:${pid}`); return Response.json({ ok: true }); }
    await this.state.storage.put(`frozen:${pid}`, Date.now());
    const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
    if (players[pid]) { delete players[pid]; await this.state.storage.put("players", players); }
    this.broadcast({ type: "player_removed", id: pid });
    for (const ws of this.state.getWebSockets()) {
      if (((ws.deserializeAttachment() || {}) as Partial<SocketAttachment>).pid === pid) { try { ws.close(4003, "account_deleting"); } catch {} }
    }
    return Response.json({ ok: true });
  }

  /** Grace period over: purge D1 (see purgeDueAccounts) and this room's copy of the commander. */
  async purgeDeletedAccounts(players: Record<string, PlayerRow>, now: number, force = false): Promise<string[]> {
    const last = (await this.state.storage.get<number>("deletionSweepAt")) || 0;
    if (!force && now - last < DORMANT_SWEEP_EVERY_MS) return [];
    await this.state.storage.put("deletionSweepAt", now);
    const ids = await purgeDueAccounts(this.env as unknown as BackendEnv, now);
    if (!ids.length) return [];
    const gone = new Set(ids);
    for (const id of ids) {
      delete players[id];
      for (const key of [`coord:v${COORD_VERSION}:${id}`, `frozen:${id}`, `dormant:${id}`, `dmfav:${id}`, `dmhidden:${id}`, `reports:${id}`]) await this.state.storage.delete(key);
    }
    await this.state.storage.put("players", players);
    const dms = (await this.state.storage.get<Record<string, ChatRow[]>>("dms")) || {};
    for (const key of Object.keys(dms)) if (dms[key].some((m) => gone.has(m.pid) || (m.to && gone.has(m.to)))) delete dms[key];
    await this.state.storage.put("dms", dms);
    await this.locked(async () => {
      if (!(await this.hasShared())) return;
      const shared = await this.loadShared();
      for (const id of ids) {
        const cityId = shared.world.players[id]?.cityId;
        if (cityId) delete shared.world.entities[cityId];
        delete shared.world.players[id];
        for (const [marchId, march] of Object.entries(shared.world.marches)) if (march.playerId === id) delete shared.world.marches[marchId];
      }
      await this.saveShared(shared);
    });
    return ids;
  }

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

  /** Paid scout (from /command world.scout_player): quote = validate + distance; launch =
   *  create the recon fleet after the Oil was debited. Only the sender sees it in flight. */
  async scoutOrder(req: Request, launch: boolean): Promise<Response> {
    let body: { player?: unknown; target?: unknown; cost?: unknown } = {};
    try { body = await req.json(); } catch {}
    const pid = String(body.player || "").slice(0, 64), to = String(body.target || "").slice(0, 64);
    if (!pid || !to || pid === to) return Response.json({ ok: false, error: "invalid_target" });
    const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
    const scouter = players[pid], target = players[to];
    if (!scouter?.coords || !target?.coords) return Response.json({ ok: false, error: "target_unavailable" });
    const now = Date.now();
    const marches = (await this.state.storage.get<MarchRow[]>("marches")) || [];
    if (marches.some((m) => m.kind === "scout" && m.attacker === pid && m.defender === to && m.arriveAt > now)) return Response.json({ ok: false, error: "scout_en_route" });
    const distance = Math.hypot(target.coords.x - scouter.coords.x, target.coords.y - scouter.coords.y);
    if (!launch) return Response.json({ ok: true, distance });
    const march: MarchRow = {
      id: crypto.randomUUID(), kind: "scout", attacker: pid, attackerName: scouter.name, defender: to, defenderName: target.name,
      from: scouter.coords, to: target.coords, departAt: now, arriveAt: now + scoutTravelMs(scouter.coords, target.coords), armyTotal: 0,
      cost: Math.max(0, Math.floor(Number(body.cost) || 0)),
    };
    marches.push(march);
    await this.state.storage.put("marches", marches);
    this.sendToPlayer(pid, { type: "march", march });
    await this.scheduleAlarm();
    return Response.json({ ok: true, march });
  }

  /** Item effects that live in the world (from /command item.use, after the item is paid):
   *  shield hours (public roster + city), Stamina (may exceed the cap), March Boost. */
  async playerEffect(req: Request): Promise<Response> {
    let body: { player?: unknown; shieldHours?: unknown; stamina?: unknown; marchBonus?: unknown; marchMinutes?: unknown } = {};
    try { body = await req.json(); } catch {}
    const pid = String(body.player || "").slice(0, 64).toLowerCase();
    const shieldHours = Math.max(0, Math.min(24 * 30, Number(body.shieldHours) || 0));
    const stamina = Math.max(0, Math.min(10_000, Math.floor(Number(body.stamina) || 0)));
    const marchBonus = Math.max(0, Math.min(1, Number(body.marchBonus) || 0));
    const marchMinutes = Math.max(0, Math.min(24 * 60 * 7, Number(body.marchMinutes) || 0));
    const now = Date.now();
    const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
    if (!players[pid]) return Response.json({ ok: false, error: "not_in_world" });
    const out: { ok: boolean; error?: string; shieldUntil?: number; stamina?: number; marchBoostUntil?: number } = { ok: true };
    if (shieldHours) {
      players[pid].shieldUntil = Math.max(now, players[pid].shieldUntil || 0) + shieldHours * 3_600_000;
      out.shieldUntil = players[pid].shieldUntil;
      await this.state.storage.put("players", players);
    }
    await this.locked(async () => {
      if (!(await this.hasShared())) { if (stamina || marchBonus) { out.ok = false; out.error = "not_in_world"; } return; }
      const shared = await this.loadShared();
      const player = shared.world.players[pid];
      const cityId = player?.cityId;
      const city = cityId ? shared.world.entities[cityId] : null;
      if ((stamina || marchBonus) && !player) { out.ok = false; out.error = "not_in_world"; return; }
      if (shieldHours && city?.kind === "city") city.shieldUntil = Math.max(city.shieldUntil || 0, out.shieldUntil || 0);
      if (player && stamina) {
        player.energyStored = energyAt(player, now, shared.world.config) + stamina;
        player.energyUpdatedAt = now;
        out.stamina = player.energyStored;
      }
      if (player && marchBonus && marchMinutes) {
        const running = (player.marchBoostUntil ?? 0) > now;
        player.marchBoostBonus = running ? Math.max(player.marchBoostBonus ?? 0, marchBonus) : marchBonus;
        player.marchBoostUntil = Math.max(now, player.marchBoostUntil ?? 0) + marchMinutes * 60_000;
        out.marchBoostUntil = player.marchBoostUntil;
      }
      await this.saveShared(shared);
    });
    if (shieldHours) this.sendPlayerUpdate(players[pid]);
    return Response.json(out);
  }

  /** Give Oil back to a server-economy player (scout target gone). Revision-guarded, retried. */
  async refundOil(pid: string, amount: number): Promise<boolean> {
    if (amount <= 0) return true;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const row = await this.env.DB.prepare("SELECT revision, game_json, economy_authority_version FROM player_state WHERE player_id = ?")
        .bind(pid).first<{ revision: number; game_json: string | null; economy_authority_version: number }>();
      if (!row?.economy_authority_version) return false;
      const game: any = projectGameJson(row.game_json, Date.now());
      if (!game) return false;
      game.res.oil = (Number(game.res.oil) || 0) + amount;
      const res = await this.env.DB.prepare("UPDATE player_state SET game_json = ?, revision = revision + 1, updated_at = ? WHERE player_id = ? AND revision = ?")
        .bind(JSON.stringify(game), Date.now(), pid, row.revision).run();
      if (res.meta.changes) return true;
    }
    return false;
  }

  /** GM: shield players. Default: `hours` (extends a running one). mode "on": permanent (GM
   *  testing); mode "off": remove the item shield (the Core < 10 rule still applies). Sets the
   *  public roster field (dome for everyone, attack/scout gate) and the shared-world city. */
  async grantShield(req: Request): Promise<Response> {
    let body: { ids?: unknown; hours?: unknown; mode?: unknown } = {};
    try { body = await req.json(); } catch {}
    // Roster keys are normalized (lower-case) player ids.
    const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id).slice(0, 64).toLowerCase()).slice(0, 500) : [];
    const hours = Math.max(1, Math.min(72, Math.floor(Number(body.hours) || 8)));
    const mode = body.mode === "on" || body.mode === "off" ? body.mode : null;
    const now = Date.now();
    const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
    const granted: Array<{ id: string; shieldUntil: number }> = [];
    for (const id of ids) {
      const player = players[id];
      if (!player) continue;
      player.shieldUntil = mode === "on" ? PERMANENT_SHIELD_UNTIL : mode === "off" ? 0 : Math.max(now, player.shieldUntil || 0) + hours * 3_600_000;
      granted.push({ id, shieldUntil: player.shieldUntil });
    }
    if (!granted.length) return Response.json({ granted });
    await this.state.storage.put("players", players);
    await this.locked(async () => {
      if (!(await this.hasShared())) return;
      const shared = await this.loadShared();
      for (const { id, shieldUntil } of granted) {
        const cityId = shared.world.players[id]?.cityId;
        const city = cityId ? shared.world.entities[cityId] : null;
        if (city?.kind === "city") city.shieldUntil = mode === "off" ? 0 : Math.max(city.shieldUntil || 0, shieldUntil);
      }
      await this.saveShared(shared);
    });
    for (const { id } of granted) this.sendPlayerUpdate(players[id]);
    return Response.json({ granted });
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
    await this.purgeDeletedAccounts(players, Date.now());
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
    // Only this player's DM threads: cleared after 30 days without a new message, and
    // hidden (for this player only) when they removed the thread — until a newer message.
    const dmsAll = (await this.state.storage.get<Record<string, ChatRow[]>>("dms")) || {};
    const hidden = (await this.state.storage.get<Record<string, number>>(`dmhidden:${pid}`)) || {};
    const dms: Record<string, ChatRow[]> = {};
    let expired = false;
    for (const [k, arr] of Object.entries(dmsAll)) {
      const kept = pruneDm(arr);
      if (!kept.length) { delete dmsAll[k]; expired = true; continue; }
      if (!k.split("|").includes(pid)) continue;
      const partner = k.split("|").find((id) => id !== pid) || k;
      // A deleted chat is gone for this player: only messages after the delete remain.
      const visible = hidden[partner] ? kept.filter((message) => message.ts > hidden[partner]) : kept;
      if (!visible.length) continue;
      dms[k] = visible.map((message) => ({
        ...message,
        name: players[message.pid]?.name || message.name,
        ...(message.to ? { toName: players[message.to]?.name || message.toName } : {}),
      }));
    }
    if (expired) await this.state.storage.put("dms", dmsAll);
    if (returning) {
      await this.pushReport(pid, { id: crypto.randomUUID(), kind: "relocated", ts: Date.now(), payload: {
        summary: `Welcome back. Your city was moved to a new outer-ring sector while you were away. Progress is intact.`,
      } });
    }
    const reports = (await this.state.storage.get<ServerReport[]>(`reports:${pid}`)) || [];
    const allMarches = (await this.state.storage.get<MarchRow[]>("marches")) || [];
    const marches = allMarches.filter((m) => m.arriveAt > Date.now() && (m.attacker === pid || (m.defender === pid && m.kind !== "scout")));
    const roster = Object.values(players).map((player) => player.id === pid ? player : publicPlayer(player));
    const dmFavs = (await this.state.storage.get<string[]>(`dmfav:${pid}`)) || [];
    ws.send(JSON.stringify({ type: "snapshot", you: pid, players: roster, chat, dms, reports, marches, dmFavs }));
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
    if (data?.type === "view") { await this.handleView(ws, att as SocketAttachment, data.rect, now, !!data.strategic, typeof data.detail === "boolean" ? data.detail : undefined); return; }
    if (!att.windowStart || now - att.windowStart >= 10_000) { att.windowStart = now; att.messageCount = 0; }
    att.messageCount = (att.messageCount || 0) + 1;
    ws.serializeAttachment(att);
    if (att.messageCount > 25) { ws.close(1008, "rate limit"); return; }

    if (data.type === "search") { await this.handleSearch(ws, pid, data); return; }
    if (data.type === "chat") {
      const text = String(data.text || "").slice(0, 500).trim();
      // A relayed card rides along as a small JSON payload and renders as a clickable
      // card; it may be sent on its own, without any text.
      const intel = sanitizeIntel(data.intel);
      if (!text && !intel) return;
      const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
      const msg: ChatRow = { id: crypto.randomUUID(), pid, name: players[pid]?.name || att.name || "Commander", text, ts: Date.now(), faction: players[pid]?.faction || null, signal: chatSignalOf(players[pid]), ...(intel ? { intel } : {}) };
      const chat = (await this.state.storage.get<ChatRow[]>("chat:cosmos")) || [];
      chat.push(msg);
      await this.state.storage.put("chat:cosmos", prune(chat));
      this.broadcast({ type: "chat", msg });
    } else if (data.type === "dm") {
      const to = String(data.to || "").slice(0, 64);
      const text = String(data.text || "").slice(0, 500).trim();
      if (!to || to === pid || (!text && !data.intel)) return;
      const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
      const key = dmKey(pid, to);
      const dmsAll = (await this.state.storage.get<Record<string, ChatRow[]>>("dms")) || {};
      const arr = dmsAll[key] || [];
      const intel = sanitizeIntel(data.intel);
      if (!text && !intel) return;
      // Recipient filters new commanders: only alliance members, Core 10+ senders, or someone the
      // recipient already wrote to may open a chat. Blocked messages are not stored.
      if (players[to]?.dmFilter && !(await this.dmAllowed(pid, to, players, arr))) {
        this.sendToPlayer(pid, { type: "dm_blocked", to, reason: "filtered" });
        return;
      }
      // Remember who this was sent to, so the thread keeps the partner's name even if they
      // never reply or are no longer on the roster.
      const toName = players[to]?.name || String(data.toName || "").replace(/[\u0000-\u001f]/g, "").slice(0, 48) || undefined;
      const msg: ChatRow = { id: crypto.randomUUID(), pid, to, ...(toName ? { toName } : {}), name: players[pid]?.name || att.name || "Commander", text, ts: Date.now(), faction: players[pid]?.faction || null, signal: chatSignalOf(players[pid]), ...(intel ? { intel } : {}) };
      arr.push(msg);
      dmsAll[key] = pruneDm(arr);
      await this.state.storage.put("dms", dmsAll);
      const payload = JSON.stringify({ type: "dm", key, msg });
      for (const sock of this.state.getWebSockets()) {
        const a = ((sock.deserializeAttachment() || {}) as Partial<SocketAttachment>).pid;
        if (a === pid || a === to) { try { sock.send(payload); } catch {} }
      }
    } else if (data.type === "dm_fav") {
      // Favourite DMs are pinned to the top of this player's Direct list.
      const partner = String(data.with || "").slice(0, 64);
      if (!partner) return;
      const key = `dmfav:${pid}`;
      const favs = new Set((await this.state.storage.get<string[]>(key)) || []);
      if (data.on) favs.add(partner); else favs.delete(partner);
      await this.state.storage.put(key, [...favs].slice(-50));
    } else if (data.type === "dm_hide") {
      // Delete a DM thread for this player: its history so far is gone for them (the
      // other side keeps theirs); a newer message starts a fresh thread.
      const partner = String(data.with || "").slice(0, 64);
      if (!partner) return;
      const key = `dmhidden:${pid}`;
      const hiddenAll = (await this.state.storage.get<Record<string, number>>(key)) || {};
      hiddenAll[partner] = Date.now();
      await this.state.storage.put(key, hiddenAll);
      const favKey = `dmfav:${pid}`;
      const favs = (await this.state.storage.get<string[]>(favKey)) || [];
      if (favs.includes(partner)) await this.state.storage.put(favKey, favs.filter((id) => id !== partner));
    } else if (data.type === "scout") {
      // Scouting is a paid order now (/command world.scout_player -> /scout-launch); an old
      // client's free socket scout is ignored.
      return;
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
      if (typeof data.avatar === "string" && AVATAR_TOKEN.test(data.avatar)) p.avatar = data.avatar;
      if (data.bio === null || typeof data.bio === "string") p.bio = cleanBio(data.bio);
      if (typeof data.dmFilter === "boolean") p.dmFilter = data.dmFilter;
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
  async handleView(ws: WebSocket, att: SocketAttachment, raw: unknown, now: number, strategic = false, detail?: boolean) {
    if (att.viewAt && now - att.viewAt < VIEW_MIN_INTERVAL_MS) return;
    att.viewAt = now;
    // Strategic zoom: only the public target aggregate (no players, no coordinates of cities).
    // A hibernated room answers from the precomputed chunk instead of loading the world.
    if (strategic) {
      ws.serializeAttachment(att);
      const stored = this.shared ? undefined : await this.state.storage.get<string>(`${STORE_PREFIX}x:clusters`);
      // No precomputed chunk yet (written on the next save): compute it from the world once.
      const clusters = this.shared ? sharedClusters(this.shared)
        : stored ? clustersFromChunk(stored) : (await this.hasShared()) ? sharedClusters(await this.loadShared()) : [];
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
    // The client says which it draws (a zoom threshold, the same both ways); older clients
    // fall back to the target budget.
    const dense = !!view && (detail === false || (detail === undefined && view.targets.length > VIEW_TARGET_BUDGET));
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
  /**
   * Tell viewers of the old spot that the city left and viewers of the new spot that it
   * arrived (with its Warp Arrival relic). Same visibility rule as sendPlayerUpdate: only a
   * socket whose current view already contains that coordinate learns it.
   */
  sendWarpFx(player: PlayerRow, from: WorldCoord, to: WorldCoord) {
    const signature = (player.cosmetics as { warpSignature?: unknown } | null)?.warpSignature;
    const depart = JSON.stringify({ type: "warp-fx", kind: "depart", player: player.id, coords: from });
    const arrive = JSON.stringify({ type: "warp-fx", kind: "arrive", player: player.id, coords: to, signature: typeof signature === "string" ? signature : null });
    for (const ws of this.state.getWebSockets()) {
      const a = (ws.deserializeAttachment() || {}) as Partial<SocketAttachment>;
      if (a.pid === player.id) continue;
      try {
        if (inView(a.view, from)) ws.send(depart);
        if (inView(a.view, to)) ws.send(arrive);
      } catch {}
    }
  }

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

  /** DM filter rule (see "dm"): same alliance, an existing reply from the recipient, or Core 10+. */
  async dmAllowed(from: string, to: string, players: Record<string, PlayerRow>, thread: ChatRow[]): Promise<boolean> {
    const sender = players[from], recipient = players[to];
    if (sender?.faction && recipient?.faction && sender.faction === recipient.faction) return true;
    if (thread.some((message) => message.pid === to)) return true;
    // Core level: the shared world's city is authoritative; the roster (presence) is the fallback.
    let core = sender?.keepLevel ?? 1;
    if (await this.hasShared()) {
      const shared = await this.loadShared();
      const cityId = shared.world.players[from]?.cityId;
      const city = cityId ? shared.world.entities[cityId] : null;
      if (city?.kind === "city") core = city.townhallLevel;
    }
    return core >= DM_FILTER_MIN_CORE;
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
    const roster = due.some((m) => m.kind === "scout") ? (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {} : {};
    for (const m of due) {
      if (m.kind === "scout") {
        this.sendToPlayer(m.attacker, { type: "march_done", id: m.id });
        const target = roster[m.defender];
        if (!target) {
          // The target left the world while the scout flew: the Oil comes back.
          const refunded = m.cost ? await this.refundOil(m.attacker, m.cost) : false;
          await this.pushReport(m.attacker, { id: crypto.randomUUID(), kind: "recon", ts: now, by: m.defender, byName: m.defenderName, payload: { failed: true, refunded: refunded ? m.cost : 0 } });
          continue;
        }
        const row = await this.env.DB.prepare("SELECT game_json FROM player_state WHERE player_id = ?").bind(m.defender).first<{ game_json: string | null }>();
        const snapshot = buildScoutSnapshot(target, row?.game_json);
        const expiresAt = now + worldEngineConfig(defaultN()).scoutIntelTtlSec * 1000;
        await this.pushReport(m.attacker, { id: crypto.randomUUID(), kind: "recon", ts: now, by: m.defender, byName: target.name, payload: { targetId: m.defender, snapshot, expiresAt } });
        await this.pushReport(m.defender, { id: crypto.randomUUID(), kind: "scouted", ts: now, by: m.attacker, byName: m.attackerName });
        continue;
      }
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
