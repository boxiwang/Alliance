import { useEffect, useMemo, useState } from "react";
import type { TokenHolding } from "./lib/blockscout";
import type { Profile } from "./lib/profile";
import { saveProfile } from "./lib/profile";
import { mightBreakdown, project, totalTroops, worldMarchSlots } from "./lib/game";
import { initGame, loadGame } from "./lib/gamestore";
import { energyAt } from "./lib/world-engine";
import { loadLocalWorldSession } from "./lib/world-adapter";
import { getN } from "./lib/numbers";
import GameNav from "./GameNav";
import MiniComms from "./MiniComms";
import CosmicBackdrop from "./CosmicBackdrop";
import { hasLocalGm } from "./lib/gm";
import {
  ALLIANCE_CHANGED_EVENT, allianceForAddress, availableAlliances, castLeadershipVote,
  endorseCandidate, foundAllianceFromToken, gmPrepareAlliance, gmSeedAlliance, helpAll, initiateLeadershipChallenge,
  leaveAlliance, loadAllianceDirectory, removeAllianceMember, requestAllianceEntry, resolveLeadershipChallenges,
  reviewAllianceApplication, reviewAllianceNap, setAllianceDiplomacy, setAllianceMemberRank, tokenAllianceForHolding,
  updateAllianceStandards, upgradeAllianceSkill, type AllianceRecord,
} from "./lib/alliance";

type AllianceView = "home" | "decree" | "rallies" | "skills" | "governance" | "exchange" | "roster" | "operations";

function countdown(ms: number): string {
  const minutes = Math.max(0, Math.ceil(ms / 60000));
  if (minutes < 60) return `${minutes}M`;
  const hours = Math.floor(minutes / 60); const remainder = minutes % 60;
  return `${hours}H ${remainder}M`;
}

