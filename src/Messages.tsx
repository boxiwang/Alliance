import { useEffect, useMemo, useState } from "react";
import type { Profile } from "./lib/profile";
import { displayResource, displayTroops, mightBreakdown, project, totalTroops, worldMarchSlots } from "./lib/game";
import { compact } from "./lib/format";
import { initGame, loadGame, saveGame } from "./lib/gamestore";
import { loadLocalWorldSession, openLocalWorldSession, saveLocalWorldSession } from "./lib/world-adapter";
import { energyAt } from "./lib/world-engine";
import { getN } from "./lib/numbers";
import GameNav from "./GameNav";
import CosmicBackdrop from "./CosmicBackdrop";
import PlayerCard, { type PlayerSignal } from "./PlayerCard";
import NameSignal from "./NameSignal";
import { loadCosmeticVault, type ChatSignalId } from "./lib/player-account";
import { loadPlayerAccount } from "./lib/player-account";
import { refreshLocalCommsIntel, saveLocalComms, type LocalCommsMessage } from "./lib/comms-local";
import { clearQueuedCommsShare, loadQueuedCommsShare, queueWorldFocus, sharedIntelIsActive, type SharedWorldIntel } from "./lib/shared-intel";

// Comms is Task-1 chat. This is the frontend + a LOCAL adapter: channels/threads are seeded and
// your own sends echo locally. A server adapter (Cloudflare Durable Objects) replaces the data
// layer later without changing this page — same seam as World's world-adapter.
type ChannelId = "cosmos" | "alliance" | "system" | "contacts" | "dm-nyx" | "dm-whale";
type AllianceTab = "general" | "warroom";
type ChatMessage = LocalCommsMessage;

const FACTION: Record<string, string> = { ORBT: "#38d9ff", PEPE: "#43f2a1", DOGE: "#ffb454", MOG: "#aa82ff", WIF: "#7cc0ff" };
const fcol = (t?: string) => (t && FACTION[t]) || "#8aa9b9";
// War Room is off by default; alliance management spins one up with a fresh history each time.
const ALLIANCE_MANAGEMENT = true;
const WARROOM_ACTIVE = true;

const CHANNELS: Array<{ id: ChannelId; icon: string; label: string; detail: string; unread?: number; mention?: boolean }> = [
  { id: "cosmos", icon: "◎", label: "Cosmos", detail: "Sector 00DEV1", unread: 3 },
  { id: "alliance", icon: "◇", label: "Alliance", detail: "[ORBT] Orbital", unread: 8, mention: true },
  { id: "system", icon: "⌁", label: "System", detail: "", unread: 1 },
];
type DirectThread = { id: ChannelId; icon: string; label: string; detail: string; faction: string; signal: PlayerSignal };
const DMS: DirectThread[] = [
  { id: "dm-nyx", icon: "N", label: "NyxValidator", detail: "online", faction: "ORBT", signal: { username: "NyxValidator", allianceSymbol: "ORBT", title: "RIFT CARTOGRAPHER", wallet: "0x71bE5D5F2B6e17a4b4D0F29c9a807E71b6bAAa01", skin: { id: "solar-imperator", name: "Solar Imperator", rarity: "RELIC" }, nameSignal: "void-whisper", coreLevel: 18, might: 428_500, achievements: [{ mark: "Ⅰ", name: "FIRST LIGHT" }, { mark: "⌁", name: "RIFT WARDEN" }], online: true } },
  { id: "dm-whale", icon: "W", label: "WhaleSignal", detail: "12m ago", faction: "MOG", signal: { username: "WhaleSignal", allianceSymbol: "MOG", title: "EVENT HORIZON", wallet: "0x9a72F0C890e8d413B250021b970Bbb12A998002a", skin: { id: "event-horizon", name: "Event Horizon", rarity: "SOVEREIGN" }, nameSignal: "sovereign-flare", coreLevel: 24, might: 1_820_400, achievements: [{ mark: "◈", name: "WHALE FALL" }, { mark: "◎", name: "MARKET MAKER" }], online: false } },
];
const PLAYER_SIGNALS: Record<string, PlayerSignal> = {
  ...Object.fromEntries(DMS.map((thread) => [thread.label, thread.signal])),
  GreenOrbit: { username: "GreenOrbit", allianceSymbol: "PEPE", title: "CASH BLOOMER", wallet: "0x2E05D571d9a4aB04b082F409870a6A11436E112c", skin: { id: "dust-homestead", name: "Dust Homestead", rarity: "ISSUED" }, nameSignal: "verdant-hail", coreLevel: 11, might: 164_200, achievements: [{ mark: "Ⅰ", name: "FIRST LIGHT" }], online: true },
  VoidRunner: { username: "VoidRunner", allianceSymbol: "ORBT", title: "NAME ERASED", wallet: "0x4A801Bbe20f64391219F043df4374DA0A1b3B7f2", skin: { id: "void-touched", name: "Void-Touched", rarity: "MYTHIC" }, nameSignal: "eclipse-herald", coreLevel: 16, might: 337_900, achievements: [{ mark: "◈", name: "ECHO HUNTER" }, { mark: "⌁", name: "VOID WALKER" }], online: true },
  MuchCommand: { username: "MuchCommand", allianceSymbol: "DOGE", title: "MOON ENGINEER", wallet: "0xD06E51c33Ea18E73908dE0F6b0ACD6e79Fb09A12", skin: { id: "solar-imperator", name: "Solar Imperator", rarity: "RELIC" }, nameSignal: "ember-cipher", coreLevel: 13, might: 208_700, achievements: [{ mark: "Ⅰ", name: "FIRST LIGHT" }], online: false },
};
const CONTACTS = [
  { a: "NyxValidator", f: "ORBT", v: true, on: true, note: "2 fleets" },
  { a: "WhaleSignal", f: "MOG", v: true, on: true, note: "air ×2" },
  { a: "VoidRunner", f: "ORBT", v: true, on: true, note: "idle" },
  { a: "GreenOrbit", f: "PEPE", v: true, on: false, note: "3h ago" },
  { a: "MuchCommand", f: "DOGE", on: false, note: "1d ago" },
];

