// Alliance realtime backend: one Durable Object ("world room") that holds the
// shared player registry (cities on the star map) and a live chat channel.
// Free-tier friendly: hibernatable WebSockets, event-driven, bounded storage.
// Personal economy/city is progressively mirrored to D1; public presence + chat
// stay in a hibernatable Durable Object for low-latency coordination.

import { verifySession } from "./auth";
import { handlePlayerApi, type BackendEnv } from "./player-api";
import { assignOuterRingCoord, type WorldCoord } from "./world-coords";

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
const COORD_VERSION = 2;

type PlayerRow = {
  id: string; name: string; coords: { x: number; y: number };
  might: number; keepLevel: number; faction: string | null;
  cosmetics: unknown; online: boolean; lastSeen: number; coordVersion?: number;
};
type ChatRow = { id: string; pid: string; name: string; text: string; ts: number; faction: string | null; to?: string; intel?: unknown; signal?: string | null };

// Server-authoritative per-player combat/intel reports (scouted / incoming /
// battle). Delivered on join (offline players see them on return) and live.
type ServerReport = { id: string; kind: "scouted" | "incoming" | "battle"; ts: number; by?: string; byName?: string; payload?: Record<string, unknown> };

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
  if (!gameJson) return 0;
  let game: any = null; try { game = JSON.parse(gameJson); } catch { return 0; }
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
  let game: any = null;
  if (gameJson) { try { game = JSON.parse(gameJson); } catch { game = null; } }
  const armTotal = (arm: string): number => {
    const tiers = game?.troops?.[arm];
    return tiers && typeof tiers === "object" ? Object.values(tiers).reduce((s: number, n) => s + num(n), 0) : 0;
  };
  const res = game?.res || {};
  const keepLevel = num(game?.buildings?.keep?.lvl) || player.keepLevel || 1;
  return {
    keepLevel,
    might: player.might || 0,
    faction: player.faction || null,
    troops: { army: armTotal("army"), navy: armTotal("navy"), air: armTotal("air") },
    wounded: num(game?.wounded),
    resources: { cash: num(res.cash), oil: num(res.oil), power: num(res.power) },
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
type SocketAttachment = { pid: string; name: string; sessionId: string; windowStart: number; messageCount: number };

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

export class WorldRoom {
  state: DurableObjectState;
  env: Env;
  constructor(state: DurableObjectState, env: Env) { this.state = state; this.env = env; }

  async fetch(req: Request): Promise<Response> {
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

  async onJoin(ws: WebSocket, pid: string, name: string) {
    const players = ((await this.state.storage.get<Record<string, PlayerRow>>("players")) || {});
    const coordKey = `coord:v${COORD_VERSION}:${pid}`;
    let coord = await this.state.storage.get<WorldCoord>(coordKey);
    if (!coord) {
      const assigned = Object.values(players)
        .filter((player) => player.id !== pid && player.coordVersion === COORD_VERSION)
        .map((player) => player.coords);
      coord = assignOuterRingCoord(assigned);
      await this.state.storage.put(coordKey, coord);
    }
    if (!players[pid]) {
      players[pid] = { id: pid, name, coords: coord, might: 0, keepLevel: 1, faction: null, cosmetics: null, online: true, lastSeen: Date.now(), coordVersion: COORD_VERSION };
    } else {
      players[pid].name = name; players[pid].coords = coord; players[pid].coordVersion = COORD_VERSION; players[pid].lastSeen = Date.now();
    }
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
    const reports = (await this.state.storage.get<ServerReport[]>(`reports:${pid}`)) || [];
    const allMarches = (await this.state.storage.get<MarchRow[]>("marches")) || [];
    const marches = allMarches.filter((m) => m.arriveAt > Date.now() && (m.attacker === pid || m.defender === pid));
    ws.send(JSON.stringify({ type: "snapshot", you: pid, players: Object.values(players), chat, dms, reports, marches }));
    this.broadcast({ type: "player", player: players[pid] }, ws);
    // Tell everyone about any ghosts we just cleared (or others revived).
    for (const id of flipped) if (id !== pid) this.broadcast({ type: "player", player: players[id] });
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
    if (!att.windowStart || now - att.windowStart >= 10_000) { att.windowStart = now; att.messageCount = 0; }
    att.messageCount = (att.messageCount || 0) + 1;
    ws.serializeAttachment(att);
    if (att.messageCount > 25) { ws.close(1008, "rate limit"); return; }

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
      this.sendToPlayer(pid, { type: "scout_result", target: to, name: players[to].name, coords: players[to].coords, snapshot });
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
      await this.pushReport(to, { id: crypto.randomUUID(), kind: "incoming", ts: departAt, by: pid, byName: attacker.name, payload: { arriveAt, etaSec, armyTotal } });
      this.sendToPlayer(pid, { type: "march", march });
      this.sendToPlayer(to, { type: "march", march });
      await this.scheduleMarchAlarm();
    } else if (data.type === "presence") {
      const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
      const p = players[pid]; if (!p) return;
      const account = await this.env.DB.prepare("SELECT display_name FROM players WHERE id = ?").bind(pid).first<{ display_name: string }>();
      if (account?.display_name) p.name = account.display_name;
      const cosmetics = sanitizeCosmetics(data.cosmetics);
      if (cosmetics) p.cosmetics = cosmetics;
      const might = finiteInteger(data.might, 0, 10_000_000_000);
      const keepLevel = finiteInteger(data.keepLevel, 1, 30);
      if (might !== null) p.might = might;
      if (keepLevel !== null) p.keepLevel = keepLevel;
      if (data.faction === null) p.faction = null;
      else if (typeof data.faction === "string") p.faction = data.faction.replace(/[^a-z0-9_$.-]/gi, "").slice(0, 24) || null;
      p.online = true; p.lastSeen = Date.now();
      await this.state.storage.put("players", players);
      this.broadcast({ type: "player", player: p });
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
      this.broadcast({ type: "player", player: players[pid] });
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

  // Wake at the next march arrival.
  async scheduleMarchAlarm() {
    const marches = (await this.state.storage.get<MarchRow[]>("marches")) || [];
    if (!marches.length) return;
    const next = Math.min(...marches.map((m) => m.arriveAt));
    const current = await this.state.storage.getAlarm();
    if (current === null || next < current) await this.state.storage.setAlarm(next);
  }

  // Fired when a march arrives. Phase 2: telegraph only — notify both sides that
  // the army reached the target; no economy change yet (battle math = Phase 3).
  async alarm() {
    const now = Date.now();
    const marches = (await this.state.storage.get<MarchRow[]>("marches")) || [];
    const due = marches.filter((m) => m.arriveAt <= now);
    const remaining = marches.filter((m) => m.arriveAt > now);
    for (const m of due) {
      await this.pushReport(m.defender, { id: crypto.randomUUID(), kind: "battle", ts: now, by: m.attacker, byName: m.attackerName, payload: { summary: `${m.attackerName}'s army reached your city (${m.armyTotal.toLocaleString()} troops). Battle resolution arrives with the next build.` } });
      await this.pushReport(m.attacker, { id: crypto.randomUUID(), kind: "battle", ts: now, by: m.defender, byName: m.defenderName, payload: { summary: `Your army reached ${m.defenderName}. Battle resolution arrives with the next build; troops return home.` } });
      this.sendToPlayer(m.attacker, { type: "march_done", id: m.id });
      this.sendToPlayer(m.defender, { type: "march_done", id: m.id });
    }
    if (due.length) await this.state.storage.put("marches", remaining);
    if (remaining.length) await this.state.storage.setAlarm(Math.min(...remaining.map((m) => m.arriveAt)));
  }
}
