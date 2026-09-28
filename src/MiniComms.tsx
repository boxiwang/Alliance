import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { Profile } from "./lib/profile";
import { loadCosmeticVault, loadPlayerAccount } from "./lib/player-account";
import { RealtimeClient, type LiveChat, type PresenceCity, type ServerReport, type LiveMarch } from "./lib/realtime";
import { playSfx, SFX_CHAT_SEND, SFX_CHAT_SEND_VOLUME, SFX_CHANNEL_SWITCH, SFX_CHANNEL_SWITCH_VOLUME } from "./lib/sfx";
import { trackEvents } from "./lib/backend";
import { shouldSubmitTextEntry } from "./lib/ime";

function messageTime(ts: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts));
}

// Town, Star Map and Alliance mount their own MiniComms instance. Keep the last
// live payload in module memory so switching tabs never flashes an empty feed
// while the replacement socket is waiting for its snapshot.
const miniCommsCache = new Map<string, { live: LiveChat[]; roster: PresenceCity[] }>();

function cachedComms(address: string) {
  return miniCommsCache.get(address.toLowerCase()) || { live: [], roster: [] };
}

function cacheComms(address: string, patch: Partial<{ live: LiveChat[]; roster: PresenceCity[] }>) {
  const key = address.toLowerCase();
  miniCommsCache.set(key, { ...cachedComms(key), ...patch });
}

// Quick live peek at the shared Cosmos channel (same backend as the Comms page).
// No seeded/placeholder messages; DMs + other channels live in full Comms.
// Draggable dock: one shared position for every page (per device, browser storage).
// Anchored by the bottom-left corner (x, gap to the viewport bottom): expanding
// grows the panel upward and collapsing returns it to the exact same spot.
const DOCK_POS_KEY = "alliance:mini-comms-anchor";
type DockPosition = { x: number; bottom: number };
function loadDockPosition(): DockPosition | null {
  try {
    const raw = JSON.parse(localStorage.getItem(DOCK_POS_KEY) || "null");
    return raw && Number.isFinite(raw.x) && Number.isFinite(raw.bottom) ? { x: raw.x, bottom: raw.bottom } : null;
  } catch { return null; }
}
function saveDockPosition(position: DockPosition | null) {
  try { position ? localStorage.setItem(DOCK_POS_KEY, JSON.stringify(position)) : localStorage.removeItem(DOCK_POS_KEY); } catch {}
}
const dockDraggable = () => typeof window !== "undefined" && window.innerWidth >= 700;

