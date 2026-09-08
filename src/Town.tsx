import { useEffect, useMemo, useRef, useState } from "react";
import {
  GameState, BKey, TroopKey, ResKey, BUILDINGS, BUILDING_ORDER, RES, RES_ORDER, TROOPS_META, TROOP_ORDER,
  project, startUpgrade, startTrain, upgradeCost, upgradeTimeSec,
  buildingOperationBlockReason,
  isUnlocked, isUpgradable, unlockAtKeep, capForLevel, prodPerHour, totalTroops,
  mightBreakdown, troopStats, troopBatchCost, troopCountByType, maxTroopsForType, trainQueueSize, TRAINING_BUILDING,
  activeUpgrades, buildQueueSlots,
  trainSpeedMult, unlockedTroopTiers,
  promotionBatchCost, promotionQueueSize, promotionTimePerTroop, promotionUnlocked, promotionUnlockLevel, startPromote,
  healingBatchCost, healingDurationSec, healingSpeedMult, hospitalCapacity, startHealing,
  displayResource, displayTroops,
  missingTownhallPrerequisites,
  accountMarchCapacity, accountResearchModifiers, startResearch, worldMarchSlots,
} from "./lib/game";
import {
  ResearchBranch, effectLabel, researchBlockReason,
  RESEARCH_EFFECT_BRANCH, researchConfig, researchCost, researchLevel, researchLevelRow, researchTech, researchTechs,
  researchTreeLayers,
} from "./lib/research";
import { loadGame, saveGame, initGame } from "./lib/gamestore";
import {
  gmFillResources, gmFillTroops, gmFinishQueues, gmMaxResearch, gmRaiseTownhall,
  gmRaiseBuilding, gmResetProgress,
  grantLocalGm, hasLocalGm, localGmRequested, revokeLocalGm,
} from "./lib/gm";
import { Profile } from "./lib/profile";
import { compact } from "./lib/format";
import { clearLocalWorldSession } from "./lib/world-adapter";
import { loadLocalWorldSession } from "./lib/world-adapter";
import { energyAt } from "./lib/world-engine";
import { getN } from "./lib/numbers";
import GameNav from "./GameNav";
import BuildingGlyph from "./BuildingGlyph";
import CosmicBackdrop from "./CosmicBackdrop";

const ECONOMY_BUILDINGS: BKey[] = ["bank", "oilwell", "powerplant"];
const COMMAND_BUILDINGS: BKey[] = ["storage", "wall"];
const MILITARY_BUILDINGS: BKey[] = ["armyCamp", "navalBase", "airfield"];
const INFRASTRUCTURE_BUILDINGS: BKey[] = ["academy", "hospital", "watchtower", "embassy", "milestone"];

function fmtMs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s / 60) + "m " + (s % 60) + "s";
  return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
}
function fmtSec(s: number): string { return fmtMs(s * 1000); }
function researchEffectName(key: string): string {
  return key.replace(/Bonus$/, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (value) => value.toUpperCase());
}