const THREADS: Record<string, ChatMessage[]> = {
  cosmos: [
    { a: "GreenOrbit", f: "PEPE", v: true, t: "19:38", b: "Cash planets respawned all along the north-west arc — go go go" },
    { a: "MuchCommand", f: "DOGE", v: true, t: "19:44", b: "anyone else seeing the L12 rogue cluster near 312:094?" },
    { a: "GreenOrbit", f: "PEPE", t: "19:44", b: "repeat", spam: 3 },
    { a: "NyxValidator", f: "ORBT", v: true, t: "19:48", b: "confirmed via scout — leave the occupied Power planet alone" },
    { a: "VoidCat", f: "MOG", v: true, t: "19:52", b: "gg to whoever held 201:177 with half a fleet 🫡" },
    { a: "NoName", f: "WIF", t: "19:53", b: "free cash here → dexpump·win/x", blocked: "external link removed" },
  ],
  general: [
    { pin: "Wormhole watch 20:00 UTC — keep one fleet free. Full brief on the Alliance page." },
    { a: "NyxValidator", f: "ORBT", v: true, tag: "officer", t: "19:47", b: "Rogue activity rising on the east arc. Farm west until the rally leaves." },
    { a: "WhaleSignal", f: "MOG", v: true, t: "19:51", b: "Shared a target", coord: { c: "284:119", k: "Cash Planet · L8 · unoccupied" } },
    { a: "Ruglord", f: "ORBT", own: true, t: "19:53", b: "I can cover the second march. Ping me when the rally opens." },
    { a: "NyxValidator", f: "ORBT", v: true, tag: "officer", t: "19:55", b: "Spinning up a War Room for the Wormhole Sentinel — jump to that tab if you're bringing air." },
  ],
  warroom: [
    { a: "NyxValidator", f: "ORBT", v: true, tag: "officer", t: "19:56", b: "Target is air-dominant. Bring air, we counter with army. Staggered arrival." },
    { a: "WhaleSignal", f: "MOG", v: true, t: "19:57", b: "2 air fleets ready, 40K T8" },
    { a: "NyxValidator", f: "ORBT", v: true, t: "19:58", b: "Rally below. Recommended fleet is pre-filled — one tap to join.", rally: true },
  ],
  system: [
    { sys: "eco", tag: "Returned", t: "19:57", b: "Harvest complete · Oil Planet L7 · +4.20M Oil" },
    { sys: "mil", tag: "Victory", t: "19:31", b: "Rogue Planet L6 defeated · 1.20K wounded · report ready" },
    { sys: "eco", tag: "Complete", t: "18:46", b: "Research Institute reached L8" },
    { sys: "sec", tag: "Shield", t: "17:20", b: "Civilization shield has 1d 12h remaining" },
    { sys: "mil", tag: "Under attack", t: "16:10", b: "WhaleSignal requested reinforcement at 201:177" },
  ],
  "dm-nyx": [
    { a: "NyxValidator", f: "ORBT", v: true, t: "19:21", b: "Joining the Wormhole watch tonight?" },
    { a: "Ruglord", f: "ORBT", own: true, t: "19:24", b: "Yes, two fleets free by then." },
    { a: "NyxValidator", f: "ORBT", v: true, t: "19:25", b: "Perfect — you're on the east approach." },
  ],
  "dm-whale": [
    { a: "WhaleSignal", f: "MOG", v: true, t: "18:02", b: "Found an unoccupied L8 cash planet, sending coords" },
    { a: "WhaleSignal", f: "MOG", v: true, t: "18:03", b: "Target", coord: { c: "284:119", k: "Cash Planet · L8" } },
    { a: "Ruglord", f: "ORBT", own: true, t: "18:05", b: "saved, thanks 🙏" },
  ],
};

