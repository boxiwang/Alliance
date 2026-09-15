import { useEffect, useMemo, useRef, useState } from "react";
import type { Profile } from "./lib/profile";
import { loadCosmeticVault, loadPlayerAccount, type ChatSignalId } from "./lib/player-account";
import NameSignal from "./NameSignal";
import { RealtimeClient, type LiveChat, type PresenceCity } from "./lib/realtime";
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
export default function MiniComms({ address, profile, onOpenMessages }: { address: string; profile: Profile; onOpenMessages: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState("");
  const [live, setLive] = useState<LiveChat[]>(() => cachedComms(address).live);
  const [roster, setRoster] = useState<PresenceCity[]>(() => cachedComms(address).roster);
  const [connected, setConnected] = useState(false);
  const [unread, setUnread] = useState(0);
  const rtRef = useRef<RealtimeClient | null>(null);
  const composingRef = useRef(false);
  const expandedRef = useRef(expanded);
  // Clear unread whenever the widget is opened; the ref lets the socket handler
  // (bound once) read the current open/closed state without re-subscribing.
  useEffect(() => { expandedRef.current = expanded; if (expanded) setUnread(0); }, [expanded]);
  const account = useMemo(() => loadPlayerAccount(address), [address]);
  const ownNameSignal = useMemo(() => loadCosmeticVault(address).equipped.chatSignal, [address]);

  useEffect(() => {
    const rt = new RealtimeClient(address, profile.name || "Commander");
    rtRef.current = rt;
    rt.handlers.onSnapshot = (_you, players, chat) => {
      cacheComms(address, { live: chat, roster: players });
      setLive(chat); setRoster(players);
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
    rt.sendPresence({ name: profile.name, faction: profile.factionSymbol || null, cosmetics: loadCosmeticVault(address).equipped });
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

  if (!expanded) return <aside className="mini-comms collapsed" aria-label="Quick communications">
    <button className="mini-comms-peek" onClick={() => toggleExpanded(true)}>
      <span className="mini-comms-mark">✦</span>
      <span className="mini-comms-peek-copy"><small>◎ COSMOS // {connected ? "LIVE" : "…"}</small><b><em>{latest ? <NameSignal signal={latest.pid === address ? ownNameSignal : ((latest.signal as ChatSignalId | null) ?? null)} mode="demo" reducedMotion={account.reducedMotion}>{latest.name}</NameSignal> : ""}</em>{latest?.text || "No transmissions yet — say hello."}</b></span>
      {unread > 0 && <span className="mini-comms-unread">{unread}</span>}
      <span className="mini-comms-chevron">⌃</span>
    </button>
  </aside>;

  return <aside className="mini-comms expanded" aria-label="Quick communications">
    <header>
      <div><span>✦</span><b>COSMOS // LIVE</b><small>{connected ? `${onlineCount} online` : "connecting…"}</small></div>
      <div><button onClick={onOpenMessages}>OPEN COMMS ↗</button><button aria-label="Collapse quick communications" onClick={() => toggleExpanded(false)}>⌄</button></div>
    </header>
    <div className="mini-comms-stream">
      {messages.map((message) => <div className={`mini-comms-message${message.pid === address ? " own" : ""}`} key={message.id}>
        <span className="mini-comms-avatar">{(message.name || "?").slice(0, 1)}</span>
        <div><small><b><NameSignal signal={message.pid === address ? ownNameSignal : ((message.signal as ChatSignalId | null) ?? null)} mode="demo" reducedMotion={account.reducedMotion}>{message.name}</NameSignal></b><time>{messageTime(message.ts)}</time></small><p>{message.text}</p></div>
      </div>)}
      {messages.length === 0 && <div className="mini-comms-empty">No transmissions yet — be the first to signal the frontier.</div>}
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
