import { useEffect, useMemo, useRef, useState } from "react";
import { RealtimeClient, type LiveChat, type PresenceCity } from "./lib/realtime";
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
import { playerSystemReports } from "./lib/world-reports";
import { playSfx, SFX_CHAT_SEND, SFX_CHAT_SEND_VOLUME } from "./lib/sfx";

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
  { id: "cosmos", icon: "◎", label: "Cosmos", detail: "Frontier I" },
  { id: "system", icon: "⌁", label: "System", detail: "Reports" },
];
// Player identity lookup for name styling in chat. Real players resolve their
// own name signal via presence; this stays empty (no seeded/placeholder people).
const PLAYER_SIGNALS: Record<string, PlayerSignal> = {};

function initialChannel(): ChannelId {
  const requested = new URLSearchParams(window.location.search).get("channel") as ChannelId | null;
  return requested && ["cosmos", "system"].includes(requested) ? requested : "cosmos";
}

export default function Messages({ address, profile, onAlliance = () => {}, onCity, onWorld, onProfile = () => {} }: { address: string; profile: Profile; onAlliance?: () => void; onCity: () => void; onWorld: () => void; onProfile?: () => void }) {
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

  // Realtime: shared Cosmos chat + player presence (Cloudflare Worker + DO).
  const [live, setLive] = useState<LiveChat[]>([]);
  const [roster, setRoster] = useState<PresenceCity[]>([]);
  const [rtConnected, setRtConnected] = useState(false);
  const [dmThreads, setDmThreads] = useState<Record<string, LiveChat[]>>({});
  const [dmNames, setDmNames] = useState<Record<string, string>>({});
  const [dmWith, setDmWith] = useState<{ id: string; name: string } | null>(null);
  const rtRef = useRef<RealtimeClient | null>(null);
  const partnerOf = (key: string) => key.split("|").find((x) => x !== address) || key;
  useEffect(() => {
    const rt = new RealtimeClient(address, profile.name || "Commander");
    rtRef.current = rt;
    rt.handlers.onSnapshot = (_you, players, chat, dms) => {
      setLive(chat); setRoster(players);
      const threads: Record<string, LiveChat[]> = {}; const names: Record<string, string> = {};
      for (const [k, arr] of Object.entries(dms)) {
        const partner = partnerOf(k); threads[partner] = arr;
        const last = arr.filter((m) => m.pid === partner).slice(-1)[0]; if (last) names[partner] = last.name;
      }
      setDmThreads(threads); setDmNames((cur) => ({ ...names, ...cur }));
    };
    rt.handlers.onChat = (m) => setLive((cur) => [...cur, m].slice(-160));
    rt.handlers.onDM = (k, m) => {
      const partner = partnerOf(k);
      setDmThreads((cur) => ({ ...cur, [partner]: [...(cur[partner] || []), m].slice(-200) }));
      if (m.pid === partner) setDmNames((cur) => ({ ...cur, [partner]: m.name }));
    };
    rt.handlers.onPlayer = (p) => setRoster((cur) => {
      const i = cur.findIndex((x) => x.id === p.id);
      if (i < 0) return [...cur, p];
      const next = cur.slice(); next[i] = p; return next;
    });
    rt.handlers.onStatus = setRtConnected;
    const g = loadGame(address);
    rt.sendPresence({ name: profile.name, faction: profile.factionSymbol || null, keepLevel: g?.buildings?.keep?.lvl ?? 1, cosmetics: loadCosmeticVault(address).equipped });
    return () => rt.close();
  }, [address, profile.name, profile.factionSymbol]);

  function openDM(id: string, name: string) {
    if (!id || id === address) return;
    setDmNames((cur) => ({ ...cur, [id]: name || cur[id] || "Commander" }));
    setDmWith({ id, name: name || dmNames[id] || "Commander" });
    setActive("cosmos"); // base channel so the composer shows; dmWith overrides the view
    setInspectedSignal(null);
  }
  const dmMessages = useMemo<ChatMessage[]>(() => {
    if (!dmWith) return [];
    return (dmThreads[dmWith.id] || []).map((c) => ({
      a: c.name, own: c.pid === address,
      t: new Date(c.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }),
      b: c.text,
    }));
  }, [dmWith, dmThreads, address]);

  const onlineCount = useMemo(() => roster.filter((p) => p.online).length, [roster]);
  const cosmosLive = useMemo<ChatMessage[]>(() => live.map((c) => ({
    a: c.name, f: c.faction || undefined, own: c.pid === address,
    t: new Date(c.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }),
    b: c.text,
    intel: (c.intel as SharedWorldIntel | undefined) || undefined,
  })), [live, address]);

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

  const isSystem = active === "system";
  const key = active;

  // Real world reports (attacks, harvests, recon) feed the System channel — the
  // same reports the starmap shows — so a battle result appears in both places.
  // Falls back to the seeded sample lines only when a fresh account has none.
  const systemReports = useMemo(() => {
    const lines = playerSystemReports(stored, stored?.playerId ?? "");
    return lines.map(({ sys, tag, t, b }) => ({ sys, tag, t, b }));
  }, [stored, clock]);

  const isCosmos = active === "cosmos";
  const messages = useMemo(() => {
    if (dmWith) return dmMessages;
    if (isCosmos) return cosmosLive; // live shared chat
    let list = isSystem ? [...systemReports] : [...(sent[key] ?? [])];
    if (isSystem && sysFilter !== "all") list = list.filter((m) => m.sys === sysFilter);
    return list;
  }, [key, sent, isSystem, sysFilter, systemReports, isCosmos, cosmosLive, dmWith, dmMessages]);

  // Keep the transcript pinned to the newest message when you open/switch a
  // thread, and whenever your own send lands (including the server echo). We
  // don't yank the view for others' messages if you've scrolled up to read.
  const streamRef = useRef<HTMLDivElement>(null);
  const scrollToLatest = () => { const el = streamRef.current; if (el) el.scrollTop = el.scrollHeight; };
  useEffect(scrollToLatest, [active, dmWith]);
  useEffect(() => { const last = messages[messages.length - 1] as ChatMessage | undefined; if (last?.own) scrollToLatest(); }, [messages]);

  function send() {
    const body = draft.trim();
    if ((!body && !pendingShare) || isSystem) return;
    // Private DM — send to the server, which delivers to both participants.
    if (dmWith) {
      if (!body) return;
      rtRef.current?.sendDM(dmWith.id, body);
      if (account.soundEnabled) playSfx(SFX_CHAT_SEND, SFX_CHAT_SEND_VOLUME * account.sfxVolume);
      setDraft("");
      return;
    }
    // Cosmos is the live shared channel — send to the server and let it echo back
    // (no local copy, or it would double once the broadcast returns). A relayed
    // coordinate/recon goes through as a text summary.
    if (isCosmos) {
      let text = body;
      let intel: SharedWorldIntel | undefined;
      if (pendingShare && sharedIntelIsActive(pendingShare, now)) {
        const tag = pendingShare.kind === "scout-intel" ? "Recon" : pendingShare.targetKind === "monster" ? "Rogue" : pendingShare.targetKind === "resource" ? "Resource" : "City";
        const pos = pendingShare.position ? ` ${Math.round(pendingShare.position.x)}:${Math.round(pendingShare.position.y)}` : "";
        text = `${body ? body + " — " : ""}[${tag}] ${pendingShare.targetName || ""}${pos}`.trim();
        intel = pendingShare; // rides along so it renders as a clickable star-map card
      }
      if (!text) return;
      rtRef.current?.sendChat(text, intel);
      if (account.soundEnabled) playSfx(SFX_CHAT_SEND, SFX_CHAT_SEND_VOLUME * account.sfxVolume);
      setDraft(""); setPendingShare(null); clearQueuedCommsShare(address); setShareTrayOpen(false);
      return;
    }
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
    setDmWith(null);
  }

  const channelMeta = CHANNELS.find((c) => c.id === active);
  const headTitle = dmWith ? dmWith.name : active === "contacts" ? "Contacts" : isCosmos ? "Cosmos" : channelMeta?.label ?? "";
  const headDetail = dmWith ? "Direct message · private" : active === "contacts" ? `${onlineCount} online` : isCosmos ? (rtConnected ? `● LIVE · ${onlineCount} online` : "connecting…") : channelMeta?.detail ?? "";
  const headIcon = dmWith ? "◇" : active === "contacts" ? "❋" : channelMeta?.icon ?? "◎";
  const headColor = dmWith ? "var(--gold)" : "var(--cyan)";

  return <section className="comms-page">
    <CosmicBackdrop />
    <div className="world-page-black-hole" aria-hidden="true"><i className="world-page-hole-glow" /><i className="world-page-accretion" /><i className="world-page-hole-core" /></div>
    <GameNav view="messages" profile={profile} townhallLevel={game.buildings.keep.lvl} location={location}
      resources={game.res} energy={energy} energyCap={energyCap} activeFleets={activeFleets} fleetCap={fleetCap}
      standing={totalTroops(game)} wounded={game.wounded} might={mightBreakdown(game).total}
      onAlliance={onAlliance} onCity={onCity} onWorld={onWorld} onMessages={() => {}} onProfile={onProfile} />

    <div className="comms">
      {/* LEFT — channels */}
      <aside className="col">
        <div className="cm-grp">Channels</div>
        {CHANNELS.map((c) => <button key={c.id} className={`chan ${active === c.id ? "on" : ""}`} onClick={() => openChannel(c.id)}>
          <span className="ci">{c.icon}</span>
          <span className="cx"><b>{c.label}</b>{c.detail && <span>{c.detail}</span>}</span>
        </button>)}
        <button className="chan soon" disabled title="Alliance chat arrives with shared multiplayer — coming soon">
          <span className="ci">◇</span>
          <span className="cx"><b>Alliance</b><span>Coming soon</span></span>
          <span className="soon-tag">SOON</span>
        </button>
        <button className={`chan ${active === "contacts" && !dmWith ? "on" : ""}`} onClick={() => openChannel("contacts")}>
          <span className="ci">❋</span>
          <span className="cx"><b>Contacts</b><span>{onlineCount} online</span></span>
        </button>
        {(() => {
          const partners = Array.from(new Set([...(dmWith ? [dmWith.id] : []), ...Object.keys(dmThreads)]));
          if (!partners.length) return null;
          return <>
            <div className="cm-grp" style={{ marginTop: 12 }}>Direct</div>
            {partners.map((pid) => <button key={pid} className={`chan ${dmWith?.id === pid ? "on" : ""}`} onClick={() => openDM(pid, dmNames[pid] || "Commander")}>
              <span className="ci">◇</span>
              <span className="cx"><b>{dmNames[pid] || "Commander"}</b><span>direct message</span></span>
            </button>)}
          </>;
        })()}
      </aside>

      {/* CENTER — active thread */}
      <section className="col col-mid">
        <div className="thread-head">
          <div className="th-icon" style={{ color: headColor, borderColor: "color-mix(in srgb,currentColor 45%,transparent)" }}>{headIcon}</div>
          <div className="th-t"><b>{headTitle}</b><span>{headDetail}</span></div>
          <div className="th-actions"><button className="cm-icon">☆</button><button className="cm-icon">⋯</button></div>
        </div>

        {isSystem && <div className="sysfilter">{(["all", "mil", "eco", "sec"] as const).map((f) => <button key={f} className={f === sysFilter ? "on" : ""} onClick={() => setSysFilter(f)}>{({ all: "All", mil: "Military", eco: "Economy", sec: "Security" } as const)[f]}</button>)}</div>}

        {active === "contacts" && !dmWith
          ? <div className="stream">
              {roster.filter((p) => p.online).map((p) => <div className="contact" key={p.id}>
                <div className="av">{(p.name || "?").slice(0, 1)}</div>
                <div className="cbd"><div className="meta"><span className="nm">{p.name}{p.id === address ? " (you)" : ""}</span>{p.keepLevel ? <span className="tick">TH{p.keepLevel}</span> : null}</div>
                  <div className="cnote"><span className="dot on" />online</div></div>
                {p.id !== address && <button className="cmsg" onClick={() => openDM(p.id, p.name)}>Message</button>}
              </div>)}
              {Object.keys(dmThreads).filter((pid) => !roster.some((p) => p.id === pid && p.online)).map((pid) => <div className="contact" key={pid}>
                <div className="av">{(dmNames[pid] || "?").slice(0, 1)}</div>
                <div className="cbd"><div className="meta"><span className="nm">{dmNames[pid] || "Commander"}</span></div>
                  <div className="cnote"><span className="dot" />offline</div></div>
                <button className="cmsg" onClick={() => openDM(pid, dmNames[pid] || "Commander")}>Message</button>
              </div>)}
              {onlineCount === 0 && Object.keys(dmThreads).length === 0 && <div className="spam">No commanders online yet — invite a friend with Quick Play and they'll show up here.</div>}
            </div>
          : <div className="stream" ref={streamRef}>
              {messages.map((m, i) => <MessageRow key={i} m={m} now={now} ownChatSignal={equippedChatSignal} reducedMotion={account.reducedMotion} onInspect={(name) => setInspectedSignal(PLAYER_SIGNALS[name] || null)} onOpenWorld={openSharedTarget} />)}
              {messages.length === 0 && <div className="spam">{dmWith ? "No messages yet — say hi." : isCosmos ? "Be the first to signal the frontier." : "No messages yet."}</div>}
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
      <aside className="col"><div className="ctx">{renderContext({ active, roster, onlineCount, address, dmWith, openDM })}</div></aside>
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

function renderContext(ctx: { active: ChannelId; roster: PresenceCity[]; onlineCount: number; address: string; dmWith: { id: string; name: string } | null; openDM: (id: string, name: string) => void }) {
  const { active, roster, onlineCount, address, dmWith, openDM } = ctx;
  // Live "who's online" — click a commander to open a private channel (PM).
  const online = roster.filter((p) => p.online);
  if (dmWith || active === "cosmos" || active === "contacts") return <>
    <div className="ct-title">Online · {onlineCount}</div>
    <div className="roster">
      {online.map((p) => <button key={p.id} className={`rm rm-btn${p.id === address ? " self" : ""}`} disabled={p.id === address} title={p.id === address ? undefined : `Message ${p.name}`} onClick={() => openDM(p.id, p.name)}>
        <span className="rm-av">{(p.name || "?").slice(0, 1)}<i className="rm-online" /></span>
        <span className="rm-nm">{p.name}{p.id === address ? " (you)" : ""}</span>
        {p.id !== address && <span className="rm-pm" aria-hidden="true">✉</span>}
      </button>)}
      {online.length === 0 && <div className="rm rm-empty"><span className="dot" />No commanders online yet</div>}
    </div>
  </>;
  if (active === "system") return <>
    <div className="ct-title">Notify me for</div>
    <div className="roster">
      <div className="rm"><span className="dot on" />Under attack<span className="rm-f">on</span></div>
      <div className="rm"><span className="dot on" />Rally opened<span className="rm-f">on</span></div>
      <div className="rm"><span className="dot on" />Reinforcement<span className="rm-f">on</span></div>
      <div className="rm"><span className="dot" />Harvest returned<span className="rm-f">off</span></div>
    </div>
  </>;
  return null;
}
