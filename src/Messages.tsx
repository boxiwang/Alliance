import { FormEvent, useMemo, useState } from "react";
import type { Profile } from "./lib/profile";
import { mightBreakdown, project, totalTroops, worldMarchSlots } from "./lib/game";
import { initGame, loadGame } from "./lib/gamestore";
import { loadLocalWorldSession } from "./lib/world-adapter";
import { energyAt } from "./lib/world-engine";
import GameNav from "./GameNav";
import CosmicBackdrop from "./CosmicBackdrop";

type ChannelId = "alliance" | "world" | "system" | "dm-nyx" | "dm-whale";
type ChatMessage = { id: string; author: string; time: string; body: string; tag?: string; own?: boolean; event?: "rally" | "coords" };

const CHANNELS: Array<{ id: ChannelId; group: "channels" | "direct"; icon: string; label: string; detail: string; unread?: number; online?: boolean }> = [
  { id: "alliance", group: "channels", icon: "◇", label: "Alliance", detail: "ORBITAL", unread: 8 },
  { id: "world", group: "channels", icon: "◎", label: "World", detail: "SECTOR 00DEV1", unread: 3 },
  { id: "system", group: "channels", icon: "⌁", label: "System", detail: "COMBAT · BUILD · ECONOMY", unread: 1 },
  { id: "dm-nyx", group: "direct", icon: "N", label: "NyxValidator", detail: "online", online: true },
  { id: "dm-whale", group: "direct", icon: "W", label: "WhaleSignal", detail: "12m ago" },
];

const THREADS: Record<ChannelId, ChatMessage[]> = {
  alliance: [
    { id: "a1", author: "SYSTEM", time: "19:42", tag: "PINNED", body: "Wormhole watch begins at 20:00 UTC. Keep one fleet available." },
    { id: "a2", author: "NyxValidator", time: "19:47", tag: "OFFICER", body: "Rogue activity is rising on the east arc. Farm west until the rally leaves." },
    { id: "a3", author: "WhaleSignal", time: "19:51", body: "Shared a target", event: "coords" },
    { id: "a4", author: "Ruglord1070273", time: "19:53", body: "I can cover the second march. Send the rally when ready.", own: true },
    { id: "a5", author: "NyxValidator", time: "19:55", tag: "RALLY", body: "WORMHOLE SENTINEL · L18", event: "rally" },
  ],
  world: [
    { id: "w1", author: "[PEPE] GreenOrbit", time: "19:38", body: "Cash planets respawned around the north-west arc." },
    { id: "w2", author: "[DOGE] MuchCommand", time: "19:44", body: "Anyone else seeing the L12 Rogue cluster near 312:094?" },
    { id: "w3", author: "[ORBT] NyxValidator", time: "19:48", body: "Yes. Public signal confirmed — leave the occupied Power planet alone." },
    { id: "w4", author: "[MOG] VoidCat", time: "19:52", body: "GG to whoever defended 201:177 with half a fleet." },
  ],
  system: [
    { id: "s1", author: "FLEET", time: "19:57", tag: "RETURNED", body: "Harvest complete · Oil Planet L7 · +4.20M Oil" },
    { id: "s2", author: "COMBAT", time: "19:31", tag: "VICTORY", body: "Rogue Planet L6 defeated · 1.20K wounded · report ready" },
    { id: "s3", author: "CITY", time: "18:46", tag: "COMPLETE", body: "Research Institute reached L8" },
    { id: "s4", author: "SECURITY", time: "17:20", tag: "SHIELD", body: "Civilization shield has 1d 12h remaining" },
  ],
  "dm-nyx": [
    { id: "n1", author: "NyxValidator", time: "19:21", body: "Are you joining the Wormhole watch tonight?" },
    { id: "n2", author: "Ruglord1070273", time: "19:24", body: "Yes. I should have two fleets free by then.", own: true },
    { id: "n3", author: "NyxValidator", time: "19:25", body: "Perfect. I’ll put you on the east approach." },
  ],
  "dm-whale": [
    { id: "p1", author: "WhaleSignal", time: "18:02", body: "Found an unoccupied L8 Cash planet. Sending coordinates." },
    { id: "p2", author: "WhaleSignal", time: "18:03", body: "TARGET · 284:119", event: "coords" },
    { id: "p3", author: "Ruglord1070273", time: "18:05", body: "Saved. Thanks.", own: true },
  ],
};