function initialChannel(): ChannelId {
  const requested = new URLSearchParams(window.location.search).get("channel") as ChannelId | null;
  return requested && ["cosmos", "alliance", "system", "contacts", "dm-nyx", "dm-whale"].includes(requested) ? requested : "alliance";
}

export default function Messages({ address, profile, onCity, onWorld, onProfile = () => {} }: { address: string; profile: Profile; onCity: () => void; onWorld: () => void; onProfile?: () => void }) {
  const [active, setActive] = useState<ChannelId>(initialChannel);
  const [allianceTab, setAllianceTab] = useState<AllianceTab>("general");
  const [sysFilter, setSysFilter] = useState<"all" | "mil" | "eco" | "sec">("all");
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState<Record<string, ChatMessage[]>>(() => {
    // Comms is a full gameplay surface, so opening it also advances/migrates the
    // local World authority. This keeps previously relayed recon consistent with
    // a corrected source report instead of freezing a known-bad copied value.
    const source = loadGame(address) || initGame(address);
    const opened = openLocalWorldSession(address, source, Date.now(), getN());
    saveLocalWorldSession(opened.session);
    saveGame(opened.game);
    return refreshLocalCommsIntel(address, opened.session.world);
  });
  const [pendingShare, setPendingShare] = useState<SharedWorldIntel | null>(() => loadQueuedCommsShare(address));
  const [shareTrayOpen, setShareTrayOpen] = useState(false);
  const [clock, setClock] = useState(Date.now());
  const [inspectedSignal, setInspectedSignal] = useState<PlayerSignal | null>(null);
  const equippedChatSignal = useMemo(() => loadCosmeticVault(address).equipped.chatSignal, [address]);
  const account = useMemo(() => loadPlayerAccount(address), [address]);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { saveLocalComms(address, sent); }, [address, sent]);

  // Live account status for the shared command nav (kept from the previous integration).
  const now = clock;
  const game = project(loadGame(address) || initGame(address), now);
  const stored = loadLocalWorldSession(address);
  const player = stored?.world.players[stored.playerId];
  const city = player ? stored?.world.entities[player.cityId] : null;
  const activeFleets = player ? Object.values(stored!.world.marches).filter((m) => m.playerId === player.id && !["completed", "failed"].includes(m.state)).length : 0;
  const energy = player ? energyAt(player, now, stored!.world.config) : 100;
  const energyCap = stored?.world.config.energyCap ?? 100;
  const fleetCap = player?.marchSlots ?? worldMarchSlots(game);
  const location = city?.kind === "city"
    ? `SECTOR ${stored!.world.stateId.slice(-6).toUpperCase()} · HOME ${Math.round(city.position.x).toString().padStart(3, "0")}:${Math.round(city.position.y).toString().padStart(3, "0")}`
    : "SECTOR 00DEV1";

  const isAlliance = active === "alliance";
  const isSystem = active === "system";
  const isDM = active.startsWith("dm");
  const isWar = isAlliance && allianceTab === "warroom";
  const key = isAlliance ? allianceTab : active;
  const dm = DMS.find((d) => d.id === active);

  const messages = useMemo(() => {
    let list = [...(THREADS[key] ?? []), ...(sent[key] ?? [])];
    if (isSystem && sysFilter !== "all") list = list.filter((m) => m.sys === sysFilter);
    return list;
  }, [key, sent, isSystem, sysFilter]);

  function send() {
    const body = draft.trim();
    if ((!body && !pendingShare) || isSystem || active === "contacts") return;
    if (pendingShare && !sharedIntelIsActive(pendingShare, now)) return;
    const message: ChatMessage = {
      id: `comms:${Date.now()}`,
      a: profile.name || "Ruglord", f: profile.factionSymbol || "ORBT", own: true, t: "now",
      b: body || (pendingShare?.kind === "scout-intel" ? "Recon envelope relayed." : pendingShare?.targetKind === "monster" ? "Rogue vector relayed." : pendingShare?.targetKind === "resource" ? "Resource vector relayed." : "Civilization vector relayed."),
      intel: pendingShare || undefined,
      sourceLanguage: "auto",
      authorLocale: account.language,
      createdAt: Date.now(),
    };
    setSent((cur) => ({ ...cur, [key]: [...(cur[key] ?? []), message] }));
    setDraft("");
    setPendingShare(null);
    clearQueuedCommsShare(address);
    setShareTrayOpen(false);
  }

  function removePendingShare() {
    setPendingShare(null);
    clearQueuedCommsShare(address);
  }

  function openSharedTarget(share: SharedWorldIntel) {
    queueWorldFocus(address, share.targetId, share.position);
    onWorld();
  }

  function openChannel(channel: ChannelId) {
    setActive(channel);
    setInspectedSignal(null);
  }

  const channelMeta = CHANNELS.find((c) => c.id === active);
  const headTitle = isAlliance ? "Alliance · Orbital" : isDM && dm ? `[${dm.faction}] ${dm.label}` : active === "contacts" ? "Contacts" : channelMeta?.label ?? "";
  const headDetail = isAlliance ? "[ORBT] Orbital" : isDM && dm ? dm.detail : active === "contacts" ? "5 friends · 3 online" : channelMeta?.detail ?? "";
  const headIcon = isAlliance ? "◇" : isDM && dm ? dm.icon : active === "contacts" ? "❋" : channelMeta?.icon ?? "◎";
  const headColor = isDM && dm ? fcol(dm.faction) : isWar ? "var(--gold)" : "var(--cyan)";

  return <section className="comms-page">
    <CosmicBackdrop />
    <div className="world-page-black-hole" aria-hidden="true"><i className="world-page-hole-glow" /><i className="world-page-accretion" /><i className="world-page-hole-core" /></div>
    <GameNav view="messages" profile={profile} townhallLevel={game.buildings.keep.lvl} location={location}
      resources={game.res} energy={energy} energyCap={energyCap} activeFleets={activeFleets} fleetCap={fleetCap}
      standing={totalTroops(game)} wounded={game.wounded} might={mightBreakdown(game).total}
      onCity={onCity} onWorld={onWorld} onMessages={() => {}} onProfile={onProfile} />

    <div className="comms">
      {/* LEFT — channels */}
      <aside className="col">
        <div className="cm-search">⌕ Search people &amp; channels</div>
        <div className="cm-grp">Channels</div>
        {CHANNELS.map((c) => <button key={c.id} className={`chan ${active === c.id ? "on" : ""}`} onClick={() => openChannel(c.id)}>
          <span className="ci" style={c.id === "alliance" ? { color: "var(--cyan)" } : undefined}>{c.icon}</span>
          <span className="cx"><b>{c.label}</b>{c.detail && <span>{c.detail}</span>}</span>
          {c.unread ? <span className={`badge ${c.mention ? "mention" : ""}`}>{c.mention ? `@${c.unread}` : c.unread}</span> : null}
        </button>)}
        <div className="cm-grp" style={{ marginTop: 12 }}>Direct</div>
        <button className={`chan contacts-row ${active === "contacts" ? "on" : ""}`} onClick={() => openChannel("contacts")}>
          <span className="ci contacts-ci">❋</span><span className="cx"><b>Contacts</b><span>3 online</span></span>
        </button>
        {DMS.map((c) => <button key={c.id} className={`chan ${active === c.id ? "on" : ""}`} onClick={() => openChannel(c.id)}>
          <span className="ci" style={{ color: fcol(c.faction) }}>{c.icon}</span>
          <span className="cx"><b>[{c.faction}] {c.label}</b><span>{c.detail}</span></span>
        </button>)}
      </aside>

      {/* CENTER — active thread */}
      <section className="col col-mid">
        <div className="thread-head">
          <div className="th-icon" style={{ color: headColor, borderColor: "color-mix(in srgb,currentColor 45%,transparent)" }}>{headIcon}</div>
          <div className="th-t"><b>{headTitle}</b><span>{headDetail}</span></div>
          <div className="th-actions"><button className="cm-icon">☆</button><button className="cm-icon">⋯</button></div>
        </div>

        {isAlliance && <div className="subtabs">
          <button className={allianceTab === "general" ? "on" : ""} onClick={() => setAllianceTab("general")}>◇ General</button>
          <button className={`${allianceTab === "warroom" ? "on" : ""} ${ALLIANCE_MANAGEMENT ? "" : "locked"}`}
            title={ALLIANCE_MANAGEMENT ? "" : "Requires alliance management"}
            onClick={() => ALLIANCE_MANAGEMENT && setAllianceTab("warroom")}>⚔ War Room {ALLIANCE_MANAGEMENT ? (WARROOM_ACTIVE ? <span className="live-dot" /> : null) : "🔒"}</button>
        </div>}
        {isWar && <div className="warroom-strip">⚔ Wormhole Sentinel op<span className="who">6 fleets · Nyx, Whale +4</span></div>}
        {isSystem && <div className="sysfilter">{(["all", "mil", "eco", "sec"] as const).map((f) => <button key={f} className={f === sysFilter ? "on" : ""} onClick={() => setSysFilter(f)}>{({ all: "All", mil: "Military", eco: "Economy", sec: "Security" } as const)[f]}</button>)}</div>}

        {active === "contacts"
          ? <div className="stream">{CONTACTS.map((c, i) => <div className="contact" key={i}>
              <div className="av" style={{ color: fcol(c.f) }}>{c.a.slice(0, 1)}</div>
              <div className="cbd"><div className="meta"><span className="tick" style={{ color: fcol(c.f), background: `${fcol(c.f)}1a` }}>[{c.f}]</span><span className="nm">{c.a}</span>{c.v && <span className="vbadge">✓</span>}</div>
                <div className="cnote"><span className={`dot ${c.on ? "on" : ""}`} />{c.note}</div></div>
              <button className="cmsg">Message</button>
            </div>)}</div>
          : <div className="stream">
              {isWar && <div className="spam">⚔ Fresh op session · clears when the op ends</div>}
              {messages.map((m, i) => <MessageRow key={i} m={m} now={now} ownChatSignal={equippedChatSignal} reducedMotion={account.reducedMotion} onInspect={(name) => setInspectedSignal(PLAYER_SIGNALS[name] || null)} onOpenWorld={openSharedTarget} />)}
              {messages.length === 0 && <div className="spam">{isWar ? "No active op — a War Room opens fresh when an officer starts one." : "No messages yet."}</div>}
            </div>}

        {!isSystem && active !== "contacts" && <div className="compose">
          <div className="safety"><span><i>🚫</i> Links off</span></div>
          {shareTrayOpen && !pendingShare && <div className="comms-share-tray"><span><b>RELAY CHAMBER EMPTY</b><small>LOCK ANY SIGNAL IN THE STAR MAP TO RELAY ITS VECTOR OR LIVE RECON.</small></span><button onClick={onWorld}>OPEN STAR MAP ▸</button></div>}
          {pendingShare && <div className="comms-pending-share"><SharedIntelCard share={pendingShare} now={now} onOpen={() => openSharedTarget(pendingShare)} compactView /><button className="comms-share-remove" aria-label="Remove intelligence attachment" onClick={removePendingShare}>×</button></div>}
          <div className="box">
            <button className={`attach ${pendingShare ? "loaded" : ""}`} title="Relay a coordinate or recon envelope" onClick={() => setShareTrayOpen((value) => !value)}>+</button>
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Message · @mention · attach a coordinate, report or rally with +" />
            <button className="cm-send" disabled={!!pendingShare && !sharedIntelIsActive(pendingShare, now)} onClick={send}>Send</button>
          </div>
        </div>}
      </section>

      {/* RIGHT — context */}
      <aside className="col"><div className="ctx">{renderContext(active, allianceTab, dm, inspectedSignal)}</div></aside>
    </div>
  </section>;
}

