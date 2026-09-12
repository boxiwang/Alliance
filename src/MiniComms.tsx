import { useEffect, useMemo, useState } from "react";
import type { Profile } from "./lib/profile";
import { loadPlayerAccount } from "./lib/player-account";
import {
  appendLocalCommsMessage, loadLocalComms, LOCAL_COMMS_CHANGED_EVENT,
  type LocalCommsMessage, type LocalCommsStore,
} from "./lib/comms-local";

type QuickChannelId = "cosmos" | "general" | "dm-nyx";

const CHANNELS: Array<{ id: QuickChannelId; icon: string; label: string; signal: string }> = [
  { id: "cosmos", icon: "◎", label: "COSMOS", signal: "PUBLIC" },
  { id: "general", icon: "◇", label: "ALLIANCE", signal: "ORBT" },
  { id: "dm-nyx", icon: "◌", label: "DIRECT", signal: "NYX" },
];

const SEED: Record<QuickChannelId, LocalCommsMessage[]> = {
  cosmos: [
    { a: "NyxValidator", f: "ORBT", t: "19:48", b: "confirmed via scout — leave the occupied Power planet alone" },
    { a: "VoidCat", f: "MOG", t: "19:52", b: "gg to whoever held 201:177 with half a fleet 🫡" },
  ],
  general: [
    { a: "WhaleSignal", f: "MOG", t: "19:51", b: "Target vector relayed · 284:119" },
    { a: "NyxValidator", f: "ORBT", t: "19:55", b: "Wormhole watch forming. Keep one fleet free." },
  ],
  "dm-nyx": [
    { a: "Ruglord", f: "ORBT", own: true, t: "19:24", b: "Yes, two fleets free by then." },
    { a: "NyxValidator", f: "ORBT", t: "19:25", b: "Perfect — you're on the east approach." },
  ],
};

function messageTime(): string {
  return new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date());
}

export default function MiniComms({ address, profile, onOpenMessages }: { address: string; profile: Profile; onOpenMessages: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState<QuickChannelId>("general");
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState<LocalCommsStore>(() => loadLocalComms(address));

  useEffect(() => {
    const sync = (event: Event) => {
      const changedAddress = (event as CustomEvent<{ address?: string }>).detail?.address;
      if (!changedAddress || changedAddress === address.toLowerCase()) setSent(loadLocalComms(address));
    };
    const storageSync = () => setSent(loadLocalComms(address));
    window.addEventListener(LOCAL_COMMS_CHANGED_EVENT, sync);
    window.addEventListener("storage", storageSync);
    return () => {
      window.removeEventListener(LOCAL_COMMS_CHANGED_EVENT, sync);
      window.removeEventListener("storage", storageSync);
    };
  }, [address]);

  const channel = CHANNELS.find((candidate) => candidate.id === active)!;
  const channelSignal = active === "general" ? profile.factionSymbol || "UNBOUND" : channel.signal;
  const messages = useMemo(() => [...SEED[active], ...(sent[active] ?? [])].filter((message) => !!message.b).slice(-4), [active, sent]);
  const latest = messages[messages.length - 1];

  function transmit() {
    const body = draft.trim();
    if (!body) return;
    const account = loadPlayerAccount(address);
    const message: LocalCommsMessage = {
      id: `quick:${Date.now()}`,
      a: profile.name || "Ruglord",
      f: profile.factionSymbol || "ORBT",
      own: true,
      t: messageTime(),
      b: body,
      sourceLanguage: "auto",
      authorLocale: account.language,
      createdAt: Date.now(),
    };
    setSent(appendLocalCommsMessage(address, active, message));
    setDraft("");
  }

  if (!expanded) return <aside className="mini-comms collapsed" aria-label="Quick communications">
    <button className="mini-comms-peek" onClick={() => setExpanded(true)}>
      <span className="mini-comms-mark">✦</span>
      <span className="mini-comms-peek-copy"><small>{channel.icon} {channel.label} // LIVE</small><b><em>{latest?.a || "SIGNAL ARRAY"}</em>{latest?.b || "No nearby transmissions."}</b></span>
      <span className="mini-comms-unread">12</span>
      <span className="mini-comms-chevron">⌃</span>
    </button>
  </aside>;

  return <aside className="mini-comms expanded" aria-label="Quick communications">
    <header>
      <div><span>✦</span><b>COMMS // QUICKLINK</b><small>THREE RELAYS SYNCHRONIZED</small></div>
      <div><button onClick={onOpenMessages}>OPEN COMMS ↗</button><button aria-label="Collapse quick communications" onClick={() => setExpanded(false)}>⌄</button></div>
    </header>
    <nav aria-label="Quick communication channels">
      {CHANNELS.map((candidate) => <button key={candidate.id} className={active === candidate.id ? "active" : ""} onClick={() => setActive(candidate.id)}>
        <span>{candidate.icon}</span><b>{candidate.label}</b><small>{candidate.id === "general" ? profile.factionSymbol || "UNBOUND" : candidate.signal}</small>
      </button>)}
    </nav>
    <div className="mini-comms-stream">
      {messages.map((message, index) => <div className={`mini-comms-message${message.own ? " own" : ""}`} key={message.id || `${message.a}-${message.t}-${index}`}>
        <span className="mini-comms-avatar">{(message.a || "?").slice(0, 1)}</span>
        <div><small>{message.f && `[${message.f}] `}<b>{message.a}</b><time>{message.t}</time></small><p>{message.b}</p></div>
      </div>)}
    </div>
    <div className="mini-comms-compose">
      <span>{channel.icon}</span>
      <input aria-label={`Transmit to ${channel.label}`} value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") transmit(); }} placeholder={`Signal ${channel.label.toLowerCase()} // ${channelSignal.toLowerCase()}…`} maxLength={280} />
      <button disabled={!draft.trim()} onClick={transmit}>TRANSMIT</button>
    </div>
  </aside>;
}
