import { useEffect, useMemo, useState } from "react";
import type { TokenHolding } from "./lib/blockscout";
import type { Profile } from "./lib/profile";
import { saveProfile } from "./lib/profile";
import { capacity, mightBreakdown, prodPerHour, project, totalTroops, worldMarchSlots } from "./lib/game";
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
  endorseCandidate, foundAllianceFromToken, gmCompleteLeadershipChallenge, gmPrepareAlliance, gmSeedAlliance, helpAll, initiateLeadershipChallenge,
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
  const location = city?.kind === "city" ? `SECTOR ${worldSession!.world.stateId.slice(-6).toUpperCase()} · HOME ${Math.round(city.position.x).toString().padStart(3, "0")}:${Math.round(city.position.y).toString().padStart(3, "0")}` : "RHCHAIN 4663 · HOME NOT CHARTED";
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
    const result = requestAllianceEntry(id, profile, holdings, Date.now(), gm);
    if (!result.ok) return refresh(result.reason);
    if (result.applied) return refresh("Application sent. An R4 or R5 can review it.");
    bindProfile(result.alliance!); refresh("You joined the alliance.");
  }
  function leave() { const result = leaveAlliance(profile, Date.now(), gm); if (!result.ok) return refresh(result.reason); bindProfile(null); setView("home"); refresh(gm ? "You left the alliance. GM join cooldown skipped." : "You left the alliance. You can join another in 24 hours."); }
  function found(token: TokenHolding) { const result = foundAllianceFromToken(token, profile); if (!result.ok) return refresh(result.reason); bindProfile(result.alliance!); refresh("Alliance created. Recruit five more members to activate it."); }
  function assist() { const result = helpAll(profile); refresh(result.helped ? `Helped ${result.helped} members · +${result.rewarded} contribution.` : result.reason || "No members need help right now."); }

  const nav = <GameNav view="alliance" profile={profile} townhallLevel={game.buildings.keep.lvl} location={location}
    resources={game.res} incomePerHour={prodPerHour(game)} resourceCap={capacity(game)} energy={energy} energyCap={energyCap} activeFleets={activeFleets} fleetCap={worldPlayer?.marchSlots ?? worldMarchSlots(game)}
    standing={totalTroops(game)} wounded={game.wounded} might={mightBreakdown(game).total}
    onAlliance={() => setView("home")} onCity={onCity} onWorld={onWorld} onMessages={onMessages} onProfile={onProfile} />;

  if (!alliance) {
    const eligible = availableAlliances(holdings, directory, gm);
    const unregistered = holdings.filter((token) => !tokenAllianceForHolding(token, directory));
    return <section className="alliance-page"><CosmicBackdrop address={address} />{nav}<main className="alliance-entry">
      <header><small>ALLIANCES</small><h1>Join an alliance.</h1><p>Fight together, help members, and unlock alliance bonuses.</p></header>
      {notice && <div className="alliance-notice">{notice}</div>}
      <div className="alliance-entry-grid">
        {eligible.map((entry) => <article className="alliance-entry-card" key={entry.id} style={{ "--alliance": entry.color } as React.CSSProperties}>
          <div className="alliance-emblem">{entry.iconUrl ? <img src={entry.iconUrl} alt="" /> : entry.symbol.slice(0, 2)}</div>
          <small>ALLIANCE #{String(entry.chapter).padStart(3, "0")}</small><h2>[{entry.symbol}] {entry.name}</h2>
          <p>{entry.kind === "default" ? "Open to everyone. No token required." : entry.minHoldingDisplay}</p>
          <button onClick={() => join(entry.id)}>JOIN →</button>
        </article>)}
      </div>
      {!!unregistered.length && <section className="alliance-foundry"><small>ELIGIBLE TOKENS</small><h2>Create a token alliance.</h2><p>The token name, ticker, alliance number, and color are assigned automatically. You can change the emblem later.</p><div>{unregistered.map((token) => <button key={token.address} onClick={() => found(token)}><b>${token.symbol}</b><span>{token.name}</span><em>CREATE →</em></button>)}</div></section>}
    </main></section>;
  }

  const openHelps = alliance.helps.filter((help) => !help.closedAt && help.helpers.length < 25);
  if (alliance.status === "forming") {
    const endorsements = alliance.endorsements[address] ?? [];
    return <section className="alliance-page"><CosmicBackdrop address={address} />{nav}<main className="alliance-forming">
      <header style={{ "--alliance": alliance.color } as React.CSSProperties}><small>FORMING // ALLIANCE #{String(alliance.chapter).padStart(3, "0")}</small><h1>[{alliance.symbol}] {alliance.name}</h1><p>Recruit at least 6 members. The alliance activates when 5 members support the same R5.</p></header>
      {notice && <div className="alliance-notice">{notice}</div>}
      <div className="alliance-forming-meter"><div><span>MEMBERS</span><b>{alliance.members.length}/6</b></div><i><em style={{ width: `${Math.min(100, alliance.members.length / 6 * 100)}%` }} /></i><div><span>SUPPORT FOR YOU</span><b>{endorsements.length}/5</b></div></div>
      <div className="alliance-forming-roster">{alliance.members.map((member) => <article key={member.address}><span>{member.name.slice(0, 1)}</span><div><b>{member.name}</b><small>{member.address.slice(0, 6)}…{member.address.slice(-4)}</small></div>{member.address.toLowerCase() !== address.toLowerCase() && <button onClick={() => { const result = endorseCandidate(alliance.id, address, member.address); refresh(result.reason || `You supported ${member.name} for R5.`); }}>SUPPORT FOR R5</button>}</article>)}</div>
      {gm && <div className="alliance-forming-gm"><button className="alliance-gm" onClick={() => { gmSeedAlliance(alliance.id); refresh("GM: added founding members."); }}>GM // ADD 6 MEMBERS</button><button className="alliance-gm" onClick={() => { gmPrepareAlliance(alliance.id, address); refresh("GM: alliance activated and R5 access granted."); }}>GM // ACTIVATE ALLIANCE</button></div>}
      <button className="alliance-withdraw" onClick={leave}>LEAVE ALLIANCE</button>
    </main><MiniComms address={address} profile={profile} onOpenMessages={onMessages} /></section>;
  }

  const activeChallenge = alliance.challenges.find((challenge) => !challenge.resolvedAt && challenge.closesAt > now);
  const incomingNap = directory.alliances.flatMap((entry) => entry.diplomacyRequests.map((request) => ({ request, source: entry }))).filter(({ request }) => request.toAllianceId === alliance.id && request.status === "pending");
  return <section className="alliance-page"><CosmicBackdrop address={address} />{nav}<main className="alliance-command">
    {notice && <div className="alliance-notice">{notice}</div>}
    {gm && <div className="alliance-gm-strip"><span>LOCAL GM // ALLIANCE</span><button onClick={() => { gmPrepareAlliance(alliance.id, address); refresh("GM: R5 access, members, credits, and skill points added."); }}>ENABLE ALL FEATURES</button></div>}
    <header className="alliance-command-head" style={{ "--alliance": alliance.color } as React.CSSProperties}>
      <div className="alliance-emblem large">{alliance.iconUrl ? <img src={alliance.iconUrl} alt="" /> : alliance.symbol.slice(0, 2)}</div>
      <div><small>ALLIANCE #{String(alliance.chapter).padStart(3, "0")} // ACTIVE</small><h1>[{alliance.symbol}] {alliance.name}</h1><p>{alliance.members.length} MEMBERS · {membership?.rank} · {alliance.minHoldingDisplay}</p></div>
      <button onClick={() => setView("decree")}>ANNOUNCEMENTS <span>↗</span></button>
    </header>

    {view === "home" && <>
      <section className="alliance-brief"><div><small>LATEST ANNOUNCEMENT</small><b>{alliance.decrees[0]?.title}</b><p>{alliance.decrees[0]?.body}</p></div><button onClick={assist}><span>◇</span><b>HELP ALL</b><small>{openHelps.length} MEMBERS NEED HELP</small></button></section>
      <div className="alliance-system-grid">
        <button onClick={() => setView("rallies")}><span>⚔</span><small>COMBAT</small><b>RALLIES</b><p>Join alliance attacks against bosses and enemies.</p><em>PREVIEW</em></button>
        <button onClick={() => setView("skills")}><span>⌁</span><small>PERMANENT BONUSES</small><b>ALLIANCE SKILLS</b><p>Improve building, healing, gathering, and marches.</p><em>{alliance.skillPoints} POINTS</em></button>
        <button onClick={() => setView("governance")}><span>◈</span><small>LEADERSHIP</small><b>GOVERNANCE</b><p>View the R5, vote, or start a leadership challenge.</p><em>{activeChallenge ? "VOTE OPEN" : "NO ACTIVE VOTE"}</em></button>
        <button onClick={() => setView("exchange")}><span>◇</span><small>REWARDS</small><b>ALLIANCE STORE</b><p>Spend contribution credits on alliance items.</p><em>{membership?.credits ?? 0} CREDITS</em></button>
      </div>
      <section className="alliance-lower"><button onClick={() => setView("roster")}><small>LEADERSHIP</small><b>{alliance.members.filter((member) => member.rank === "R5" || member.rank === "R4").map((member) => `${member.rank} ${member.name}`).join(" · ") || "R5 NOT ELECTED"}</b><span>VIEW MEMBERS →</span></button><button onClick={() => setView("operations")}><small>MANAGEMENT</small><b>{alliance.applications.filter((application) => application.status === "pending").length} APPLICATIONS · {alliance.napAllianceIds.length} NAP · {alliance.warAllianceIds.length} WAR</b><span>MANAGE →</span></button></section>
    </>}

    {view === "decree" && <AlliancePanel title="ANNOUNCEMENTS" kicker="RULES, REQUIREMENTS & ALLIANCE NEWS" onBack={() => setView("home")}>
      <div className="alliance-standards"><div><small>JOIN REQUIREMENT</small><b>{alliance.minHoldingDisplay}</b></div><div><small>ACTIVITY REQUIREMENT</small><b>{alliance.activeStandard}</b></div><div><small>NAP ALLIANCES</small><b>{alliance.napAllianceIds.length ? alliance.napAllianceIds.join(" · ") : "NONE"}</b></div></div>
      <div className="alliance-rules"><h3>ALLIANCE RULES</h3>{alliance.rules.map((rule, index) => <p key={rule}><span>{String(index + 1).padStart(2, "0")}</span>{rule}</p>)}</div>
      <div className="alliance-timeline">{[...alliance.decrees].sort((a, b) => b.createdAt - a.createdAt).map((decree) => <article key={decree.id}><time>{new Date(decree.createdAt).toLocaleString()}</time><h3>{decree.title}</h3><p>{decree.body}</p><small>POSTED BY {decree.author}</small></article>)}</div>
    </AlliancePanel>}

    {view === "rallies" && <AlliancePanel title="RALLIES" kicker="COMING IN THE NEXT COMBAT UPDATE" onBack={() => setView("home")}><div className="alliance-rally-list"><article><span className="boss">BOSS</span><div><b>VOID LEVIATHAN · L12</b><p>Led by NyxValidator · 4/8 fleets</p></div><time>18:42</time><button disabled>PREVIEW</button></article><article><span className="pvp">PVP</span><div><b>[MOG] WHALESIGNAL</b><p>Led by an R4 · 2/6 fleets</p></div><time>04:17</time><button disabled>PREVIEW</button></article></div></AlliancePanel>}

    {view === "skills" && <AlliancePanel title="ALLIANCE SKILLS" kicker={`${alliance.skillPoints} SKILL POINTS AVAILABLE`} onBack={() => setView("home")}><div className="alliance-skill-grid">{([{ key: "growth", name: "DEVELOPMENT", text: "+1% building and gathering speed per level" }, { key: "warfare", name: "WARFARE", text: "+1% march capacity and march speed per level" }, { key: "mutualAid", name: "RECOVERY", text: "+1% healing speed per level" }] as const).map((skill) => <article key={skill.key}><small>{skill.key.toUpperCase()}</small><h3>{skill.name}</h3><p>{skill.text}</p><div><b>LV.{alliance.skillLevels[skill.key]}/5</b><i><em style={{ width: `${alliance.skillLevels[skill.key] * 20}%` }} /></i></div><button disabled={!(["R4", "R5"].includes(membership?.rank || "")) || alliance.skillPoints < 1} onClick={() => { const result = upgradeAllianceSkill(alliance.id, address, skill.key); refresh(result.reason || `${skill.name} upgraded.`); }}>UPGRADE</button></article>)}</div></AlliancePanel>}

    {view === "governance" && <AlliancePanel title="GOVERNANCE" kicker="ALLIANCE LEADERSHIP" onBack={() => setView("home")}>
      {activeChallenge ? <section className="alliance-ballot"><small>LEADERSHIP VOTE // {countdown(activeChallenge.closesAt - now)} LEFT</small><h3>{activeChallenge.initiatorName} started a leadership challenge.</h3><p>Votes are anonymous. Eligible voters were locked when the vote began.</p><div>{alliance.members.map((member) => <button key={member.address} onClick={() => { const result = castLeadershipVote(alliance.id, address, member.address); refresh(result.reason || "Vote submitted."); }}><span>{member.rank}</span><b>{member.name}</b><em>VOTE</em></button>)}</div>{gm && <button className="alliance-gm" onClick={() => { const result = gmCompleteLeadershipChallenge(alliance.id); refresh(result.reason || `${activeChallenge.candidateName} is now R5.`); }}>GM // COMPLETE VOTE</button>}</section> : <section className="alliance-challenge"><small>NO ACTIVE VOTE</small><h3>Challenge the current R5.</h3><p>The challenger is public, but all votes are anonymous. Voting lasts 48 hours. A new challenge cannot begin for 7 days.</p><select value={candidateAddress} onChange={(event) => setCandidateAddress(event.target.value)}><option value="">SELECT R5 CANDIDATE</option>{alliance.members.map((member) => <option key={member.address} value={member.address}>{member.rank} · {member.name}</option>)}</select><button disabled={!candidateAddress} onClick={() => { const result = initiateLeadershipChallenge(profile, candidateAddress, Date.now(), gm); refresh(result.reason || "Leadership challenge started."); }}>START CHALLENGE</button></section>}
      <div className="alliance-governance-rules"><span>MEMBERSHIP REQUIRED<b>7 DAYS</b></span><span>VOTING PERIOD<b>48 HOURS</b></span><span>MINIMUM TURNOUT<b>40%</b></span><span>VOTES<b>ANONYMOUS</b></span></div>
    </AlliancePanel>}

    {view === "exchange" && <AlliancePanel title="ALLIANCE STORE" kicker={`${membership?.credits ?? 0} ALLIANCE CREDITS · PREVIEW`} onBack={() => setView("home")}><div className="alliance-exchange-grid">{[["5M SPEEDUP", 25], ["SCAN CHARGE", 60], ["8H SHIELD", 240], ["TELEPORT", 420]].map(([name, price]) => <article key={String(name)}><span>◇</span><b>{name}</b><small>ALLIANCE ITEM</small><button disabled>{price} CREDITS · LOCKED</button></article>)}</div><p className="alliance-exchange-note">Purchases will unlock when the item inventory is ready.</p></AlliancePanel>}

    {view === "roster" && <AlliancePanel title="MEMBERS" kicker={`${alliance.members.length} / ${alliance.maxMembers} MEMBERS`} onBack={() => setView("home")}><div className="alliance-roster">{[...alliance.members].sort((a, b) => Number(b.rank.slice(1)) - Number(a.rank.slice(1))).map((member) => <article key={member.address}><span>{member.name.slice(0, 1)}</span><div><b>{member.name}</b><small>{member.address.slice(0, 7)}…{member.address.slice(-5)}</small></div><em className={member.holdingStatus}>{member.holdingStatus === "verified" ? "ELIGIBLE" : "SUSPENDED"}</em><strong>{member.rank}</strong><small>{member.contribution} CONTRIBUTION</small>{membership?.rank === "R5" && member.rank !== "R5" && <div className="alliance-member-command"><select value={member.rank} onChange={(event) => { const result = setAllianceMemberRank(alliance.id, address, member.address, event.target.value as "R1" | "R2" | "R3" | "R4"); refresh(result.reason || `${member.name} is now ${event.target.value}.`); }}><option>R1</option><option>R2</option><option>R3</option><option>R4</option></select><button onClick={() => { const result = removeAllianceMember(alliance.id, address, member.address); refresh(result.reason || `${member.name} was removed from the alliance.`); }}>REMOVE</button></div>}</article>)}</div><button className="alliance-withdraw" onClick={leave}>LEAVE ALLIANCE</button></AlliancePanel>}

    {view === "operations" && <AlliancePanel title="ALLIANCE MANAGEMENT" kicker="APPLICATIONS, REQUIREMENTS & DIPLOMACY" onBack={() => setView("home")}>
      <div className="alliance-ops-grid">
        <section><header><small>JOIN APPLICATIONS</small><b>{alliance.applications.filter((application) => application.status === "pending").length} PENDING</b></header><div className="alliance-applications">{alliance.applications.filter((application) => application.status === "pending").length ? alliance.applications.filter((application) => application.status === "pending").map((application) => <article key={application.address}><div><b>{application.name}</b><small>{application.address.slice(0, 8)}…{application.address.slice(-5)} · {application.holdingDisplay}</small></div><button disabled={!(["R4", "R5"].includes(membership?.rank || ""))} onClick={() => { const result = reviewAllianceApplication(alliance.id, address, application.address, true); refresh(result.reason || `${application.name} joined the alliance.`); }}>ACCEPT</button><button disabled={!(["R4", "R5"].includes(membership?.rank || ""))} className="reject" onClick={() => { const result = reviewAllianceApplication(alliance.id, address, application.address, false); refresh(result.reason || `${application.name}'s application was declined.`); }}>DECLINE</button></article>) : <p>No pending applications.</p>}</div></section>
        <section><header><small>MEMBERSHIP REQUIREMENTS</small><b>R5 ONLY</b></header><label>MINIMUM {alliance.symbol} HOLDING<input type="number" min="0" step="any" disabled={alliance.kind === "default"} value={holdingStandard} onChange={(event) => setHoldingStandard(event.target.value)} placeholder={alliance.kind === "default" ? "NO TOKEN REQUIRED" : alliance.minHoldingAmount} /></label><label>ACTIVITY REQUIREMENT<input value={activeStandard} onChange={(event) => setActiveStandard(event.target.value)} placeholder={alliance.activeStandard} /></label><label>JOIN METHOD<select disabled={alliance.kind === "default"} defaultValue={alliance.joinPolicy} id="alliance-join-policy"><option value="open">OPEN</option><option value="application">APPLICATION REQUIRED</option></select></label><button disabled={membership?.rank !== "R5"} onClick={() => { const policy = (document.getElementById("alliance-join-policy") as HTMLSelectElement)?.value as "open" | "application"; const result = updateAllianceStandards(alliance.id, address, { minHoldingAmount: alliance.kind === "default" ? undefined : holdingStandard || undefined, activeStandard: activeStandard || undefined, joinPolicy: policy }); refresh(result.reason || "Requirements updated."); }}>SAVE</button></section>
      </div>
      {!!incomingNap.length && <section className="alliance-nap-inbox"><header><small>NAP REQUESTS</small><b>{incomingNap.length} PENDING</b></header>{incomingNap.map(({ request, source }) => <article key={request.id}><div><b>[{source.symbol}] {source.name}</b><small>RECEIVED {new Date(request.createdAt).toLocaleString()}</small></div><button disabled={membership?.rank !== "R5"} onClick={() => { const result = reviewAllianceNap(alliance.id, address, request.id, true); refresh(result.reason || `NAP with ${source.symbol} accepted.`); }}>ACCEPT</button><button disabled={membership?.rank !== "R5"} className="reject" onClick={() => { const result = reviewAllianceNap(alliance.id, address, request.id, false); refresh(result.reason || `NAP request from ${source.symbol} declined.`); }}>DECLINE</button></article>)}</section>}
      <section className="alliance-diplomacy"><header><small>DIPLOMACY</small><b>R5 ONLY · MAP COLORS UPDATE IMMEDIATELY</b></header>{directory.alliances.filter((entry) => entry.id !== alliance.id && entry.status === "active").map((entry) => { const stance = alliance.warAllianceIds.includes(entry.id) ? "war" : alliance.napAllianceIds.includes(entry.id) ? "nap" : "neutral"; return <article key={entry.id} style={{ "--alliance": entry.color } as React.CSSProperties}><span>{entry.symbol.slice(0, 2)}</span><div><b>[{entry.symbol}] {entry.name}</b><small>ALLIANCE #{String(entry.chapter).padStart(3, "0")}</small></div><select value={stance} disabled={membership?.rank !== "R5"} onChange={(event) => { const result = setAllianceDiplomacy(alliance.id, address, entry.id, event.target.value as "neutral" | "nap" | "war"); refresh(result.reason || `Relationship with ${entry.symbol} updated.`); }}><option value="neutral">NEUTRAL · WHITE</option><option value="nap">REQUEST NAP · GREEN</option><option value="war">AT WAR · RED</option></select></article>; })}</section>
    </AlliancePanel>}
  </main><MiniComms address={address} profile={profile} onOpenMessages={onMessages} /></section>;
}

function AlliancePanel({ title, kicker, onBack, children }: { title: string; kicker: string; onBack: () => void; children: React.ReactNode }) {
  return <section className="alliance-panel"><header><button onClick={onBack}>← ALLIANCE</button><div><small>{kicker}</small><h2>{title}</h2></div></header>{children}</section>;
}