export default function Messages({ address, profile, onCity, onWorld }: { address: string; profile: Profile; onCity: () => void; onWorld: () => void }) {
  const [channelId, setChannelId] = useState<ChannelId>("alliance");
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState<Record<ChannelId, ChatMessage[]>>({ alliance: [], world: [], system: [], "dm-nyx": [], "dm-whale": [] });
  const now = Date.now();
  const game = project(loadGame(address) || initGame(address), now);
  const stored = loadLocalWorldSession(address);
  const player = stored?.world.players[stored.playerId];
  const city = player ? stored?.world.entities[player.cityId] : null;
  const activeFleets = player ? Object.values(stored!.world.marches).filter((march) => march.playerId === player.id && !["completed", "failed"].includes(march.state)).length : 0;
  const energy = player ? energyAt(player, now, stored!.world.config) : 100;
  const energyCap = stored?.world.config.energyCap ?? 100;
  const fleetCap = player?.marchSlots ?? worldMarchSlots(game);
  const location = city?.kind === "city"
    ? `SECTOR ${stored!.world.stateId.slice(-6).toUpperCase()} · HOME ${Math.round(city.position.x).toString().padStart(3, "0")}:${Math.round(city.position.y).toString().padStart(3, "0")}`
    : "SECTOR 00DEV1 · HOME ---:---";
  const channel = CHANNELS.find((item) => item.id === channelId)!;
  const messages = [...THREADS[channelId], ...sent[channelId]];
  const isSystem = channelId === "system";
  const context = useMemo(() => channelId === "alliance" ? "alliance" : channelId === "world" ? "world" : channelId === "system" ? "system" : "direct", [channelId]);

  function submit(event: FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || isSystem) return;
    const message: ChatMessage = { id: `local-${Date.now()}`, author: profile.name, time: "NOW", body, own: true };
    setSent((current) => ({ ...current, [channelId]: [...current[channelId], message] }));
    setDraft("");
  }

  return <section className="messages-page">
    <CosmicBackdrop />
    <GameNav view="messages" profile={profile} townhallLevel={game.buildings.keep.lvl} location={location}
      resources={game.res} energy={energy} energyCap={energyCap} activeFleets={activeFleets} fleetCap={fleetCap}
      standing={totalTroops(game)} wounded={game.wounded} might={mightBreakdown(game).total}
      onCity={onCity} onWorld={onWorld} onMessages={() => {}} />
    <div className="messages-shell">
      <aside className="messages-rail">
        <header><span>COMMS</span><button aria-label="New direct message">＋</button></header>
        <label className="messages-search"><span>⌕</span><input aria-label="Search messages" placeholder="Search" /></label>
        <ChannelGroup title="CHANNELS" channels={CHANNELS.filter((item) => item.group === "channels")} active={channelId} onSelect={setChannelId} />
        <ChannelGroup title="DIRECT MESSAGES" channels={CHANNELS.filter((item) => item.group === "direct")} active={channelId} onSelect={setChannelId} />
        <div className="messages-voice"><i /><div><b>VOICE LINK</b><span>3 connected</span></div><button>JOIN</button></div>
      </aside>

      <main className="messages-thread">
        <header className="messages-thread-head">
          <div><span>{channel.icon}</span><div><b>{channel.label}</b><small>{channel.detail}</small></div></div>
          <nav><button>⌕</button><button>⋯</button></nav>
        </header>
        {channelId === "alliance" && <div className="messages-pinned"><span>PINNED ORDER</span><b>Hold the east Wormhole approach · 20:00 UTC</b><button>VIEW</button></div>}
        <div className={`messages-stream ${isSystem ? "system-stream" : ""}`}>
          <div className="messages-day"><span>TODAY · SEPT 8</span></div>
          {messages.map((message) => <MessageRow key={message.id} message={message} system={isSystem} />)}
        </div>
        {!isSystem ? <form className="messages-compose" onSubmit={submit}>
          <button type="button" aria-label="Add attachment">＋</button>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} aria-label={`Message ${channel.label}`} placeholder={`Message ${channel.label}`} />
          <button type="button" aria-label="Add emoji">☺</button>
          <button className="send" aria-label="Send message">➤</button>
        </form> : <div className="messages-system-footer"><span>System events are generated by verified game actions.</span><button>FILTER</button></div>}
      </main>

      <aside className="messages-context">
        {context === "alliance" && <AllianceContext />}
        {context === "world" && <WorldContext />}
        {context === "system" && <SystemContext />}
        {context === "direct" && <DirectContext channel={channel} />}
      </aside>
    </div>
  </section>;
}

function ChannelGroup({ title, channels, active, onSelect }: { title: string; channels: typeof CHANNELS; active: ChannelId; onSelect: (id: ChannelId) => void }) {
  return <section className="channel-group"><h3>{title}</h3>{channels.map((channel) => <button className={active === channel.id ? "active" : ""} onClick={() => onSelect(channel.id)} key={channel.id}>
    <span className="channel-glyph">{channel.icon}{channel.online && <i />}</span><span><b>{channel.label}</b><small>{channel.detail}</small></span>{channel.unread ? <em>{channel.unread}</em> : null}
  </button>)}</section>;
}

