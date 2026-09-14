import { useEffect, useMemo, useRef, useState } from "react";
import type { Profile } from "./lib/profile";
import { loadCosmeticVault, loadPlayerAccount } from "./lib/player-account";
import NameSignal from "./NameSignal";
import { RealtimeClient, type LiveChat, type PresenceCity } from "./lib/realtime";
import { playSfx, SFX_CHAT_SEND, SFX_CHAT_SEND_VOLUME } from "./lib/sfx";

function messageTime(ts: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(ts));
}

// Quick live peek at the shared Cosmos channel (same backend as the Comms page).
// No seeded/placeholder messages; DMs + other channels live in full Comms.
export default function MiniComms({ address, profile, onOpenMessages }: { address: string; profile: Profile; onOpenMessages: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState<LiveChat[]>([]);
  const [roster, setRoster] = useState<PresenceCity[]>([]);
  const [connected, setConnected] = useState(false);
  const [unread, setUnread] = useState(0);
  const rtRef = useRef<RealtimeClient | null>(null);
  const expandedRef = useRef(expanded);
  // Clear unread whenever the widget is opened; the ref lets the socket handler
  // (bound once) read the current open/closed state without re-subscribing.
  useEffect(() => { expandedRef.current = expanded; if (expanded) setUnread(0); }, [expanded]);
  const account = useMemo(() => loadPlayerAccount(address), [address]);
  const ownNameSignal = useMemo(() => loadCosmeticVault(address).equipped.chatSignal, [address]);

  useEffect(() => {
    const rt = new RealtimeClient(address, profile.name || "Commander");
    rtRef.current = rt;
    rt.handlers.onSnapshot = (_you, players, chat) => { setLive(chat); setRoster(players); };
    rt.handlers.onChat = (m) => {
      setLive((cur) => [...cur, m].slice(-40));
      if (!expandedRef.current && m.pid !== address) setUnread((n) => Math.min(n + 1, 99));
    };
    rt.handlers.onPlayer = (p) => setRoster((cur) => {
      const i = cur.findIndex((x) => x.id === p.id);
      if (i < 0) return [...cur, p];
      const next = cur.slice(); next[i] = p; return next;
    });
    rt.handlers.onStatus = setConnected;
    rt.sendPresence({ name: profile.name, faction: profile.factionSymbol || null });
    return () => rt.close();
  }, [address, profile.name, profile.factionSymbol]);

  const onlineCount = useMemo(() => roster.filter((p) => p.online).length, [roster]);
  const messages = useMemo(() => live.slice(-4), [live]);
  const latest = messages[messages.length - 1];

  function transmit() {
    const body = draft.trim();
    if (!body) return;
    rtRef.current?.sendChat(body);
    if (account.soundEnabled) playSfx(SFX_CHAT_SEND, SFX_CHAT_SEND_VOLUME * account.sfxVolume);
    setDraft("");
  }

  if (!expanded) return <aside className="mini-comms collapsed" aria-label="Quick communications">
    <button className="mini-comms-peek" onClick={() => setExpanded(true)}>
      <span className="mini-comms-mark">✦</span>
      <span className="mini-comms-peek-copy"><small>◎ COSMOS // {connected ? "LIVE" : "…"}</small><b><em>{latest?.pid === address ? <NameSignal signal={ownNameSignal} mode="demo" reducedMotion={account.reducedMotion}>{latest.name}</NameSignal> : latest?.name || ""}</em>{latest?.text || "No transmissions yet — say hello."}</b></span>
      {unread > 0 && <span className="mini-comms-unread">{unread}</span>}
      <span className="mini-comms-chevron">⌃</span>
    </button>
  </aside>;

  return <aside className="mini-comms expanded" aria-label="Quick communications">
    <header>
      <div><span>✦</span><b>COSMOS // LIVE</b><small>{connected ? `${onlineCount} online` : "connecting…"}</small></div>
      <div><button onClick={onOpenMessages}>OPEN COMMS ↗</button><button aria-label="Collapse quick communications" onClick={() => setExpanded(false)}>⌄</button></div>
    </header>
    <div className="mini-comms-stream">
      {messages.map((message) => <div className={`mini-comms-message${message.pid === address ? " own" : ""}`} key={message.id}>
        <span className="mini-comms-avatar">{(message.name || "?").slice(0, 1)}</span>
        <div><small><b>{message.pid === address ? <NameSignal signal={ownNameSignal} mode="demo" reducedMotion={account.reducedMotion}>{message.name}</NameSignal> : message.name}</b><time>{messageTime(message.ts)}</time></small><p>{message.text}</p></div>
      </div>)}
      {messages.length === 0 && <div className="mini-comms-empty">No transmissions yet — be the first to signal the frontier.</div>}
    </div>
    <div className="mini-comms-compose">
      <span>◎</span>
      <input aria-label="Transmit to Cosmos" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") transmit(); }} placeholder="Signal the cosmos…" maxLength={280} />
      <button disabled={!draft.trim()} onClick={transmit}>TRANSMIT</button>
    </div>
  </aside>;
}
