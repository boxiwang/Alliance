// Client for the Alliance realtime backend (Cloudflare Worker + Durable Object).
// One shared "world room": live chat + player presence for the shared star map.
// Auto-reconnects; queues sends while offline.

import { BACKEND_WS, loadBackendSession } from "./backend";

export type PresenceCity = {
  id: string; name: string; coords: { x: number; y: number };
  might: number; keepLevel: number; faction: string | null;
  cosmetics: unknown; online: boolean; lastSeen: number;
};
export type LiveChat = { id: string; pid: string; name: string; text: string; ts: number; faction: string | null; to?: string; intel?: unknown };

type Handlers = {
  onSnapshot?: (you: string, players: PresenceCity[], chat: LiveChat[], dms: Record<string, LiveChat[]>) => void;
  onChat?: (msg: LiveChat) => void;
  onDM?: (key: string, msg: LiveChat) => void;
  onPlayer?: (player: PresenceCity) => void;
  onStatus?: (connected: boolean) => void;
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
      if (d.type === "snapshot") this.handlers.onSnapshot?.(d.you, d.players || [], d.chat || [], d.dms || {});
      else if (d.type === "chat") this.handlers.onChat?.(d.msg);
      else if (d.type === "dm") this.handlers.onDM?.(d.key, d.msg);
      else if (d.type === "player") this.handlers.onPlayer?.(d.player);
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
  sendPresence(p: { name?: string; might?: number; keepLevel?: number; faction?: string | null; cosmetics?: unknown }) {
    this.send({ type: "presence", ...p });
  }
  close() { this.closed = true; try { this.ws?.close(); } catch {} }
}
