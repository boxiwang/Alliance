// Alliance realtime backend: one Durable Object ("world room") that holds the
// shared player registry (cities on the star map) and a live chat channel.
// Free-tier friendly: hibernatable WebSockets, event-driven, bounded storage.
// Personal economy/city stays client-local; only public presence + chat sync here.

export interface Env {
  WORLD_ROOM: DurableObjectNamespace;
}

const ALLOWED_ORIGINS = [
  "https://alliance-7q2.pages.dev",
  "http://localhost:5173",
  "http://localhost:4173",
];

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && (ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".alliance-7q2.pages.dev")) ? origin : ALLOWED_ORIGINS[0];
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET,OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get("Origin");
    if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
    if (url.pathname === "/health") return new Response("ok", { headers: corsHeaders(origin) });
    if (url.pathname === "/ws") {
      if (req.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
      const id = env.WORLD_ROOM.idFromName("frontier-1"); // single shared world for the beta
      return env.WORLD_ROOM.get(id).fetch(req);
    }
    return new Response("Alliance realtime", { status: 200, headers: corsHeaders(origin) });
  },
};

const MAX_CHAT = 80;         // stored chat history (ring, per channel/thread)
const RETAIN_MS = 7 * 24 * 60 * 60 * 1000; // drop chat older than a week (save storage)
const WORLD_SIZE = 512;      // must match the client world config width
const RESERVE = 70;          // keep spawns off the central wormhole

type PlayerRow = {
  id: string; name: string; coords: { x: number; y: number };
  might: number; keepLevel: number; faction: string | null;
  cosmetics: unknown; online: boolean; lastSeen: number;
};
type ChatRow = { id: string; pid: string; name: string; text: string; ts: number; faction: string | null; to?: string };

function prune(arr: ChatRow[]): ChatRow[] {
  const cut = Date.now() - RETAIN_MS;
  const out = arr.filter((m) => m.ts >= cut);
  while (out.length > MAX_CHAT) out.shift();
  return out;
}
const dmKey = (a: string, b: string) => [a, b].sort().join("|");

export class WorldRoom {
  state: DurableObjectState;
  constructor(state: DurableObjectState) { this.state = state; }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const pid = (url.searchParams.get("id") || "anon-" + Math.random().toString(36).slice(2)).slice(0, 64);
    const name = (url.searchParams.get("name") || "Commander").slice(0, 24);
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    this.state.acceptWebSocket(server, [pid]);
    server.serializeAttachment({ pid, name });
    await this.onJoin(server, pid, name);
    return new Response(null, { status: 101, webSocket: client });
  }

  async onJoin(ws: WebSocket, pid: string, name: string) {
    const players = ((await this.state.storage.get<Record<string, PlayerRow>>("players")) || {});
    if (!players[pid]) {
      players[pid] = { id: pid, name, coords: this.assignCoord(players), might: 0, keepLevel: 1, faction: null, cosmetics: null, online: true, lastSeen: Date.now() };
    } else {
      players[pid].online = true; players[pid].name = name; players[pid].lastSeen = Date.now();
    }
    await this.state.storage.put("players", players);
    const chat = prune((await this.state.storage.get<ChatRow[]>("chat:cosmos")) || []);
    // Only this player's DM threads, pruned to the retention window.
    const dmsAll = (await this.state.storage.get<Record<string, ChatRow[]>>("dms")) || {};
    const dms: Record<string, ChatRow[]> = {};
    for (const [k, arr] of Object.entries(dmsAll)) {
      if (k.split("|").includes(pid)) { const p = prune(arr); if (p.length) dms[k] = p; }
    }
    ws.send(JSON.stringify({ type: "snapshot", you: pid, players: Object.values(players), chat, dms }));
    this.broadcast({ type: "player", player: players[pid] }, ws);
  }

  // Deterministic-ish spread on a grid, avoiding the central reserve, so every
  // client renders the same shared map with no two cities on top of each other.
  assignCoord(players: Record<string, PlayerRow>): { x: number; y: number } {
    const taken = new Set(Object.values(players).map((p) => `${p.coords.x},${p.coords.y}`));
    const cols = 10, cell = WORLD_SIZE / cols, cx = WORLD_SIZE / 2, cy = WORLD_SIZE / 2;
    for (let i = 0; i < cols * cols; i++) {
      const gx = (i * 7 + 3) % cols, gy = Math.floor((i * 7 + 3) / cols) % cols;
      const x = Math.round(gx * cell + cell / 2), y = Math.round(gy * cell + cell / 2);
      if (Math.hypot(x - cx, y - cy) < RESERVE) continue;
      if (!taken.has(`${x},${y}`)) return { x, y };
    }
    return { x: 40 + Math.floor(Math.random() * (WORLD_SIZE - 80)), y: 40 + Math.floor(Math.random() * (WORLD_SIZE - 80)) };
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    let data: any;
    try { data = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)); } catch { return; }
    const att = (ws.deserializeAttachment() || {}) as { pid?: string; name?: string };
    const pid = att.pid;
    if (!pid) return;

    if (data.type === "chat") {
      const text = String(data.text || "").slice(0, 500).trim();
      if (!text) return;
      const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
      const msg: ChatRow = { id: crypto.randomUUID(), pid, name: players[pid]?.name || att.name || "Commander", text, ts: Date.now(), faction: players[pid]?.faction || null };
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
      const msg: ChatRow = { id: crypto.randomUUID(), pid, to, name: players[pid]?.name || att.name || "Commander", text, ts: Date.now(), faction: players[pid]?.faction || null };
      arr.push(msg);
      dmsAll[key] = prune(arr);
      await this.state.storage.put("dms", dmsAll);
      const payload = JSON.stringify({ type: "dm", key, msg });
      for (const sock of this.state.getWebSockets()) {
        const a = ((sock.deserializeAttachment() || {}) as { pid?: string }).pid;
        if (a === pid || a === to) { try { sock.send(payload); } catch {} }
      }
    } else if (data.type === "presence") {
      const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
      const p = players[pid]; if (!p) return;
      if (typeof data.name === "string") p.name = data.name.slice(0, 24);
      if (data.cosmetics) p.cosmetics = data.cosmetics;
      if (typeof data.might === "number") p.might = data.might;
      if (typeof data.keepLevel === "number") p.keepLevel = data.keepLevel;
      if (data.faction !== undefined) p.faction = data.faction;
      p.online = true; p.lastSeen = Date.now();
      await this.state.storage.put("players", players);
      this.broadcast({ type: "player", player: p });
    }
  }

  async webSocketClose(ws: WebSocket) {
    const att = (ws.deserializeAttachment() || {}) as { pid?: string };
    const pid = att.pid; if (!pid) return;
    const players = (await this.state.storage.get<Record<string, PlayerRow>>("players")) || {};
    if (players[pid]) {
      players[pid].online = false; players[pid].lastSeen = Date.now();
      await this.state.storage.put("players", players);
      this.broadcast({ type: "player", player: players[pid] });
    }
  }

  broadcast(obj: unknown, except?: WebSocket) {
    const s = JSON.stringify(obj);
    for (const ws of this.state.getWebSockets()) {
      if (ws === except) continue;
      try { ws.send(s); } catch {}
    }
  }
}