export default function Town({ address, profile, onWorld }: { address: string; profile: Profile; onWorld: () => void }) {
  const [game, setGame] = useState<GameState>(() => loadGame(address) || initGame(address));
  const [now, setNow] = useState(Date.now());
  const [msg, setMsg] = useState<string>("");
  const [away, setAway] = useState<{ cash: number; oil: number; power: number } | null>(null);
  const [trainQty, setTrainQty] = useState<Record<TroopKey, number>>({ army: 10, navy: 10, air: 10 });
  const [trainTier, setTrainTier] = useState<Record<TroopKey, number>>({ army: 1, navy: 1, air: 1 });
  const [trainingMode, setTrainingMode] = useState<Record<TroopKey, "train" | "promote">>({ army: "train", navy: "train", air: "train" });
  const [promoteFrom, setPromoteFrom] = useState<Record<TroopKey, number>>({ army: 1, navy: 1, air: 1 });
  const [healQty, setHealQty] = useState(10);
  const [researchBranch, setResearchBranch] = useState<ResearchBranch>("development");
  const [facilityOpen, setFacilityOpen] = useState<BKey | null>(null);
  const [commandTab, setCommandTab] = useState<"today" | "signals">("today");
  const [selectedResearchKey, setSelectedResearchKey] = useState("");
  const [gm, setGm] = useState(() => hasLocalGm(address));
  const [gmBuilding, setGmBuilding] = useState<BKey>("keep");
  const savedOnce = useRef(false);

  // Offline progress on entry (once).
  useEffect(() => {
    const base = loadGame(address) || initGame(address);
    const projected = project(base, Date.now());
    const gain = {
      cash: projected.res.cash - base.res.cash,
      oil: projected.res.oil - base.res.oil,
      power: projected.res.power - base.res.power,
    };
    if (gain.cash > 0 || gain.oil > 0 || gain.power > 0) setAway(gain);
    setGame(projected);
    saveGame(projected);
    savedOnce.current = true;
  }, [address]);

  // Local testing only: visiting localhost/?gm grants this connected wallet a
  // browser-local GM flag. import.meta.env.DEV makes the path inert in builds.
  useEffect(() => {
    if (localGmRequested()) grantLocalGm(address);
    setGm(hasLocalGm(address));
  }, [address]);

  // Heartbeat: re-render every second; commit when something finishes.
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setGame((g) => {
        const anyDone =
          BUILDING_ORDER.some((k) => g.buildings[k].finishAt > 0 && t >= g.buildings[k].finishAt) ||
          TROOP_ORDER.some((type) => g.training[type].finishAt > 0 && t >= g.training[type].finishAt) ||
          (g.healing.finishAt > 0 && t >= g.healing.finishAt) ||
          (g.researchQueue.finishAt > 0 && t >= g.researchQueue.finishAt);
        if (anyDone) { const ng = project(g, t); saveGame(ng); return ng; }
        return g;
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!facilityOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setFacilityOpen(null); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [facilityOpen]);

  const view = useMemo(() => project(game, now), [game, now]);
  const rate = prodPerHour(view);
  const troopsTotal = totalTroops(view);
  const mightScore = mightBreakdown(view);
  const buildQueues = BUILDING_ORDER.filter((building) => view.buildings[building].finishAt > 0);
  const worldStatus = useMemo(() => {
    const stored = loadLocalWorldSession(address);
    if (!stored) {
      const energyCap = Number(getN().world?.energy?.cap) || 100;
      return { location: "RHCHAIN 4663 · HOME NOT YET CHARTED", energy: energyCap, energyCap, activeFleets: 0, fleetCap: worldMarchSlots(view) };
    }
    const player = stored.world.players[stored.playerId];
    const city = player ? stored.world.entities[player.cityId] : null;
    const home = city?.kind === "city" ? `${Math.round(city.position.x).toString().padStart(3, "0")}:${Math.round(city.position.y).toString().padStart(3, "0")}` : "---:---";
    const activeFleets = Object.values(stored.world.marches).filter((march) => march.playerId === stored.playerId && march.state !== "completed").length;
    return {
      location: `SECTOR ${stored.world.stateId.slice(-6).toUpperCase()} · HOME ${home}`,
      energy: player ? energyAt(player, now, stored.world.config) : stored.world.config.energyCap,
      energyCap: stored.world.config.energyCap,
      activeFleets,
      fleetCap: player?.marchSlots ?? worldMarchSlots(view),
    };
  }, [address, now, view]);

  function act(fn: () => { state: GameState; ok: boolean; reason?: string }) {
    const r = fn();
    if (r.ok) { setGame(r.state); saveGame(r.state); setMsg(""); }
    else setMsg(r.reason || "Can't do that");
  }

  function gmAct(fn: (state: GameState) => GameState, message: string) {
    const next = fn(game);
    setGame(next);
    saveGame(next);
    setMsg(message);
  }

  return (
    <section className="town">
      <CosmicBackdrop />
      <GameNav view="city" profile={profile} townhallLevel={view.buildings.keep.lvl} location={worldStatus.location}
        resources={view.res} energy={worldStatus.energy} energyCap={worldStatus.energyCap}
        activeFleets={worldStatus.activeFleets} fleetCap={worldStatus.fleetCap} standing={troopsTotal} wounded={view.wounded}
        might={mightScore.total} onCity={() => {}} onWorld={onWorld} />


      {gm && (
        <div className="gm-panel">
          <div className="gm-panel-copy"><b>LOCAL GM</b></div>
          <div className="gm-actions">
            <button onClick={() => gmAct(gmFillResources, "GM: resources filled to Warehouse capacity.")}>Fill resources</button>
            <button onClick={() => gmAct(gmFillTroops, "GM: every trained arm filled to capacity at its highest unlocked tier.")}>Fill troops</button>
            <button onClick={() => gmAct(gmFinishQueues, "GM: active build, research, training and healing queues completed.")}>Finish queues</button>
            <button onClick={() => gmAct(gmMaxResearch, "GM: all three Research categories maxed. Account bonuses are active.")}>Max research</button>
            <button onClick={() => {
              const next = game.buildings.academy.lvl >= 1 ? game : gmRaiseBuilding(game, "academy");
              setGame(next);
              saveGame(next);
              setFacilityOpen("academy");
              setMsg(game.buildings.academy.lvl >= 1 ? "" : "GM: Research Institute built at Lv.1.");
            }}>Open Research</button>
            <span className="gm-building-stepper">
              <select aria-label="GM building" value={gmBuilding} onChange={(event) => setGmBuilding(event.target.value as BKey)}>
                {BUILDING_ORDER.filter(isUpgradable).map((building) => <option value={building} key={building}>{BUILDINGS[building].label} · Lv.{view.buildings[building].lvl}</option>)}
              </select>
              <button disabled={view.buildings[gmBuilding].lvl >= 30 || !!buildingOperationBlockReason(view, gmBuilding)} onClick={() => gmAct((state) => gmRaiseBuilding(state, gmBuilding), `GM: ${BUILDINGS[gmBuilding].label} raised by one level.`)}>Selected building +1</button>
            </span>
            <button disabled={view.buildings.keep.lvl >= 30} onClick={() => gmAct(gmRaiseTownhall, "GM: Townhall raised by one level.")}>Townhall +1</button>
            <button className="gm-reset" onClick={() => {
              if (!window.confirm("Reset this wallet's city? Buildings, resources, troops and queues will be cleared. Townhall returns to Lv.1.")) return;
              const next = gmResetProgress(address);
              clearLocalWorldSession(address);
              setAway(null);
              setGame(next);
              saveGame(next);
              setMsg("GM: city reset to a blank Townhall Lv.1 test state.");
            }}>Reset city</button>
            <button className="gm-off" onClick={() => { revokeLocalGm(address); setGm(false); setMsg(""); }}>Disable GM</button>
          </div>
        </div>
      )}

      {away && (away.cash > 0 || away.oil > 0 || away.power > 0) && (
        <div className="awaynote">🌙 While you were away: <b>+{compact(displayResource(away.cash))} Cash</b>, <b>+{compact(displayResource(away.oil))} Oil</b>, <b>+{compact(displayResource(away.power))} Power</b>
          <button className="mini" onClick={() => setAway(null)}>collect</button></div>
      )}
      {msg && <div className={"gmsg" + (msg.startsWith("GM:") ? " gmmsg" : "")}>{msg}</div>}

      <section className="build-queue" aria-label="Build queue">
        <header><span>BUILD QUEUE</span><b className="mono">{buildQueues.length}/{buildQueueSlots}</b></header>
        <div>{Array.from({ length: buildQueueSlots }, (_, slot) => {
          const building = buildQueues[slot];
          if (!building) return <div className="build-slot idle" key={slot}><i>＋</i><span>IDLE</span></div>;
          const state = view.buildings[building];
          return <button className="build-slot active" key={building} onClick={() => setFacilityOpen(building)}><span className="build-slot-glyph"><BuildingGlyph building={building} /></span><div><b>{BUILDINGS[building].label}</b><small>LV.{state.lvl + 1}</small></div><time className="mono">{fmtMs(state.finishAt - now)}</time><span className="build-slot-meter"><i style={{ width: upPct(building, state, now) + "%" }} /></span></button>;
        })}</div>
      </section>

      <section className="economy-strip" aria-label="Resource Network">
        <header><span>RESOURCE NETWORK</span><i>PRODUCTION</i></header>
        <div className="economy-nodes">
          {ECONOMY_BUILDINGS.map(renderEconomyBuilding)}
        </div>
      </section>

      {/* buildings */}
      <div className={`city-workspace${facilityOpen === "academy" && view.buildings.academy.lvl >= 1 ? " research-focus" : ""}`}>
        <div className="city-directory">
          <button type="button" className={`civilization-core${facilityOpen === "keep" ? " selected" : ""}`} onClick={() => setFacilityOpen("keep")}>
            <span className="civilization-core-glyph"><BuildingGlyph building="keep" /></span>
            <span className="civilization-core-copy"><small>CIVILIZATION CORE</small><b>{profile.name}</b><em>ONLINE</em></span>
            <span className="civilization-core-metrics"><span><small>CORE LEVEL</small><b className="mono">{view.buildings.keep.lvl}</b></span><span><small>SHIELD</small><b className="mono">{view.buildings.keep.lvl < 10 ? "ACTIVE" : "OFFLINE"}</b></span><i>›</i></span>
          </button>
          <section className="building-group command-group">
            <header><span>COMMAND</span></header>
            <div className="bgrid command-grid">{COMMAND_BUILDINGS.map(renderBuilding)}</div>
          </section>
          <section className="building-group military-group">
            <header><span>MILITARY</span></header>
            <div className="bgrid facility-grid">{MILITARY_BUILDINGS.map(renderBuilding)}</div>
          </section>
          <section className="building-group infrastructure-group">
            <header><span>INFRASTRUCTURE</span></header>
            <div className="bgrid facility-grid">{INFRASTRUCTURE_BUILDINGS.map(renderBuilding)}</div>
          </section>
        </div>
        {facilityOpen ? (() => {
          const trainingType = TROOP_ORDER.find((type) => TRAINING_BUILDING[type] === facilityOpen);
          const research = facilityOpen === "academy" && view.buildings.academy.lvl >= 1;
          const hospital = facilityOpen === "hospital";
          return (
            <aside className={`facility-inspector${research ? " research" : ""}`} aria-label={BUILDINGS[facilityOpen].label}>
              <header className="facility-inspector-head">
                <div><span className="facility-head-glyph"><BuildingGlyph building={facilityOpen} /></span><b>{BUILDINGS[facilityOpen].label}</b><small>LV.{view.buildings[facilityOpen].lvl}</small></div>
                <button aria-label="Close facility" onClick={() => { setFacilityOpen(null); setCommandTab("today"); }}>×</button>
              </header>
              <div className="facility-inspector-body">
                {research ? renderResearchCenter() : <>
                  {renderBuildingUpgrade(facilityOpen)}
                  {view.buildings[facilityOpen].lvl >= 1 && (trainingType ? renderTrainer(trainingType) : hospital ? <div className="facility-hospital">{renderHospitalControls(view.buildings.hospital.finishAt > 0)}</div> : null)}
                </>}
              </div>
            </aside>
          );
        })() : (
          <aside className="facility-inspector command-feed" aria-label="Command feed">{renderCommandFeed()}</aside>
        )}
      </div>
    </section>
  );

  function renderCommandFeed() {
    const signals: Array<{ time: string; text: string }> = [];
    buildQueues.forEach((building) => signals.push({ time: fmtMs(view.buildings[building].finishAt - now), text: `${BUILDINGS[building].label} upgrade in progress` }));
    TROOP_ORDER.forEach((type) => {
      const queue = view.training[type];
      if (queue.finishAt > 0) signals.push({ time: fmtMs(queue.finishAt - now), text: `${TROOPS_META[type].label} ${queue.mode === "promote" ? "promotion" : "training"} in progress` });
    });
    if (view.researchQueue.finishAt > 0) signals.push({ time: fmtMs(view.researchQueue.finishAt - now), text: `${researchTech(view.researchQueue.tech || "")?.name ?? "Research"} in progress` });
    if (worldStatus.activeFleets > 0) signals.push({ time: "LIVE", text: `${worldStatus.activeFleets} fleet${worldStatus.activeFleets === 1 ? "" : "s"} active in the Star Map` });
    if (view.wounded > 0) signals.push({ time: "MED", text: `${compact(displayTroops(view.wounded))} wounded troops await recovery` });

    return <>
      <div className="command-feed-status"><span><i /> SYSTEMS NOMINAL</span><em>RHCHAIN 4663</em></div>
      <div className="command-feed-tabs"><button className={commandTab === "today" ? "active" : ""} onClick={() => setCommandTab("today")}>TODAY</button><button className={commandTab === "signals" ? "active" : ""} onClick={() => setCommandTab("signals")}>SIGNALS</button></div>
      {commandTab === "today" ? <div className="daily-operations">
        <header><div><small>DAILY OPERATIONS</small><b>Daily Tasks</b></div><strong className="mono">2 / 5</strong></header>
        <div className="daily-progress"><i /></div>
        <div className="daily-task done"><span>✓</span><div><b>Collect sector resources</b><small>500K / 500K</small></div><em>DONE</em></div>
        <div className="daily-task done"><span>✓</span><div><b>Train combat units</b><small>1,000 / 1,000</small></div><em>DONE</em></div>
        <div className="daily-task"><span>3</span><div><b>Complete expeditions</b><small>2 / 3</small></div><em>67%</em></div>
        <div className="daily-task"><span>4</span><div><b>Defeat a rogue fleet</b><small>0 / 1</small></div><em>0%</em></div>
        <div className="daily-task"><span>5</span><div><b>Use fleet energy</b><small>670 / 1,000</small></div><em>67%</em></div>
      </div> : <div className="command-signals"><header><small>LIVE OPERATIONS</small><b>Signal Log</b></header>{signals.length ? signals.map((signal, index) => <div className="command-signal" key={`${signal.text}-${index}`}><time className="mono">{signal.time}</time><span>{signal.text}</span></div>) : <div className="command-signal-empty"><div className="facility-empty-scan"><i /><i /><i /></div><b>All channels idle</b></div>}</div>}
    </>;
  }

  function trainPct(v: GameState, type: TroopKey, t: number) {
    const queue = v.training[type];
    const total = queue.per * queue.qty * 1000;
    if (total <= 0) return 0;
    return Math.min(100, ((total - (queue.finishAt - t)) / total) * 100);
  }

  function renderTrainer(type: TroopKey) {
    const buildingKey = TRAINING_BUILDING[type];
    const building = view.buildings[buildingKey];
    const queue = view.training[type];
    const mode = trainingMode[type];
    const unlockedTiers = unlockedTroopTiers(view, type);
    const sourceOptions = unlockedTiers.filter((candidate) => candidate < 10 && (view.troops[type][String(candidate)] ?? 0) > 0 && unlockedTiers.some((target) => target > candidate));
    const requestedSource = promoteFrom[type];
    const sourceTier = sourceOptions.includes(requestedSource) ? requestedSource : (sourceOptions[0] ?? 1);
    const requestedTier = trainTier[type];
    const tier = mode === "promote" && requestedTier <= sourceTier ? ([...unlockedTiers].reverse().find((candidate) => candidate > sourceTier) ?? requestedTier) : requestedTier;
    const quantityChoice = trainQty[type];
    const stats = troopStats(type, tier)!;
    const armCount = troopCountByType(view, type);
    const armCapacity = maxTroopsForType(view, type);
    const queueCapacity = trainQueueSize(view, type);
    const newTroopMaximum = Math.max(0, Math.min(armCapacity - armCount, queueCapacity));
    const promotionMaximum = mode === "promote"
      ? Math.max(0, Math.min(view.troops[type][String(sourceTier)] ?? 0, promotionQueueSize(view, type, sourceTier, tier)))
      : 0;
    const maxQuantity = mode === "promote" ? promotionMaximum : newTroopMaximum;
    const quantity = maxQuantity <= 0 ? 0 : Math.max(1, Math.min(quantityChoice, maxQuantity));
    const batchCost = mode === "promote"
      ? promotionBatchCost(type, sourceTier, tier, quantity)
      : troopBatchCost(type, tier, quantity);
    const secondsPerTroop = mode === "promote"
      ? promotionTimePerTroop(view, type, sourceTier, tier)
      : stats.trainTimeSec / trainSpeedMult(view, type);
    const totalSeconds = secondsPerTroop * quantity;

    return (
      <div className="card trainer" key={type}>
        <div className="trainer-head">
          <span className="trainer-cap mono">TROOPS {compact(displayTroops(armCount))}/{compact(displayTroops(armCapacity))} · BATCH {compact(displayTroops(queueCapacity))}</span>
        </div>
        {queue.finishAt > 0 ? (
          <div className="training">
            <div className="tr-row"><span>{queue.mode === "promote" ? `Promoting ${compact(displayTroops(queue.qty))} T${queue.sourceTier} → T${queue.tier}` : `Training ${compact(displayTroops(queue.qty))} T${queue.tier} ${TROOPS_META[type].label}`}</span><span className="mono">{fmtMs(queue.finishAt - now)}</span></div>
            <div className="rmeter"><i style={{ width: trainPct(view, type, now) + "%" }} /></div>
          </div>
        ) : building.finishAt > 0 ? (
          <div className="training unavailable"><div className="tr-row"><span>UPGRADING</span><span className="mono">{fmtMs(building.finishAt - now)}</span></div></div>
        ) : (
          <div className="trainctl">
            <div className="train-mode-row">
              <select id={`${type}-training-mode`} value={mode} onChange={(event) => {
                const nextMode = event.target.value as "train" | "promote";
                setTrainingMode((current) => ({ ...current, [type]: nextMode }));
                if (nextMode === "promote") {
                  const nextSource = sourceOptions[0] ?? 1;
                  const nextTarget = [...unlockedTiers].reverse().find((candidate) => candidate > nextSource) ?? trainTier[type];
                  setPromoteFrom((current) => ({ ...current, [type]: nextSource }));
                  setTrainTier((current) => ({ ...current, [type]: nextTarget }));
                }
              }}>
                <option value="train">Train</option>
                <option value="promote" disabled={!promotionUnlocked(view, type)}>Promote · Lv.{promotionUnlockLevel(type)}</option>
              </select>
            </div>
            {mode === "promote" && (
              <div className="promote-source">
                <label htmlFor={`${type}-promotion-source`}>PROMOTE FROM</label>
                <select id={`${type}-promotion-source`} value={sourceTier} disabled={sourceOptions.length === 0} onChange={(event) => {
                  const nextSource = Number(event.target.value);
                  setPromoteFrom((current) => ({ ...current, [type]: nextSource }));
                  if (trainTier[type] <= nextSource) {
                    const nextTarget = [...unlockedTiers].reverse().find((candidate) => candidate > nextSource) ?? trainTier[type];
                    setTrainTier((current) => ({ ...current, [type]: nextTarget }));
                  }
                }}>
                  {sourceOptions.length === 0 && <option value={1}>No promotable troops</option>}
                  {sourceOptions.map((candidate) => <option key={candidate} value={candidate}>T{candidate} · {compact(displayTroops(view.troops[type][String(candidate)] ?? 0))} owned</option>)}
                </select>
              </div>
            )}
            <div className="train-section">
              <span className="train-label">{mode === "promote" ? "TARGET TIER" : "TIER"}</span>
              <div className="qty tier-row">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((candidate) => {
                  const candidateStats = troopStats(type, candidate)!;
                  const requiredLevel = candidateStats.unlockAtTrainingBuilding;
                  const unlocked = requiredLevel <= building.lvl && (mode === "train" || candidate > sourceTier);
                  const title = mode === "promote" && candidate <= sourceTier
                    ? `Target must be higher than T${sourceTier}`
                    : unlocked ? `T${candidate}` : `Requires ${BUILDINGS[buildingKey].label} Lv.${requiredLevel}`;
                  return <button key={candidate} disabled={!unlocked} title={title} className={"chip tier-chip" + (tier === candidate ? " on" : "")} onClick={() => setTrainTier((current) => ({ ...current, [type]: candidate }))}>T{candidate}</button>;
                })}
              </div>
            </div>
            <div className="train-section train-bottom">
              <div className="train-slider-copy"><span>QUANTITY</span><b className="mono">{compact(displayTroops(quantity))} / {compact(displayTroops(maxQuantity))}</b></div>
              <div className="train-slider-row">
                <span className="mono">{maxQuantity > 0 ? compact(displayTroops(1)) : "0"}</span>
                <input aria-label={`${TROOPS_META[type].label} quantity`} type="range" min={maxQuantity > 0 ? 1 : 0} max={maxQuantity} step={1} value={quantity} disabled={maxQuantity <= 0} onChange={(event) => setTrainQty((current) => ({ ...current, [type]: Number(event.target.value) }))} />
                <span className="mono">{compact(displayTroops(maxQuantity))}</span>
              </div>
              <div className="troop-stats mono">T{tier} · ATK {stats.attack} · DEF {stats.defense} · MIGHT {stats.power}</div>
              {quantity > 0 && <div className="bcost mono">{RES_ORDER.map((r) => batchCost[r] ? `${compact(displayResource(batchCost[r]!))}${RES[r].emoji} ` : "").join("")}· ◷ {fmtSec(totalSeconds)}</div>}
              <button className="cta sm" disabled={quantity <= 0} onClick={() => act(() => mode === "promote" ? startPromote(game, type, sourceTier, tier, quantity) : startTrain(game, type, tier, quantity))}>
                {quantity <= 0 ? (mode === "promote" ? "No eligible troops" : "Capacity full") : mode === "promote" ? `Promote ${compact(displayTroops(quantity))} T${sourceTier} → T${tier}` : `Train ${compact(displayTroops(quantity))} T${tier}`}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderResearchCenter() {
    const config = researchConfig();
    const branch = config.branches[researchBranch];
    const technologies = researchTechs(researchBranch);
    const layers = researchTreeLayers(researchBranch);
    const maximumColumns = researchBranch === "battle" ? 5 : 3;
    const visualLayers = layers.flatMap((layer) => Array.from(
      { length: Math.ceil(layer.length / maximumColumns) },
      (_, index) => layer.slice(index * maximumColumns, (index + 1) * maximumColumns),
    ));
    const nodeWidth = researchBranch === "battle" ? 150 : 166;
    const nodeHeight = 68;
    const columnGap = 22;
    const rowGap = 42;
    const graphPadding = 28;
    const graphWidth = Math.max(760, maximumColumns * nodeWidth + Math.max(0, maximumColumns - 1) * columnGap + graphPadding * 2);
    const graphHeight = graphPadding * 2 + visualLayers.length * nodeHeight + Math.max(0, visualLayers.length - 1) * rowGap;
    const positions = new Map<string, { x: number; y: number; tech: any }>();
    visualLayers.forEach((layer, depth) => {
      const rowWidth = layer.length * nodeWidth + Math.max(0, layer.length - 1) * columnGap;
      const rowStart = (graphWidth - rowWidth) / 2;
      layer.forEach((tech, column) => {
      positions.set(tech.key, {
        x: rowStart + column * (nodeWidth + columnGap),
        y: graphPadding + depth * (nodeHeight + rowGap),
        tech,
      });
      });
    });
    const selectedTech = technologies.find((tech) => tech.key === selectedResearchKey)
      ?? technologies.find((tech) => researchLevel(view, tech.key) < tech.maxLevel && !researchBlockReason(view, tech.key))
      ?? technologies[0];
    const queue = view.researchQueue;
    const queueTech = queue.tech ? researchTech(queue.tech) : null;
    const researchedLevels = technologies.reduce((sum, tech) => sum + researchLevel(view, tech.key), 0);
    const accountModifiers = accountResearchModifiers(view);
    const activeEffects = Object.entries(RESEARCH_EFFECT_BRANCH)
      .filter(([key, category]) => category === researchBranch && (accountModifiers[key] ?? 0) > 0);

    return (
      <section className="research-center">
        <div className="research-titlebar">
          <span>PROGRESS</span>
          <div className="research-summary mono"><b>{researchedLevels}/{branch.totals.levels}</b></div>
        </div>

        {queue.finishAt > 0 && queueTech ? (
          <div className="research-queue active">
            <div><span>RESEARCHING</span><b>{queueTech.name} → Lv.{queue.targetLevel}</b></div>
            <div className="research-queue-time mono">{fmtMs(queue.finishAt - now)}</div>
            <div className="rmeter"><i style={{ width: Math.min(100, Math.max(0, ((queue.durationSec * 1000 - (queue.finishAt - now)) / (queue.durationSec * 1000)) * 100)) + "%" }} /></div>
          </div>
        ) : <div className="research-queue"><div><span>QUEUE</span><b>IDLE</b></div></div>}

        <div className="research-tabs">
          {(Object.keys(config.branches) as ResearchBranch[]).map((key) => {
            const meta = config.branches[key];
            return <button key={key} className={researchBranch === key ? "on" : ""} onClick={() => { setResearchBranch(key); setSelectedResearchKey(""); }}><b>{meta.label}</b></button>;
          })}
        </div>
        {activeEffects.length > 0 && <div className="research-account-effects">
          <div className="research-account-title"><b>ACTIVE BONUSES</b></div>
          <div className="research-account-grid">{activeEffects.map(([key]) => {
            const value = accountModifiers[key];
            const flat = key === "trainingCapacityBonus" || key === "hospitalCapacityBonus" || key === "marchQueueBonus";
            const detail = key === "marchQueueBonus"
              ? `${worldMarchSlots(view)} total World queues`
              : key === "marchCapacityBonus"
                ? `${compact(displayTroops(accountMarchCapacity(view)))} current march cap`
                : flat ? `+${compact(displayTroops(value))}` : `+${(value * 100).toFixed(value * 100 < 10 ? 1 : 0)}%`;
            return <div key={key}><span>{researchEffectName(key)}</span><b className="mono">{detail}</b></div>;
          })}</div>
        </div>}

        {selectedTech && renderResearchDetail(selectedTech)}

        <div className="research-tree-head">
          <div><b>{branch.label.toUpperCase()} TREE</b></div>
          <div className="research-tree-legend"><span className="complete">MAXED</span><span className="available">AVAILABLE</span><span className="locked">LOCKED</span></div>
        </div>
        <div className="research-graph-scroll">
          <div className="research-graph" style={{ width: graphWidth, height: graphHeight }}>
            <svg className="research-links" width={graphWidth} height={graphHeight} viewBox={`0 0 ${graphWidth} ${graphHeight}`} aria-hidden="true">
              {technologies.flatMap((tech) => {
                const target = positions.get(tech.key);
                if (!target) return [];
                return (tech.requirements ?? []).flatMap((requirement: any) => {
                  const source = positions.get(requirement.tech);
                  if (!source) return [];
                  const startX = source.x + nodeWidth / 2;
                  const startY = source.y + nodeHeight;
                  const endX = target.x + nodeWidth / 2;
                  const endY = target.y;
                  const middleY = startY + (endY - startY) / 2;
                  const met = researchLevel(view, requirement.tech) >= requirement.level;
                  const focused = selectedTech.key === tech.key || selectedTech.key === requirement.tech;
                  return <path key={`${requirement.tech}-${tech.key}`} className={`${met ? "met " : ""}${focused ? "focused" : ""}`} d={`M ${startX} ${startY} V ${middleY} H ${endX} V ${endY}`} />;
                });
              })}
            </svg>
            {technologies.map((tech) => {
              const position = positions.get(tech.key)!;
              const current = researchLevel(view, tech.key);
              const complete = current >= tech.maxLevel;
              const reason = complete ? null : researchBlockReason(view, tech.key);
              const nextLevel = Math.min(tech.maxLevel, current + 1);
              const row = researchLevelRow(tech.key, nextLevel);
              const effect = current > 0 ? researchLevelRow(tech.key, current)?.effect : row?.effect;
              const state = complete ? "complete" : reason ? "locked" : "available";
              return <button
                type="button"
                key={tech.key}
                className={`research-tree-node ${state}${selectedTech.key === tech.key ? " selected" : ""}`}
                style={{ left: position.x, top: position.y, width: nodeWidth, height: nodeHeight }}
                onClick={() => setSelectedResearchKey(tech.key)}
                aria-label={`${tech.name}, level ${current} of ${tech.maxLevel}`}
              >
                <span className="research-tree-node-name">{tech.name}</span>
                <span className="research-tree-node-effect">{effect ? effectLabel(effect) : "No bonus"}</span>
                <span className="research-tree-node-meta"><i>RI {row?.academyLevel ?? 30}</i><b className="mono">{complete ? "MAX" : `${current}/${tech.maxLevel}`}</b></span>
              </button>;
            })}
          </div>
        </div>
      </section>
    );
  }

  function renderResearchDetail(tech: any) {
    const current = researchLevel(view, tech.key);
    const complete = current >= tech.maxLevel;
    const nextLevel = Math.min(tech.maxLevel, current + 1);
    const row = researchLevelRow(tech.key, nextLevel);
    const cost = researchCost(tech.key, nextLevel);
    const reason = complete ? null : researchBlockReason(view, tech.key);
    const resourcesMet = hasResources(cost);
    const currentEffect = current > 0 ? researchLevelRow(tech.key, current)?.effect : null;
    const nextEffect = row?.effect;
    return (
      <article className={`research-detail ${complete ? "complete" : reason ? "locked" : "available"}`}>
        <div className="research-detail-copy"><h3>{tech.name}</h3></div>
        <div className="research-detail-progress"><b className="mono">{current}/{tech.maxLevel}</b><div className="research-effect"><span>{currentEffect ? effectLabel(currentEffect) : "—"}</span>{!complete && nextEffect && <><i>→</i><b>{effectLabel(nextEffect)}</b></>}</div></div>
        {!complete && <div className="research-detail-gates">
          {view.buildings.academy.lvl < row.academyLevel && <span>🔒 Academy Lv.{row.academyLevel}</span>}
          {(tech.requirements ?? []).filter((requirement: any) => researchLevel(view, requirement.tech) < requirement.level).map((requirement: any) => <span key={requirement.tech}>🔒 {researchTech(requirement.tech)?.name} Lv.{requirement.level}</span>)}
        </div>}
        {!complete && <div className="research-detail-action"><div className="research-cost mono">{renderResourceCosts(cost)}<span>◷ {fmtSec(row.timeSec)}</span></div><button className={resourcesMet && !reason ? "ready" : ""} disabled={!!reason} onClick={() => act(() => startResearch(game, tech.key))}>
          {complete ? "MAXED" : reason ?? `Research Lv.${nextLevel}`}
        </button></div>}
        {complete && <div className="research-detail-maxed">MAXED</div>}
      </article>
    );
  }

  function renderBuilding(k: BKey) {
    const b = view.buildings[k];
    const meta = BUILDINGS[k];
    const locked = !isUnlocked(view, k);
    const upgradable = isUpgradable(k);
    const upgrading = b.finishAt > 0;
    const target = b.lvl + 1;
    const atCap = !locked && b.lvl >= capForLevel(view, k);
    const cost = upgradable ? upgradeCost(k, target) : {};
    const missingRequirements = k === "keep" ? missingTownhallPrerequisites(view, target) : [];
    const activeTrainingType = TROOP_ORDER.find((type) => TRAINING_BUILDING[type] === k);
    const selectableBuilding = !locked && (upgradable || k === "academy" || k === "hospital" || !!activeTrainingType);
    const occupiedReason = k === "academy" && view.researchQueue.finishAt > 0
      ? "Researching"
      : activeTrainingType && view.training[activeTrainingType].finishAt > 0
        ? view.training[activeTrainingType].mode === "promote" ? "Promoting" : "Training"
        : k === "hospital" && view.healing.finishAt > 0 ? "Healing"
        : "";
    const resourcesMet = hasResources(cost);
    const buildersBusy = activeUpgrades(view) >= buildQueueSlots;
    const upgradeReady = resourcesMet && !buildersBusy && missingRequirements.length === 0 && !occupiedReason;
    const status = occupiedReason || (buildersBusy ? "BUILDERS BUSY" : missingRequirements.length ? "REQUIREMENTS" : resourcesMet ? "READY" : "NEEDS RESOURCES");

    return (
      <div className={`bcard${locked ? " locked" : ""}${selectableBuilding ? " facility" : ""}${facilityOpen === k ? " selected" : ""}`} key={k}
        role={selectableBuilding ? "button" : undefined}
        aria-label={selectableBuilding ? `${meta.label} details` : undefined}
        tabIndex={selectableBuilding ? 0 : undefined}
        onClick={selectableBuilding ? () => setFacilityOpen(k) : undefined}
        onKeyDown={selectableBuilding ? (event) => { if (event.key === "Enter" || event.key === " ") setFacilityOpen(k); } : undefined}>
        <header className="bcard-head">
          <div className="bicon"><BuildingGlyph building={k} /></div>
          <div className="brow1"><span className="blabel">{meta.label}</span>
            <span className="blvl">{locked || !upgradable ? "" : b.lvl === 0 ? "—" : "Lv." + b.lvl}</span></div>
        </header>
        <div className="bmain">
          {locked ? (
            <div className="bgate" title={`Unlocks at Townhall Lv.${unlockAtKeep(k)}`}>🔒 TH {unlockAtKeep(k)}</div>
          ) : !upgradable ? (
            <div className="bgate">SOON</div>
          ) : upgrading ? (
            <div className="bprog">
              <div className="rmeter"><i style={{ width: upPct(k, b, now) + "%" }} /></div>
              <span className="mono">{fmtMs(b.finishAt - now)}</span>
            </div>
          ) : atCap && k === "keep" ? (
            <div className="bgate">Max level</div>
          ) : atCap ? (
            <div className="bgate" title="Upgrade Townhall first">🔒 TH {b.lvl + 1}</div>
          ) : (
            <div className={`bcard-state ${upgradeReady ? "ready" : "blocked"}`}><b>{status}</b><i>→</i></div>
          )}
        </div>
      </div>
    );
  }

  function renderEconomyBuilding(k: BKey) {
    const building = view.buildings[k];
    const meta = BUILDINGS[k];
    const resource = meta.produces!;
    const locked = !isUnlocked(view, k);
    const upgrading = building.finishAt > 0;
    const target = building.lvl + 1;
    const atCap = !locked && building.lvl >= capForLevel(view, k);
    const cost = upgradeCost(k, target);
    const resourcesMet = hasResources(cost);
    const buildersBusy = activeUpgrades(view) >= buildQueueSlots;
    const upgradeReady = resourcesMet && !buildersBusy;
    return (
      <article className={`economy-node ${resource}${locked ? " locked" : ""}${facilityOpen === k ? " selected" : ""}`} key={k}
        role={!locked ? "button" : undefined} aria-label={!locked ? `${meta.label} details` : undefined} tabIndex={!locked ? 0 : undefined}
        onClick={!locked ? () => setFacilityOpen(k) : undefined}
        onKeyDown={!locked ? (event) => { if (event.key === "Enter" || event.key === " ") setFacilityOpen(k); } : undefined}>
        <div className="economy-node-main">
          <span className="economy-glyph"><BuildingGlyph building={k} /></span>
          <div><small>{RES[resource].label}</small><b>{meta.label}</b></div>
          <strong className="mono">LV.{building.lvl}</strong>
        </div>
        <div className="economy-output"><span className="mono">+{compact(displayResource(rate[resource]))}/HR</span><i /></div>
        {locked ? <div className="economy-gate mono">🔒 TH {unlockAtKeep(k)}</div>
          : upgrading ? <div className="economy-progress"><div className="rmeter"><i style={{ width: upPct(k, building, now) + "%" }} /></div><span className="mono">{fmtMs(building.finishAt - now)}</span></div>
            : atCap ? <div className="economy-gate mono">🔒 TH {building.lvl + 1}</div>
              : <div className={`economy-state ${upgradeReady ? "ready" : "blocked"}`}><b>{buildersBusy ? "BUILDERS BUSY" : resourcesMet ? "READY" : "NEEDS RESOURCES"}</b><i>→</i></div>}
      </article>
    );
  }

  function renderBuildingUpgrade(k: BKey) {
    const building = view.buildings[k];
    const upgradable = isUpgradable(k);
    const locked = !isUnlocked(view, k);
    const target = building.lvl + 1;
    const atCap = !locked && building.lvl >= capForLevel(view, k);
    const upgrading = building.finishAt > 0;
    const cost = upgradable ? upgradeCost(k, target) : {};
    const missingRequirements = k === "keep" ? missingTownhallPrerequisites(view, target) : [];
    const operationBlock = buildingOperationBlockReason(view, k);
    const buildersBusy = activeUpgrades(view) >= buildQueueSlots;
    const resourcesMet = hasResources(cost);
    const ready = upgradable && !locked && !atCap && !upgrading && !operationBlock && !buildersBusy && resourcesMet && missingRequirements.length === 0;
    const blockLabel = locked ? `TH ${unlockAtKeep(k)} REQUIRED`
      : !upgradable ? "COMING SOON"
        : atCap ? (k === "keep" ? "MAX LEVEL" : `TH ${building.lvl + 1} REQUIRED`)
          : operationBlock ? operationBlock.toUpperCase()
            : buildersBusy ? "BUILDERS BUSY"
              : missingRequirements.length ? "REQUIREMENTS NOT MET"
                : !resourcesMet ? "INSUFFICIENT RESOURCES"
                  : "READY";

    return <section className={`upgrade-inspector${ready ? " ready" : " blocked"}`}>
      <div className="upgrade-inspector-level">
        <span>NEXT</span>
        <b>{building.lvl === 0 ? "BUILD" : `LV.${building.lvl} → LV.${target}`}</b>
        {upgradable && !atCap && <time className="mono">◷ {fmtSec(upgradeTimeSec(k, target))}</time>}
      </div>
      {upgradable && !atCap && <div className="upgrade-resource-grid">
        {RES_ORDER.filter((resource) => (cost[resource] ?? 0) > 0).map((resource) => {
          const required = cost[resource] ?? 0;
          const enough = view.res[resource] >= required;
          return <div className={`upgrade-resource ${enough ? "enough" : "short"}`} key={resource}>
            <span>{RES[resource].emoji} {RES[resource].label}</span>
            <b className="mono">{compact(displayResource(required))}</b>
            <small className="mono">{compact(displayResource(view.res[resource]))} AVAILABLE</small>
          </div>;
        })}
      </div>}
      {!!missingRequirements.length && <div className="upgrade-requirements">
        {missingRequirements.map((requirement) => <span key={requirement.key}>🔒 {BUILDINGS[requirement.key].label} LV.{requirement.requiredLevel}</span>)}
      </div>}
      {upgrading ? <div className="upgrade-inspector-progress"><div className="rmeter"><i style={{ width: upPct(k, building, now) + "%" }} /></div><b className="mono">{fmtMs(building.finishAt - now)}</b></div>
        : <button className={ready ? "ready" : "blocked"} disabled={!ready} onClick={() => act(() => startUpgrade(game, k))}><span>{blockLabel}</span>{ready && <b>{building.lvl === 0 ? "BUILD" : "UPGRADE"} →</b>}</button>}
    </section>;
  }

  function hasResources(cost: Partial<Record<ResKey, number>>): boolean {
    return RES_ORDER.every((resource) => view.res[resource] >= (cost[resource] ?? 0));
  }

  function renderResourceCosts(cost: Partial<Record<ResKey, number>>) {
    return <span className="upgrade-costs">{RES_ORDER.filter((resource) => (cost[resource] ?? 0) > 0).map((resource) => {
      const required = cost[resource] ?? 0;
      const enough = view.res[resource] >= required;
      return <span className={`upgrade-cost ${enough ? "enough" : "short"}`} key={resource} title={`${compact(displayResource(view.res[resource]))} available`}><i>{RES[resource].emoji}</i><b className="mono">{compact(displayResource(required))}</b></span>;
    })}</span>;
  }

  function renderHospitalControls(upgrading: boolean) {
    const hospitalCap = hospitalCapacity(view);
    const quantity = view.wounded <= 0 ? 0 : Math.max(1, Math.min(healQty, view.wounded));
    const cost = healingBatchCost(quantity);
    if (view.healing.finishAt > 0) {
      const total = Math.max(1, view.healing.durationSec * 1000);
      const progress = Math.min(100, Math.max(0, ((total - (view.healing.finishAt - now)) / total) * 100));
      return <div className="hospital-queue"><div className="tr-row"><span>Healing {compact(displayTroops(view.healing.qty))}</span><span className="mono">{fmtMs(view.healing.finishAt - now)}</span></div><div className="rmeter"><i style={{ width: progress + "%" }} /></div></div>;
    }
    return <div className="hospital-controls">
      <div className="hospital-stats mono"><span>Wounded {compact(displayTroops(view.wounded))}/{compact(displayTroops(hospitalCap))}</span><span>Healing speed ×{healingSpeedMult(view).toFixed(2)}</span></div>
      {view.wounded > 0 && !upgrading && <>
        <div className="train-slider-row"><span className="mono">{compact(displayTroops(1))}</span><input aria-label="Healing quantity" type="range" min={1} max={view.wounded} step={1} value={quantity} onChange={(event) => setHealQty(Number(event.target.value))} /><span className="mono">{compact(displayTroops(view.wounded))}</span></div>
        <div className="bcost mono">Heal {compact(displayTroops(quantity))}: {RES_ORDER.map((resource) => cost[resource] ? `${compact(displayResource(cost[resource]!))}${RES[resource].emoji} ` : "").join("")}· ◷ {fmtSec(healingDurationSec(view, quantity))}</div>
        <button className="academy-open" onClick={() => act(() => startHealing(game, quantity))}>Heal wounded</button>
      </>}
    </div>;
  }

  function upPct(k: BKey, b: { lvl: number; finishAt: number; durationSec?: number }, t: number) {
    const total = (b.durationSec || upgradeTimeSec(k, b.lvl + 1)) * 1000;
    if (total <= 0) return 0;
    return Math.min(100, ((total - (b.finishAt - t)) / total) * 100);
  }
}
