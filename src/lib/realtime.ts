// Client for the Alliance realtime backend (Cloudflare Worker + Durable Object).
// One shared "world room": live chat + player presence for the shared star map.
// Auto-reconnects; queues sends while offline.

import { BACKEND_WS, loadBackendSession } from "./backend";

export type PresenceCity = {
  id: string; name: string; coords: { x: number; y: number };
  might: number; keepLevel: number; faction: string | null;
  cosmetics: unknown; online: boolean; lastSeen: number;
};
export type LiveChat = { id: string; pid: string; name: string; text: string; ts: number; faction: string | null; to?: string; intel?: unknown; signal?: string | null };

// Server-authoritative combat/intel report (scouted / incoming / battle).
export type ServerReport = { id: string; kind: "scouted" | "incoming" | "battle"; ts: number; by?: string; byName?: string; payload?: Record<string, unknown> };
export type ScoutSnapshot = {
  keepLevel: number; might: number; faction: string | null; wounded: number; wallLevel: number; shielded: boolean;
  troops: { army: number; navy: number; air: number };
  resources: { cash: number; oil: number; power: number };
};
export type LiveMarch = {
  id: string; attacker: string; attackerName: string; defender: string; defenderName: string;
  from: { x: number; y: number }; to: { x: number; y: number }; departAt: number; arriveAt: number; armyTotal: number;
};

type Handlers = {
  onSnapshot?: (you: string, players: PresenceCity[], chat: LiveChat[], dms: Record<string, LiveChat[]>, reports: ServerReport[], marches: LiveMarch[]) => void;
  onChat?: (msg: LiveChat) => void;
  onDM?: (key: string, msg: LiveChat) => void;
  onPlayer?: (player: PresenceCity) => void;
  onStatus?: (connected: boolean) => void;
  onReport?: (report: ServerReport) => void;
  onScoutResult?: (target: string, name: string, coords: { x: number; y: number } | null, snapshot: ScoutSnapshot) => void;
  onMarch?: (march: LiveMarch) => void;
  onMarchDone?: (id: string) => void;
  onMarchRejected?: (reason: string) => void;
};

export class RealtimeClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private closed = false;
  private retry = 0;
  private queue: string[] = [];
  handlers: Handlers = {};

  constructor(id: string, name: string) {
    const session = loadBackendSession(id);
    this.url = session ? `${BACKEND_WS}?token=${encodeURIComponent(session.token)}` : "";
    if (this.url) this.connect();
    else queueMicrotask(() => this.handlers.onStatus?.(false));
  }

  private connect() {
    if (this.closed) return;
    try { this.ws = new WebSocket(this.url); } catch { this.scheduleReconnect(); return; }
    this.ws.onopen = () => {
      this.retry = 0;
      this.handlers.onStatus?.(true);
      const pending = this.queue; this.queue = [];
      pending.forEach((m) => { try { this.ws?.send(m); } catch {} });
    };
    this.ws.onmessage = (ev) => {
      let d: any; try { d = JSON.parse(ev.data); } catch { return; }
      if (d.type === "snapshot") this.handlers.onSnapshot?.(d.you, d.players || [], d.chat || [], d.dms || {}, d.reports || [], d.marches || []);
      else if (d.type === "chat") this.handlers.onChat?.(d.msg);
      else if (d.type === "dm") this.handlers.onDM?.(d.key, d.msg);
      else if (d.type === "player") this.handlers.onPlayer?.(d.player);
      else if (d.type === "report") this.handlers.onReport?.(d.report);
      else if (d.type === "scout_result") this.handlers.onScoutResult?.(d.target, d.name, d.coords || null, d.snapshot);
      else if (d.type === "march") this.handlers.onMarch?.(d.march);
      else if (d.type === "march_done") this.handlers.onMarchDone?.(d.id);
      else if (d.type === "march_rejected") this.handlers.onMarchRejected?.(d.reason);
    };
    this.ws.onclose = () => { this.handlers.onStatus?.(false); this.scheduleReconnect(); };
    this.ws.onerror = () => { try { this.ws?.close(); } catch {} };
  }

  private scheduleReconnect() {
    if (this.closed) return;
    this.retry = Math.min(this.retry + 1, 6);
    const delay = 400 * 2 ** this.retry + Math.random() * 400;
    setTimeout(() => this.connect(), delay);
  }

  private send(obj: unknown) {
    const s = JSON.stringify(obj);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) { try { this.ws.send(s); } catch { this.queue.push(s); } }
    else {
      this.queue.push(s);
      if (this.queue.length > 100) this.queue.splice(0, this.queue.length - 100);
    }
  }

  sendChat(text: string, intel?: unknown) { this.send({ type: "chat", text, ...(intel ? { intel } : {}) }); }
  sendDM(to: string, text: string) { this.send({ type: "dm", to, text }); }
  sendScout(to: string) { this.send({ type: "scout", to }); }
  sendMarch(to: string) { this.send({ type: "march", to }); }
  sendPresence(p: { name?: string; might?: number; keepLevel?: number; faction?: string | null; cosmetics?: unknown }) {
    this.send({ type: "presence", ...p });
  }
  close() { this.closed = true; try { this.ws?.close(); } catch {} }
}