export default function MiniComms({ address, profile, onOpenMessages, onReport, onMarch, onMarchDone, onMarchSnapshot }: {
  address: string; profile: Profile; onOpenMessages: () => void;
  onReport?: (report: ServerReport) => void;
  onMarch?: (march: LiveMarch) => void;
  onMarchDone?: (id: string) => void;
  onMarchSnapshot?: (you: string, marches: LiveMarch[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState<LiveChat[]>(() => cachedComms(address).live);
  const [roster, setRoster] = useState<PresenceCity[]>(() => cachedComms(address).roster);
  const [connected, setConnected] = useState(false);
  const [unread, setUnread] = useState(0);
  const rtRef = useRef<RealtimeClient | null>(null);
  const composingRef = useRef(false);
  const dockRef = useRef<HTMLElement>(null);
  const [dockPos, setDockPos] = useState<DockPosition | null>(loadDockPosition);
  const dragRef = useRef<{ startX: number; startY: number; originX: number; originBottom: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [, forceLayout] = useState(0);
  const clampDock = (x: number, bottom: number): DockPosition => {
    const rect = dockRef.current?.getBoundingClientRect();
    const w = rect?.width ?? 390, h = rect?.height ?? 64, pad = 8;
    return { x: Math.round(Math.max(pad, Math.min(window.innerWidth - w - pad, x))), bottom: Math.round(Math.max(pad, Math.min(window.innerHeight - h - pad, bottom))) };
  };
  function onDockPointerDown(event: ReactPointerEvent<HTMLElement>) {
    if (!dockDraggable() || event.button !== 0 || (event.target as HTMLElement).closest("input, [data-no-drag]")) return;
    const rect = dockRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { startX: event.clientX, startY: event.clientY, originX: rect.left, originBottom: window.innerHeight - rect.bottom, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onDockPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX, dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    setDockPos(clampDock(drag.originX + dx, drag.originBottom - dy));
  }
  function onDockPointerUp() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag?.moved) return;
    suppressClick.current = true; // the click that ends a drag must not toggle the dock
    setDockPos((current) => { saveDockPosition(current); return current; });
  }
  function resetDock() { setDockPos(null); saveDockPosition(null); }
  // Keep the dock on-screen without moving the saved anchor: a tall expanded
  // panel near the top is nudged down for display only, so collapsing lands
  // back on the anchor.
  useLayoutEffect(() => {
    const el = dockRef.current;
    if (!el || !dockPos || !dockDraggable()) return;
    const shown = clampDock(dockPos.x, dockPos.bottom);
    el.style.left = `${shown.x}px`;
    el.style.bottom = `${shown.bottom}px`;
  });
  useEffect(() => {
    const onResize = () => forceLayout((n) => n + 1);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const dockStyle = dockPos && dockDraggable() ? { left: dockPos.x, bottom: dockPos.bottom, top: "auto", right: "auto" } : undefined;
  const dragHandlers = { onPointerDown: onDockPointerDown, onPointerMove: onDockPointerMove, onPointerUp: onDockPointerUp, onPointerCancel: onDockPointerUp };
  const expandedRef = useRef(expanded);
  const reportRef = useRef(onReport);
  const marchEvents = useRef({ onMarch, onMarchDone, onMarchSnapshot });
  marchEvents.current = { onMarch, onMarchDone, onMarchSnapshot };
  // Clear unread whenever the widget is opened; the ref lets the socket handler
  // (bound once) read the current open/closed state without re-subscribing.
  useEffect(() => { expandedRef.current = expanded; if (expanded) setUnread(0); }, [expanded]);
  useEffect(() => { reportRef.current = onReport; }, [onReport]);
  const account = useMemo(() => loadPlayerAccount(address), [address]);

  useEffect(() => {
    const rt = new RealtimeClient(address, profile.name || "Commander");
    rtRef.current = rt;
    rt.handlers.onSnapshot = (you, players, chat, _dms, reports, marches) => {
      cacheComms(address, { live: chat, roster: players });
      setLive(chat); setRoster(players);
      reports.forEach((report) => reportRef.current?.(report));
      marchEvents.current.onMarchSnapshot?.(you, marches);
    };
    rt.handlers.onChat = (m) => {
      setLive((cur) => {
        const next = [...cur, m].slice(-40);
        cacheComms(address, { live: next });
        return next;
      });
      if (!expandedRef.current && m.pid !== address) setUnread((n) => Math.min(n + 1, 99));
    };
    rt.handlers.onPlayer = (p) => setRoster((cur) => {
      const i = cur.findIndex((x) => x.id === p.id);
      const next = i < 0 ? [...cur, p] : cur.slice();
      if (i >= 0) next[i] = p;
      cacheComms(address, { roster: next });
      return next;
    });
    rt.handlers.onStatus = setConnected;
    rt.handlers.onReport = (report) => reportRef.current?.(report);
    rt.handlers.onMarch = (march) => marchEvents.current.onMarch?.(march);
    rt.handlers.onMarchDone = (id) => marchEvents.current.onMarchDone?.(id);
    rt.sendPresence({ name: profile.name, faction: profile.factionSymbol || null, cosmetics: loadCosmeticVault(address).equipped, avatar: profile.avatarId || "genesis" });
    return () => rt.close();
  }, [address, profile.name, profile.factionSymbol]);

  const onlineCount = useMemo(() => roster.filter((p) => p.online).length, [roster]);
  const messages = useMemo(() => live.slice(-4), [live]);
  const latest = messages[messages.length - 1];

  function transmit() {
    const body = draft.trim();
    if (!body) return;
    rtRef.current?.sendChat(body);
    void trackEvents(address, [{ name: "chat.message_sent", page: "mini_chat", properties: { channel: "cosmos" } }]).catch(() => {});
    if (account.soundEnabled) playSfx(SFX_CHAT_SEND, SFX_CHAT_SEND_VOLUME * account.sfxVolume);
    setDraft("");
  }
  function toggleExpanded(next: boolean) {
    if (account.soundEnabled) playSfx(SFX_CHANNEL_SWITCH, SFX_CHANNEL_SWITCH_VOLUME * account.sfxVolume);
    setExpanded(next);
  }

  if (!expanded) return <aside ref={dockRef} className={`mini-comms collapsed${dockPos ? " moved" : ""}`} style={dockStyle} aria-label="Quick communications">
    <button className="mini-comms-peek" {...dragHandlers} onClick={() => { if (suppressClick.current) { suppressClick.current = false; return; } toggleExpanded(true); }}>
      <span className="mini-comms-mark">✦</span>
      <span className="mini-comms-peek-copy"><small>◎ COSMOS // {connected ? "LIVE" : "…"}</small>{latest ? <b><em><span className="mini-comms-name">{latest.name}</span></em>{latest.text}</b> : <b className="quiet">CHANNEL QUIET</b>}</span>
      {unread > 0 && <span className="mini-comms-unread">{unread}</span>}
      <span className="mini-comms-chevron">⌃</span>
    </button>
  </aside>;

  return <aside ref={dockRef} className={`mini-comms expanded${dockPos ? " moved" : ""}`} style={dockStyle} aria-label="Quick communications">
    <header className="mini-comms-drag" {...dragHandlers}>
      <div><span>✦</span><b>COSMOS // LIVE</b><small>{connected ? `${onlineCount} online` : "connecting…"}</small></div>
      <div data-no-drag>{dockPos && <button aria-label="Return the dock to its default corner" onClick={resetDock}>⌖</button>}<button onClick={onOpenMessages}>OPEN COMMS ↗</button><button aria-label="Collapse quick communications" onClick={() => toggleExpanded(false)}>⌄</button></div>
    </header>
    <div className="mini-comms-stream">
      {messages.map((message) => <div className={`mini-comms-message${message.pid === address ? " own" : ""}`} key={message.id}>
        <span className="mini-comms-avatar">{(message.name || "?").slice(0, 1)}</span>
        <div><small><b><span className="mini-comms-name">{message.name}</span></b><time>{messageTime(message.ts)}</time></small><p>{message.text}</p></div>
      </div>)}
      {messages.length === 0 && <div className="mini-comms-empty">CHANNEL QUIET</div>}
    </div>
    <div className="mini-comms-compose">
      <span>◎</span>
      <input
        aria-label="Transmit to Cosmos"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onCompositionStart={() => { composingRef.current = true; }}
        onCompositionEnd={() => { composingRef.current = false; }}
        onKeyDown={(event) => { if (shouldSubmitTextEntry(event.nativeEvent, composingRef.current)) transmit(); }}
        placeholder="Signal the cosmos…"
        maxLength={280}
      />
      <button disabled={!draft.trim()} onClick={transmit}>TRANSMIT</button>
    </div>
  </aside>;
}