function MessageRow({ message, system }: { message: ChatMessage; system: boolean }) {
  if (system) return <article className="system-event"><span className={`system-icon ${message.author.toLowerCase()}`}>{message.author.slice(0, 1)}</span><div><header><b>{message.author}</b><em>{message.tag}</em><time>{message.time}</time></header><p>{message.body}</p></div><button>VIEW</button></article>;
  return <article className={`chat-message ${message.own ? "own" : ""}`}>
    <span className="chat-avatar">{message.author.slice(0, 1)}</span><div><header><b>{message.author}</b>{message.tag && <em>{message.tag}</em>}<time>{message.time}</time></header><p>{message.body}</p>
      {message.event === "coords" && <button className="chat-coords"><span>◎</span><b>284:119</b><small>OPEN ON STAR MAP</small></button>}
      {message.event === "rally" && <button className="chat-rally"><span>⚔</span><div><b>JOIN RALLY</b><small>02:14 · 3/8 fleets</small></div><strong>OPEN</strong></button>}
    </div>
  </article>;
}

function AllianceContext() { return <><ContextHead eyebrow="ALLIANCE" title="ORBITAL" detail="[ORBT] · 184 members" /><div className="alliance-presence"><span><i />38 ONLINE</span><b>RANK #12</b></div><ContextSection title="OBJECTIVE"><div className="context-objective"><span>WORMHOLE CONTROL</span><b>68%</b><i><em /></i><small>17h 24m held this cycle</small></div></ContextSection><ContextSection title="ONLINE NOW"><Roster name="NyxValidator" role="OFFICER"/><Roster name="WhaleSignal" role="VANGUARD"/><Roster name="VoidRunner" role="MEMBER"/><button className="context-link">VIEW ALL 38</button></ContextSection><ContextSection title="QUICK LINKS"><button className="context-action">⚔ Rally board <span>3</span></button><button className="context-action">◎ Alliance coordinates</button><button className="context-action">▤ Shared reports</button></ContextSection></>; }
function WorldContext() { return <><ContextHead eyebrow="PUBLIC NETWORK" title="SECTOR 00DEV1" detail="1,024 civilizations"/><ContextSection title="ACTIVE REGIONS"><Signal label="North-west arc" value="HIGH TRAFFIC" tone="green"/><Signal label="Wormhole perimeter" value="CONTESTED" tone="red"/><Signal label="Outer south rim" value="QUIET" tone="blue"/></ContextSection><ContextSection title="WORLD RULES"><p className="context-copy">Public messages are visible across this World State. Coordinates and reports can be shared directly into the Star Map.</p><button className="context-link">COMMUNITY RULES</button></ContextSection></>; }
function SystemContext() { return <><ContextHead eyebrow="ACCOUNT LOG" title="SYSTEM" detail="Verified game events"/><ContextSection title="VISIBLE EVENTS"><label className="context-check"><input type="checkbox" defaultChecked/> Combat</label><label className="context-check"><input type="checkbox" defaultChecked/> Fleets</label><label className="context-check"><input type="checkbox" defaultChecked/> City &amp; research</label><label className="context-check"><input type="checkbox" defaultChecked/> Alliance activity</label></ContextSection><ContextSection title="UNREAD"><div className="system-count"><b>1</b><span>new event</span></div><button className="context-link">MARK ALL READ</button></ContextSection></>; }
function DirectContext({ channel }: { channel: (typeof CHANNELS)[number] }) { return <><ContextHead eyebrow="DIRECT MESSAGE" title={channel.label} detail={channel.detail}/><div className="direct-profile"><span>{channel.icon}</span><b>CORE 17</b><small>[ORBT] ORBITAL</small></div><ContextSection title="PLAYER"><Signal label="Might" value="24.8M" tone="gold"/><Signal label="Last seen" value={channel.online ? "ONLINE" : "12M AGO"} tone={channel.online ? "green" : "blue"}/></ContextSection><ContextSection title="ACTIONS"><button className="context-action">◎ View civilization</button><button className="context-action">☆ Add contact</button><button className="context-action danger">! Block / report</button></ContextSection></>; }
function ContextHead({ eyebrow, title, detail }: { eyebrow: string; title: string; detail: string }) { return <header className="context-head"><span>{eyebrow}</span><b>{title}</b><small>{detail}</small></header>; }
function ContextSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="context-section"><h3>{title}</h3>{children}</section>; }
function Roster({ name, role }: { name: string; role: string }) { return <div className="context-roster"><span>{name.slice(0, 1)}<i /></span><div><b>{name}</b><small>{role}</small></div></div>; }
function Signal({ label, value, tone }: { label: string; value: string; tone: string }) { return <div className="context-signal"><span>{label}</span><b className={tone}>{value}</b></div>; }
