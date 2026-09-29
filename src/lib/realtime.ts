// Client for the Alliance realtime backend (Cloudflare Worker + Durable Object).
// One shared "world room": live chat + player presence for the shared star map.
// Auto-reconnects; queues sends while offline.

import { BACKEND_WS, loadBackendSession } from "./backend";

export type PresenceCity = {
  // Other players' coordinates arrive only for cities inside your current map view.
  id: string; name: string; coords: { x: number; y: number } | null;
  might: number; keepLevel: number; faction: string | null;
  cosmetics: unknown; online: boolean; lastSeen: number;
  /** Commander sigil (profile avatar), shown on the map card. */
  avatar?: string | null;
};
export type ViewRect = { x0: number; y0: number; x1: number; y1: number };
export type LiveChat = { id: string; pid: string; name: string; text: string; ts: number; faction: string | null; to?: string; toName?: string; intel?: unknown; signal?: string | null };

// Server-authoritative combat/intel report (scouted / incoming / battle).
export type ServerReport = { id: string; kind: "scouted" | "incoming" | "battle" | "relocated" | "recon"; ts: number; by?: string; byName?: string; payload?: Record<string, unknown> };
export type ScoutSnapshot = {
  keepLevel: number; might: number; faction: string | null; wounded: number; wallLevel: number; shielded: boolean;
  troops: { army: number; navy: number; air: number };
  resources: { cash: number; oil: number; power: number };
};
export type LiveMarch = {
  id: string; attacker: string; attackerName: string; defender: string; defenderName: string;
  from: { x: number; y: number }; to: { x: number; y: number }; departAt: number; arriveAt: number; armyTotal: number;
  /** "scout": your recon fleet (only the sender receives it). */
  kind?: "scout";
};

type Handlers = {
  onSnapshot?: (you: string, players: PresenceCity[], chat: LiveChat[], dms: Record<string, LiveChat[]>, reports: ServerReport[], marches: LiveMarch[], meta: { dmFavs: string[] }) => void;
  onChat?: (msg: LiveChat) => void;
  onDM?: (key: string, msg: LiveChat) => void;
  onPlayer?: (player: PresenceCity) => void;
  onPlayerRemoved?: (id: string) => void;
  onViewPlayers?: (rect: ViewRect, players: PresenceCity[], shared?: { targets?: unknown[]; occupiers?: Record<string, string>; clusters?: { id: string; kind: "resource" | "monster"; position: { x: number; y: number }; count: number }[] }) => void;
  onViewClusters?: (clusters: { id: string; kind: "resource" | "monster"; position: { x: number; y: number }; count: number }[]) => void;
  onQuadrants?: (info: { open: number[]; counts: number[]; capacity: number }) => void;
  onSearchResult?: (result: { kind: string; level: number; index: number; total: number; target: unknown | null }) => void;
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
      if (d.type === "snapshot") this.handlers.onSnapshot?.(d.you, d.players || [], d.chat || [], d.dms || {}, d.reports || [], d.marches || [], { dmFavs: Array.isArray(d.dmFavs) ? d.dmFavs : [] });
      else if (d.type === "chat") this.handlers.onChat?.(d.msg);
      else if (d.type === "dm") this.handlers.onDM?.(d.key, d.msg);
      else if (d.type === "player") this.handlers.onPlayer?.(d.player);
      else if (d.type === "player_removed") this.handlers.onPlayerRemoved?.(d.id);
      else if (d.type === "view_players") this.handlers.onViewPlayers?.(d.rect, d.players || [],
        Array.isArray(d.targets) ? { targets: d.targets, occupiers: d.occupiers || {} } : Array.isArray(d.clusters) ? { clusters: d.clusters } : undefined);
      else if (d.type === "view_clusters") this.handlers.onViewClusters?.(d.clusters || []);
      else if (d.type === "search_result") this.handlers.onSearchResult?.(d);
      else if (d.type === "quadrants") this.handlers.onQuadrants?.(d);
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
  sendDM(to: string, text: string, intel?: unknown, toName?: string) { this.send({ type: "dm", to, text, ...(toName ? { toName } : {}), ...(intel ? { intel } : {}) }); }
  /** Delete a DM thread for you (history included); a newer message starts it fresh. */
  sendDMHide(partner: string) { this.send({ type: "dm_hide", with: partner }); }
  /** Pin / unpin a DM at the top of your Direct list. */
  sendDMFav(partner: string, on: boolean) { this.send({ type: "dm_fav", with: partner, on }); }
  sendScout(to: string) { this.send({ type: "scout", to }); }
  sendMarch(to: string) { this.send({ type: "march", to }); }
  // Map view query: never queued (a stale view is useless); resent after reconnect.
  sendView(rect: ViewRect, strategic = false, detail?: boolean) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) { try { this.ws.send(JSON.stringify({ type: "view", rect, strategic, detail })); } catch {} }
  }
  // Shared-world Search: nearest free target of a kind/level from home; `index` walks outward.
  sendSearch(kind: string, level: number, index: number) { this.send({ type: "search", kind, level, index }); }
  sendPresence(p: { name?: string; might?: number; keepLevel?: number; faction?: string | null; cosmetics?: unknown; avatar?: string | null }) {
    this.send({ type: "presence", ...p });
  }
  close() { this.closed = true; try { this.ws?.close(); } catch {} }
}