function MessageRow({ m, now, ownChatSignal, reducedMotion, onInspect, onOpenWorld }: { m: ChatMessage; now: number; ownChatSignal: ChatSignalId | null; reducedMotion: boolean; onInspect: (name: string) => void; onOpenWorld: (share: SharedWorldIntel) => void }) {
  if (m.pin) return <div className="pinned"><b>PINNED</b><span>{m.pin}</span></div>;
  if (m.spam) return <div className="spam"><b>[{m.f}] {m.a}</b> sent the same message {m.spam}× · collapsed</div>;
  if (m.sys) return <div className={`logrow ${m.sys}`}><span className="lg-tag">{m.tag}</span><span className="lg-b">{m.b}</span><span className="lg-t">{m.t}</span></div>;
  return <div className={`msg ${m.own ? "own" : ""}`}>
    <div className="av" style={m.own ? undefined : { color: fcol(m.f) }}>{(m.a ?? "?").slice(0, 1)}</div>
    <div className="bd">
      <div className="meta">
        {m.f && <span className="tick" style={{ color: fcol(m.f), background: `${fcol(m.f)}1a` }}>[{m.f}]</span>}
        <button className="nm player-name-button" disabled={!m.a || !PLAYER_SIGNALS[m.a]} onClick={() => m.a && onInspect(m.a)}><NameSignal signal={m.own ? ownChatSignal : m.a ? PLAYER_SIGNALS[m.a]?.nameSignal : null} mode="demo" reducedMotion={reducedMotion}>{m.a || "UNKNOWN"}</NameSignal></button>
        {m.v && <span className="vbadge" title="on-chain pledge observed">✓</span>}
        {m.tag && <span className={`mtag ${m.tag}`}>{m.tag}</span>}
        <span className="mtime">{m.t}</span>
      </div>
      <div className="txt">{m.b}</div>
      {m.intel && <SharedIntelCard share={m.intel} now={now} onOpen={() => onOpenWorld(m.intel!)} />}
      {m.coord && <div className="chip-coord"><div className="cc-i">◈</div><div className="cc-t"><b>{m.coord.c}</b><span>{m.coord.k}</span></div><div className="cc-act"><button>Scout</button><button>Gather</button><button className="go">Open ▸</button></div></div>}
      {m.rally && <div className="chip-rally"><div className="rr-top"><b>Wormhole Sentinel</b><span className="rr-lv">L18</span></div>
        <div className="rr-meta"><span>Fills in <b>4m 40s</b></span><span className="rr-counter">Counter: bring Army ▸ Air</span></div>
        <div className="rr-meta"><span>Fleets <b>3 / 6</b></span><span>Your rec: <b>Army T8 ×42K</b></span></div>
        <div className="rr-bar"><i /></div><button className="rr-join">Join with recommended fleet →</button></div>}
      {m.blocked && <div className="spam" style={{ marginTop: 5 }}>🚫 {m.blocked}</div>}
      <div className="row-actions"><button>Reply</button><button>Report</button><button>Mute</button></div>
    </div>
  </div>;
}