export default function Alliance({ address, profile, holdings = [], onProfileChange, onCity, onWorld, onMessages, onProfile }: {
  address: string;
  profile: Profile;
  holdings?: TokenHolding[];
  onProfileChange: (profile: Profile) => void;
  onCity: () => void;
  onWorld: () => void;
  onMessages: () => void;
  onProfile: () => void;
}) {
  const [revision, setRevision] = useState(0);
  const [view, setView] = useState<AllianceView>("home");
  const [notice, setNotice] = useState("");
  const [candidateAddress, setCandidateAddress] = useState("");
  const [holdingStandard, setHoldingStandard] = useState("");
  const [activeStandard, setActiveStandard] = useState("");
  const [now, setNow] = useState(Date.now());
  const gm = hasLocalGm(address);

  useEffect(() => {
    const sync = () => setRevision((value) => value + 1);
    window.addEventListener(ALLIANCE_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    const timer = window.setInterval(() => { setNow(Date.now()); resolveLeadershipChallenges(); }, 30000);
    return () => { window.removeEventListener(ALLIANCE_CHANGED_EVENT, sync); window.removeEventListener("storage", sync); window.clearInterval(timer); };
  }, []);

  const directory = useMemo(() => loadAllianceDirectory(), [revision]);
  const alliance = useMemo(() => allianceForAddress(address, directory), [address, directory]);
  const membership = alliance?.members.find((member) => member.address.toLowerCase() === address.toLowerCase()) ?? null;
  useEffect(() => {
    if (!alliance || (profile.factionSymbol === alliance.symbol && profile.faction === (alliance.contractAddress || alliance.id))) return;
    const updated = { ...profile, faction: alliance.contractAddress || alliance.id, factionSymbol: alliance.symbol };
    saveProfile(updated); onProfileChange(updated);
  }, [alliance?.id]);
  const game = project(loadGame(address) || initGame(address), now);
  const worldSession = loadLocalWorldSession(address);
  const worldPlayer = worldSession?.world.players[worldSession.playerId];
  const city = worldPlayer ? worldSession?.world.entities[worldPlayer.cityId] : null;
  const location = city?.kind === "city" ? `SECTOR ${worldSession!.world.stateId.slice(-6).toUpperCase()} · HOME ${Math.round(city.position.x).toString().padStart(3, "0")}:${Math.round(city.position.y).toString().padStart(3, "0")}` : "RHCHAIN 4663 · CHAPTER RELAY";
  const N = getN();
  const energyCap = worldSession?.world.config.energyCap ?? Number(N.world?.energy?.cap) ?? 100;
  const energy = worldPlayer && worldSession ? energyAt(worldPlayer, now, worldSession.world.config) : energyCap;
  const activeFleets = worldSession ? Object.values(worldSession.world.marches).filter((march) => march.playerId === worldSession.playerId && march.state !== "completed").length : 0;

  function refresh(message = "") { setNotice(message); setRevision((value) => value + 1); }
  function bindProfile(next: AllianceRecord | null) {
    const updated = { ...profile, faction: next?.contractAddress || (next ? next.id : null), factionSymbol: next?.symbol || null };
    saveProfile(updated); onProfileChange(updated);
  }
  function join(id: string) {
    const result = requestAllianceEntry(id, profile, holdings);
    if (!result.ok) return refresh(result.reason);
    if (result.applied) return refresh("Entry petition transmitted to R4/R5 command.");
    bindProfile(result.alliance!); refresh("Chapter signal accepted.");
  }
  function leave() { const result = leaveAlliance(profile); if (!result.ok) return refresh(result.reason); bindProfile(null); setView("home"); refresh("Signal withdrawn. Jump cooldown: 24 hours."); }
  function found(token: TokenHolding) { const result = foundAllianceFromToken(token, profile); if (!result.ok) return refresh(result.reason); bindProfile(result.alliance!); refresh("Founding beacon is live. Recruit five more civilizations."); }
  function assist() { const result = helpAll(profile); refresh(result.helped ? `${result.helped} timers shortened · ${result.rewarded} contribution signals credited.` : result.reason || "No unanswered calls remain."); }

  const nav = <GameNav view="alliance" profile={profile} townhallLevel={game.buildings.keep.lvl} location={location}
    resources={game.res} energy={energy} energyCap={energyCap} activeFleets={activeFleets} fleetCap={worldPlayer?.marchSlots ?? worldMarchSlots(game)}
    standing={totalTroops(game)} wounded={game.wounded} might={mightBreakdown(game).total}
    onAlliance={() => setView("home")} onCity={onCity} onWorld={onWorld} onMessages={onMessages} onProfile={onProfile} />;

  if (!alliance) {
    const eligible = availableAlliances(holdings, directory);
    const unregistered = holdings.filter((token) => !tokenAllianceForHolding(token, directory));
    return <section className="alliance-page"><CosmicBackdrop />{nav}<main className="alliance-entry">
      <header><small>CHAPTER RELAY // OPEN</small><h1>Find the signal worth defending.</h1><p>Your city remains yours. A chapter adds shared war, doctrine, aid, and a place in the frontier’s politics.</p></header>
      {notice && <div className="alliance-notice">{notice}</div>}
      <div className="alliance-entry-grid">
        {eligible.map((entry) => <article className="alliance-entry-card" key={entry.id} style={{ "--alliance": entry.color } as React.CSSProperties}>
          <div className="alliance-emblem">{entry.iconUrl ? <img src={entry.iconUrl} alt="" /> : entry.symbol.slice(0, 2)}</div>
          <small>CHAPTER {String(entry.chapter).padStart(3, "0")}</small><h2>[{entry.symbol}] {entry.name}</h2>
          <p>{entry.kind === "default" ? "The civilian passage. No wallet oath required." : entry.minHoldingDisplay}</p>
          <button onClick={() => join(entry.id)}>ALIGN SIGNAL →</button>
        </article>)}
      </div>
      {!!unregistered.length && <section className="alliance-foundry"><small>UNCLAIMED CONTRACTS</small><h2>Raise a new chapter beacon.</h2><p>Name, ticker, chapter and spectrum are read from the chain. Only the emblem may be corrected later.</p><div>{unregistered.map((token) => <button key={token.address} onClick={() => found(token)}><b>${token.symbol}</b><span>{token.name}</span><em>FOUND →</em></button>)}</div></section>}
    </main></section>;
  }

  const openHelps = alliance.helps.filter((help) => !help.closedAt && help.helpers.length < 25);
  if (alliance.status === "forming") {
    const endorsements = alliance.endorsements[address] ?? [];
    return <section className="alliance-page"><CosmicBackdrop />{nav}<main className="alliance-forming">
      <header style={{ "--alliance": alliance.color } as React.CSSProperties}><small>FOUNDING BEACON // CHAPTER {String(alliance.chapter).padStart(3, "0")}</small><h1>[{alliance.symbol}] {alliance.name}</h1><p>Command remains dark until six civilizations assemble and five distinct founders endorse one signal.</p></header>
      {notice && <div className="alliance-notice">{notice}</div>}
      <div className="alliance-forming-meter"><div><span>FOUNDERS</span><b>{alliance.members.length}/6</b></div><i><em style={{ width: `${Math.min(100, alliance.members.length / 6 * 100)}%` }} /></i><div><span>ENDORSEMENTS FOR YOU</span><b>{endorsements.length}/5</b></div></div>
      <div className="alliance-forming-roster">{alliance.members.map((member) => <article key={member.address}><span>{member.name.slice(0, 1)}</span><div><b>{member.name}</b><small>{member.address.slice(0, 6)}…{member.address.slice(-4)}</small></div>{member.address.toLowerCase() !== address.toLowerCase() && <button onClick={() => { const result = endorseCandidate(alliance.id, address, member.address); refresh(result.reason || "Founding endorsement transmitted."); }}>ENDORSE</button>}</article>)}</div>
      {gm && <button className="alliance-gm" onClick={() => { gmSeedAlliance(alliance.id); refresh("GM: founding roster populated."); }}>GM // SEED SIX FOUNDERS</button>}
      <button className="alliance-withdraw" onClick={leave}>WITHDRAW SIGNAL</button>
    </main><MiniComms address={address} profile={profile} onOpenMessages={onMessages} /></section>;
  }

  const activeChallenge = alliance.challenges.find((challenge) => !challenge.resolvedAt && challenge.closesAt > now);
  const incomingNap = directory.alliances.flatMap((entry) => entry.diplomacyRequests.map((request) => ({ request, source: entry }))).filter(({ request }) => request.toAllianceId === alliance.id && request.status === "pending");
  return <section className="alliance-page"><CosmicBackdrop />{nav}<main className="alliance-command">
    {notice && <div className="alliance-notice">{notice}</div>}
    {gm && <div className="alliance-gm-strip"><span>LOCAL GM // CHAPTER</span><button onClick={() => { gmPrepareAlliance(alliance.id, address); refresh("GM: R5 clearance, veteran tenure, roster, credits and doctrine points granted."); }}>PREPARE FULL COMMAND</button></div>}
    <header className="alliance-command-head" style={{ "--alliance": alliance.color } as React.CSSProperties}>
      <div className="alliance-emblem large">{alliance.iconUrl ? <img src={alliance.iconUrl} alt="" /> : alliance.symbol.slice(0, 2)}</div>
      <div><small>CHAPTER {String(alliance.chapter).padStart(3, "0")} // ACTIVE</small><h1>[{alliance.symbol}] {alliance.name}</h1><p>{alliance.members.length} SIGNALS · RANK {membership?.rank} · {alliance.minHoldingDisplay}</p></div>
      <button onClick={() => setView("decree")}>CHAPTER DECREE <span>↗</span></button>
    </header>

    {view === "home" && <>
      <section className="alliance-brief"><div><small>ACTIVE DIRECTIVE</small><b>{alliance.decrees[0]?.title}</b><p>{alliance.decrees[0]?.body}</p></div><button onClick={assist}><span>◇</span><b>ANSWER ALL CALLS</b><small>{openHelps.length} CIVILIZATIONS SEEK AID</small></button></section>
      <div className="alliance-system-grid">
        <button onClick={() => setView("rallies")}><span>⚔</span><small>WAR ARRAY</small><b>RALLY BEACON</b><p>Formation engine reserved for the next battle batch.</p><em>2 PROJECTIONS</em></button>
        <button onClick={() => setView("skills")}><span>⌁</span><small>SHARED DOCTRINE</small><b>ALLIANCE SKILLS</b><p>Turn chapter research into permanent member advantages.</p><em>{alliance.skillPoints} POINTS</em></button>
        <button onClick={() => setView("governance")}><span>◈</span><small>COMMAND CONSENSUS</small><b>GOVERNANCE</b><p>Founding authority, R4 command and anonymous succession.</p><em>{activeChallenge ? "BALLOT LIVE" : "STABLE"}</em></button>
        <button onClick={() => setView("exchange")}><span>◇</span><small>CHAPTER STORES</small><b>ALLIANCE EXCHANGE</b><p>Convert service credits into frontier instruments.</p><em>{membership?.credits ?? 0} CREDITS</em></button>
      </div>
      <section className="alliance-lower"><button onClick={() => setView("roster")}><small>COMMAND COUNCIL</small><b>{alliance.members.filter((member) => member.rank === "R5" || member.rank === "R4").map((member) => `${member.rank} ${member.name}`).join(" · ") || "R5 SIGNAL PENDING"}</b><span>OPEN ROSTER →</span></button><button onClick={() => setView("operations")}><small>OPERATIONS ARRAY</small><b>{alliance.applications.filter((application) => application.status === "pending").length} PETITIONS · {alliance.napAllianceIds.length} NAP · {alliance.warAllianceIds.length} WAR</b><span>OPEN CONTROL →</span></button></section>
    </>}

    {view === "decree" && <AlliancePanel title="CHAPTER DECREE" kicker="LAW, TREATY & SIGNAL HISTORY" onBack={() => setView("home")}>
      <div className="alliance-standards"><div><small>ENTRY STANDARD</small><b>{alliance.minHoldingDisplay}</b></div><div><small>ACTIVE STANDARD</small><b>{alliance.activeStandard}</b></div><div><small>NAP CORRIDORS</small><b>{alliance.napAllianceIds.length ? alliance.napAllianceIds.join(" · ") : "NONE DECLARED"}</b></div></div>
      <div className="alliance-rules"><h3>CHAPTER LAW</h3>{alliance.rules.map((rule, index) => <p key={rule}><span>{String(index + 1).padStart(2, "0")}</span>{rule}</p>)}</div>
      <div className="alliance-timeline">{[...alliance.decrees].sort((a, b) => b.createdAt - a.createdAt).map((decree) => <article key={decree.id}><time>{new Date(decree.createdAt).toLocaleString()}</time><h3>{decree.title}</h3><p>{decree.body}</p><small>TRANSMITTED BY {decree.author}</small></article>)}</div>
    </AlliancePanel>}

    {view === "rallies" && <AlliancePanel title="RALLY BEACON" kicker="TACTICAL PREVIEW · FORMATION ENGINE NEXT" onBack={() => setView("home")}><div className="alliance-rally-list"><article><span className="boss">BOSS</span><div><b>VOID LEVIATHAN · L12</b><p>NyxValidator leads · 4/8 fleets</p></div><time>18:42</time><button disabled>PREVIEW</button></article><article><span className="pvp">PVP</span><div><b>[MOG] WHALESIGNAL</b><p>R4 authorization · 2/6 fleets</p></div><time>04:17</time><button disabled>PREVIEW</button></article></div></AlliancePanel>}

    {view === "skills" && <AlliancePanel title="ALLIANCE SKILLS" kicker={`${alliance.skillPoints} DOCTRINE POINTS AVAILABLE`} onBack={() => setView("home")}><div className="alliance-skill-grid">{([{ key: "growth", name: "FRONTIER YIELD", text: "+1% build and gathering speed per level" }, { key: "warfare", name: "FORMATION MASS", text: "+1% rally capacity and march speed per level" }, { key: "mutualAid", name: "MUTUAL AID", text: "+1% healing speed; strengthens chapter help" }] as const).map((skill) => <article key={skill.key}><small>{skill.key.toUpperCase()}</small><h3>{skill.name}</h3><p>{skill.text}</p><div><b>LV.{alliance.skillLevels[skill.key]}/5</b><i><em style={{ width: `${alliance.skillLevels[skill.key] * 20}%` }} /></i></div><button disabled={!(["R4", "R5"].includes(membership?.rank || "")) || alliance.skillPoints < 1} onClick={() => { const result = upgradeAllianceSkill(alliance.id, address, skill.key); refresh(result.reason || `${skill.name} resonated.`); }}>RESONATE</button></article>)}</div></AlliancePanel>}

    {view === "governance" && <AlliancePanel title="GOVERNANCE" kicker="AUTHORITY IS A LIVE SIGNAL" onBack={() => setView("home")}>
      {activeChallenge ? <section className="alliance-ballot"><small>COMMAND CHALLENGE // {countdown(activeChallenge.closesAt - now)} REMAINS</small><h3>{activeChallenge.initiatorName} opened succession.</h3><p>Votes are sealed. The roster snapshot cannot change until the relay closes.</p><div>{alliance.members.map((member) => <button key={member.address} onClick={() => { const result = castLeadershipVote(alliance.id, address, member.address); refresh(result.reason || "Your vote entered the sealed relay."); }}><span>{member.rank}</span><b>{member.name}</b><em>CAST SEALED VOTE</em></button>)}</div></section> : <section className="alliance-challenge"><small>COMMAND CHANNEL // QUIET</small><h3>Authority may be challenged by any established signal.</h3><p>The initiator is public. Every vote is anonymous. The ballot runs for 48 hours; the chapter then enters a seven-day calm.</p><select value={candidateAddress} onChange={(event) => setCandidateAddress(event.target.value)}><option value="">SELECT SUCCESSOR SIGNAL</option>{alliance.members.map((member) => <option key={member.address} value={member.address}>{member.rank} · {member.name}</option>)}</select><button disabled={!candidateAddress} onClick={() => { const result = initiateLeadershipChallenge(profile, candidateAddress); refresh(result.reason || "Command challenge transmitted."); }}>OPEN COMMAND CHALLENGE</button></section>}
      <div className="alliance-governance-rules"><span>MEMBER TENURE<b>7 DAYS</b></span><span>BALLOT WINDOW<b>48 HOURS</b></span><span>QUORUM<b>40%</b></span><span>VOTE PRIVACY<b>SEALED</b></span></div>
    </AlliancePanel>}

    {view === "exchange" && <AlliancePanel title="ALLIANCE EXCHANGE" kicker={`${membership?.credits ?? 0} SERVICE CREDITS · SUPPLY PREVIEW`} onBack={() => setView("home")}><div className="alliance-exchange-grid">{[["5M CHRONO SHARD", 25], ["SCAN CHARGE", 60], ["PEACE VEIL · 8H", 240], ["TACTICAL WARP", 420]].map(([name, price]) => <article key={String(name)}><span>◇</span><b>{name}</b><small>CHAPTER ISSUE</small><button disabled>{price} CREDITS · LOCKED</button></article>)}</div><p className="alliance-exchange-note">Supply manifests are visible, but issuance stays locked until consumable inventory is connected.</p></AlliancePanel>}

    {view === "roster" && <AlliancePanel title="SIGNAL ROSTER" kicker={`${alliance.members.length} CIVILIZATIONS SYNCHRONIZED`} onBack={() => setView("home")}><div className="alliance-roster">{[...alliance.members].sort((a, b) => Number(b.rank.slice(1)) - Number(a.rank.slice(1))).map((member) => <article key={member.address}><span>{member.name.slice(0, 1)}</span><div><b>{member.name}</b><small>{member.address.slice(0, 7)}…{member.address.slice(-5)}</small></div><em className={member.holdingStatus}>{member.holdingStatus === "verified" ? "VERIFIED" : "SUSPENDED"}</em><strong>{member.rank}</strong><small>{member.contribution} CONTRIBUTION</small>{membership?.rank === "R5" && member.rank !== "R5" && <div className="alliance-member-command"><select value={member.rank} onChange={(event) => { const result = setAllianceMemberRank(alliance.id, address, member.address, event.target.value as "R1" | "R2" | "R3" | "R4"); refresh(result.reason || `${member.name} command rank updated.`); }}><option>R1</option><option>R2</option><option>R3</option><option>R4</option></select><button onClick={() => { const result = removeAllianceMember(alliance.id, address, member.address); refresh(result.reason || `${member.name} was severed from the chapter.`); }}>EXPEL</button></div>}</article>)}</div><button className="alliance-withdraw" onClick={leave}>WITHDRAW FROM CHAPTER</button></AlliancePanel>}

    {view === "operations" && <AlliancePanel title="OPERATIONS CONTROL" kicker="RECRUITMENT, STANDARDS & DIPLOMACY" onBack={() => setView("home")}>
      <div className="alliance-ops-grid">
        <section><header><small>ENTRY PETITIONS</small><b>{alliance.applications.filter((application) => application.status === "pending").length} WAITING</b></header><div className="alliance-applications">{alliance.applications.filter((application) => application.status === "pending").length ? alliance.applications.filter((application) => application.status === "pending").map((application) => <article key={application.address}><div><b>{application.name}</b><small>{application.address.slice(0, 8)}…{application.address.slice(-5)} · {application.holdingDisplay}</small></div><button disabled={!(["R4", "R5"].includes(membership?.rank || ""))} onClick={() => { const result = reviewAllianceApplication(alliance.id, address, application.address, true); refresh(result.reason || `${application.name} synchronized.`); }}>ACCEPT</button><button disabled={!(["R4", "R5"].includes(membership?.rank || ""))} className="reject" onClick={() => { const result = reviewAllianceApplication(alliance.id, address, application.address, false); refresh(result.reason || `${application.name} declined.`); }}>DECLINE</button></article>) : <p>No unreviewed signals.</p>}</div></section>
        <section><header><small>CHAPTER STANDARD</small><b>R5 CONTROL</b></header><label>MINIMUM {alliance.symbol} HOLDING<input type="number" min="0" step="any" disabled={alliance.kind === "default"} value={holdingStandard} onChange={(event) => setHoldingStandard(event.target.value)} placeholder={alliance.kind === "default" ? "OPEN PASSAGE" : alliance.minHoldingAmount} /></label><label>ACTIVE SIGNAL<input value={activeStandard} onChange={(event) => setActiveStandard(event.target.value)} placeholder={alliance.activeStandard} /></label><label>GATE<select disabled={alliance.kind === "default"} defaultValue={alliance.joinPolicy} id="alliance-join-policy"><option value="open">OPEN</option><option value="application">APPLICATION</option></select></label><button disabled={membership?.rank !== "R5"} onClick={() => { const policy = (document.getElementById("alliance-join-policy") as HTMLSelectElement)?.value as "open" | "application"; const result = updateAllianceStandards(alliance.id, address, { minHoldingAmount: alliance.kind === "default" ? undefined : holdingStandard || undefined, activeStandard: activeStandard || undefined, joinPolicy: policy }); refresh(result.reason || "Chapter standards transmitted."); }}>TRANSMIT STANDARD</button></section>
      </div>
      {!!incomingNap.length && <section className="alliance-nap-inbox"><header><small>INBOUND TREATIES</small><b>{incomingNap.length} AWAITING RATIFICATION</b></header>{incomingNap.map(({ request, source }) => <article key={request.id}><div><b>[{source.symbol}] {source.name}</b><small>PROPOSED {new Date(request.createdAt).toLocaleString()}</small></div><button disabled={membership?.rank !== "R5"} onClick={() => { const result = reviewAllianceNap(alliance.id, address, request.id, true); refresh(result.reason || `NAP with ${source.symbol} ratified.`); }}>RATIFY</button><button disabled={membership?.rank !== "R5"} className="reject" onClick={() => { const result = reviewAllianceNap(alliance.id, address, request.id, false); refresh(result.reason || `NAP proposal from ${source.symbol} rejected.`); }}>REJECT</button></article>)}</section>}
      <section className="alliance-diplomacy"><header><small>DIPLOMATIC ARRAY</small><b>R5 CONTROL · TACTICAL NAMEPLATES UPDATE LIVE</b></header>{directory.alliances.filter((entry) => entry.id !== alliance.id && entry.status === "active").map((entry) => { const stance = alliance.warAllianceIds.includes(entry.id) ? "war" : alliance.napAllianceIds.includes(entry.id) ? "nap" : "neutral"; return <article key={entry.id} style={{ "--alliance": entry.color } as React.CSSProperties}><span>{entry.symbol.slice(0, 2)}</span><div><b>[{entry.symbol}] {entry.name}</b><small>CHAPTER {String(entry.chapter).padStart(3, "0")}</small></div><select value={stance} disabled={membership?.rank !== "R5"} onChange={(event) => { const result = setAllianceDiplomacy(alliance.id, address, entry.id, event.target.value as "neutral" | "nap" | "war"); refresh(result.reason || `${entry.symbol} stance updated.`); }}><option value="neutral">NEUTRAL · WHITE</option><option value="nap">REQUEST NAP · GREEN</option><option value="war">WAR · RED</option></select></article>; })}</section>
    </AlliancePanel>}
  </main><MiniComms address={address} profile={profile} onOpenMessages={onMessages} /></section>;
}

function AlliancePanel({ title, kicker, onBack, children }: { title: string; kicker: string; onBack: () => void; children: React.ReactNode }) {
  return <section className="alliance-panel"><header><button onClick={onBack}>← COMMAND</button><div><small>{kicker}</small><h2>{title}</h2></div></header>{children}</section>;
}