function intelRemaining(expiresAt: number, now: number): string {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  const remainder = seconds % 60;
  return hours ? `${hours}h ${minutes}m` : `${minutes}m ${remainder.toString().padStart(2, "0")}s`;
}

function SharedIntelCard({ share, now, onOpen, compactView = false }: { share: SharedWorldIntel; now: number; onOpen: () => void; compactView?: boolean }) {
  const live = sharedIntelIsActive(share, now);
  const coordinate = `${Math.round(share.position.x).toString().padStart(3, "0")}:${Math.round(share.position.y).toString().padStart(3, "0")}`;
  const targetKind = share.targetKind || "city";
  const vectorName = targetKind === "resource" ? "RESOURCE VECTOR" : targetKind === "monster" ? "ROGUE VECTOR" : "CIVILIZATION VECTOR";
  if (share.kind === "coordinate") return <div className={`comms-intel-card coordinate target-${targetKind} ${compactView ? "compact" : ""}`}>
    <header><span>◈ {vectorName}</span><em>UNCHAINED</em></header>
    <div className="comms-intel-target"><b>{share.targetName}</b><small>L{share.targetLevel} · {coordinate}</small></div>
    {!compactView && <button onClick={onOpen}>OPEN IN STAR MAP ▸</button>}
  </div>;

  const snapshot = share.snapshot as Record<string, any>;
  const loot = (snapshot.loot ?? {}) as Record<string, number>;
  const lootTotal = Object.values(loot).reduce((sum, amount) => sum + (Number(amount) || 0), 0);
  return <div className={`comms-intel-card recon ${live ? "live" : "expired"} ${compactView ? "compact" : ""}`}>
    <header><span>▤ RECON ENVELOPE</span><em>{live ? intelRemaining(share.expiresAt, now) : "DECAYED"}</em></header>
    <div className="comms-intel-target"><b>{share.targetName}</b><small>L{share.targetLevel} · {coordinate}</small></div>
    {!compactView && <div className="comms-intel-stats"><span><small>MIGHT</small><b>{live ? compact(Number(snapshot.might) || 0) : "•••"}</b></span><span><small>GARRISON</small><b>{live ? compact(displayTroops(Number(snapshot.garrison) || 0)) : "•••"}</b></span><span><small>LOOT</small><b>{live ? compact(displayResource(Number(snapshot.estimatedLoot) || lootTotal)) : "•••"}</b></span></div>}
    {!compactView && <button className={live ? "" : "rescan"} onClick={onOpen}>{live ? "OPEN TARGET ▸" : "RE-SCAN REQUIRED ▸"}</button>}
  </div>;
}

function renderContext(active: ChannelId, allianceTab: AllianceTab, dm?: DirectThread, inspectedSignal?: PlayerSignal | null) {
  const playerSignal = inspectedSignal || dm?.signal;
  if (playerSignal) return <>
    <PlayerCard signal={playerSignal} />
    <div className="ct-title">Open channel</div>
    <div className="qlinks"><div className="ql">◇ Direct signal</div><div className="ql">◈ Share a coordinate</div><div className="ql">▤ Share a report</div><div className="ql" style={{ color: "var(--err)" }}>⃠ Block / mute</div></div>
  </>;
  if (active === "cosmos") return <>
    <div className="ct-title">Factions online</div>
    <div className="factions">{["ORBT", "PEPE", "DOGE", "MOG", "WIF"].map((f) => <span key={f} className="fchip" style={{ color: fcol(f) }}><i style={{ background: fcol(f) }} />{f}</span>)}</div>
  </>;
  if (active === "alliance") {
    const roster: Array<[string, string, string]> = [["NyxValidator", "ORBT", "2 fleets"], ["WhaleSignal", "MOG", "air ×2"], ["VoidRunner", "ORBT", "idle"], ["Ruglord", "ORBT", "you"]];
    return <>
      <div className="ct-hero"><b>ORBITAL</b><span>[ORBT] · rank #12</span></div>
      <div className="ct-title">The Wormhole</div>
      <div className="obj"><div className="ob-l"><span>Sector control</span><b style={{ color: "var(--ink)" }}>66%</b></div><div className="ob-bar"><i style={{ width: "66%" }} /></div></div>
      <div className="ct-title">{allianceTab === "warroom" ? "In this op" : "Online"}</div>
      <div className="roster">{roster.map((r, i) => <div className="rm" key={i}><span className="dot on" /><span style={{ color: fcol(r[1]) }}>●</span>{r[0]}<span className="rm-f">{r[2]}</span></div>)}</div>
      <div className="ct-title">Quick links</div>
      <div className="qlinks"><div className="ql">⚔ Rally board <span className="qbadge">2</span></div><div className="ql">◈ Shared coordinates</div><div className="ql">▤ Shared reports</div><div className="ql">⚙ Alliance page ▸</div></div>
    </>;
  }
  if (active === "system") return <>
    <div className="ct-title">Notify me for</div>
    <div className="roster">
      <div className="rm"><span className="dot on" />Under attack<span className="rm-f">on</span></div>
      <div className="rm"><span className="dot on" />Rally opened<span className="rm-f">on</span></div>
      <div className="rm"><span className="dot on" />Reinforcement<span className="rm-f">on</span></div>
      <div className="rm"><span className="dot" />Harvest returned<span className="rm-f">off</span></div>
    </div>
  </>;
  if (active === "contacts") return <>
    <div className="ct-title">Requests</div>
    <div className="roster"><div className="rm"><span style={{ color: fcol("WIF") }}>●</span>SolSniper<span className="rm-f" style={{ color: "var(--cyan)" }}>accept</span></div></div>
    <div className="ct-title">Add friend</div>
    <div className="cm-search" style={{ margin: 0 }}>⌕ Player name</div>
  </>;
  return null;
}
