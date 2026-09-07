import { useEffect, useMemo, useRef, useState } from "react";
import {
  GameState, BKey, TroopKey, BUILDINGS, BUILDING_ORDER, RES, RES_ORDER, TROOPS_META, TROOP_ORDER,
  project, startUpgrade, startTrain, upgradeCost, upgradeTimeSec,
  buildingOperationBlockReason,
  isUnlocked, isUpgradable, unlockAtKeep, capForLevel, capacity, prodPerHour, maxTroops, totalTroops,
  mightBreakdown, troopStats, troopBatchCost, troopCountByType, maxTroopsForType, trainQueueSize, TRAINING_BUILDING,
  trainSpeedMult, unlockedTroopTiers,
  promotionBatchCost, promotionQueueSize, promotionTimePerTroop, promotionUnlocked, promotionUnlockLevel, startPromote,
  healingBatchCost, healingDurationSec, healingSpeedMult, hospitalCapacity, startHealing,
  displayResource, displayTroops,
  townhallRequirements, missingTownhallPrerequisites,
  accountMarchCapacity, accountResearchModifiers, startResearch, worldMarchSlots,
} from "./lib/game";
import {
  ResearchBranch, effectLabel, missingResearchRequirements, researchBlockReason,
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
  const [researchOpen, setResearchOpen] = useState(false);
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

  const view = useMemo(() => project(game, now), [game, now]);
  const rate = prodPerHour(view);
  const cap = capacity(view);
  const mt = maxTroops(view);
  const troopsTotal = totalTroops(view);
  const mightScore = mightBreakdown(view);

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

  const alliance = profile.factionSymbol ? "$" + profile.factionSymbol : "No alliance";

  return (
    <section className="town">
      {/* command bar */}
      <div className="card cmdbar">
        <div className="cb-id">
          <span className="cb-name">{profile.name}</span>
          <span className="cb-banner">{alliance}</span>
        </div>
        <div className="cb-stats">
          {gm && <div className="gm-badge">GM</div>}
          <div className="cbs"><span>Might</span><b className="mono">{compact(mightScore.total)}</b><small className="mono">{compact(mightScore.infrastructure)} base · {compact(mightScore.research)} research · {compact(mightScore.troops)} troops</small></div>
          <div className="cbs"><span>Troops</span><b className="mono">{compact(displayTroops(troopsTotal))}/{compact(displayTroops(mt))}</b></div>
        </div>
      </div>


      {gm && (
        <div className="gm-panel">
          <div className="gm-panel-copy"><b>Local GM tools</b><span>Only this browser + wallet on localhost. Never active in production.</span></div>
          <div className="gm-actions">
            <button onClick={() => gmAct(gmFillResources, "GM: resources filled to Warehouse capacity.")}>Fill resources</button>
            <button onClick={() => gmAct(gmFillTroops, "GM: every trained arm filled to capacity at its highest unlocked tier.")}>Fill troops</button>
            <button onClick={() => gmAct(gmFinishQueues, "GM: active build, research, training and healing queues completed.")}>Finish queues</button>
            <button onClick={() => gmAct(gmMaxResearch, "GM: all three Research categories maxed. Account bonuses are active.")}>Max research</button>
            <button onClick={() => {
              const next = game.buildings.academy.lvl >= 1 ? game : gmRaiseBuilding(game, "academy");
              setGame(next);
              saveGame(next);
              setResearchOpen(true);
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

      {/* resources */}
      <div className="resbar">
        {RES_ORDER.map((r) => {
          const cur = view.res[r]; const pct = Math.min(100, (cur / cap) * 100);
          return (
            <div className="resbox" key={r}>
              <div className="rhead"><span>{RES[r].emoji} {RES[r].label}</span>
                <span className="mono">{compact(displayResource(cur))}<span className="cap">/{compact(displayResource(cap))}</span></span></div>
              <div className="rmeter"><i style={{ width: pct + "%" }} className={cur >= cap ? "full" : ""} /></div>
              <div className="rrate mono">+{compact(displayResource(rate[r]))}/hr</div>
            </div>
          );
        })}
      </div>

      {away && (away.cash > 0 || away.oil > 0 || away.power > 0) && (
        <div className="awaynote">🌙 While you were away: <b>+{compact(displayResource(away.cash))} Cash</b>, <b>+{compact(displayResource(away.oil))} Oil</b>, <b>+{compact(displayResource(away.power))} Power</b>
          <button className="mini" onClick={() => setAway(null)}>collect</button></div>
      )}
      {msg && <div className={"gmsg" + (msg.startsWith("GM:") ? " gmmsg" : "")}>{msg}</div>}

      {/* buildings */}
      <div className="ct town-ct">Your keep</div>
      <div className="bgrid">
        {BUILDING_ORDER.map((k) => renderBuilding(k))}
      </div>

      {/* Each troop arm has its own building, tier ladder and training queue. */}
      <div className="ct town-ct">Training grounds <span className="from">upgrade each building to unlock that arm's higher tiers</span></div>
      <div className="trainer-grid">
        {TROOP_ORDER.filter((type) => view.buildings[TRAINING_BUILDING[type]].lvl >= 1).map(renderTrainer)}
      </div>

      <button className="world-enter" onClick={onWorld}>
        <span>🗺️</span><b>Enter the World</b><small>Explore coordinates · gather resources · scout and raid</small><em>WORLD →</em>
      </button>

      {researchOpen && view.buildings.academy.lvl >= 1 && (
        <div className="research-overlay" role="dialog" aria-modal="true" aria-label="Research Institute">
          <div className="research-window">
            <button className="research-close" onClick={() => setResearchOpen(false)}>← Back to city</button>
            {renderResearchCenter()}
          </div>
        </div>
      )}
    </section>
  );

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
          <div className="ct">{TROOPS_META[type].emoji} {BUILDINGS[buildingKey].label} <span className="from">Lv.{building.lvl}</span></div>
          <span className="trainer-cap mono">{compact(displayTroops(armCount))}/{compact(displayTroops(armCapacity))} · batch {compact(displayTroops(queueCapacity))}</span>
        </div>
        {queue.finishAt > 0 ? (
          <div className="training">
            <div className="tr-row"><span>{queue.mode === "promote" ? `Promoting ${compact(displayTroops(queue.qty))} T${queue.sourceTier} → T${queue.tier}` : `Training ${compact(displayTroops(queue.qty))} T${queue.tier} ${TROOPS_META[type].label}`}</span><span className="mono">{fmtMs(queue.finishAt - now)}</span></div>
            <div className="rmeter"><i style={{ width: trainPct(view, type, now) + "%" }} /></div>
          </div>
        ) : building.finishAt > 0 ? (
          <div className="training unavailable"><div className="tr-row"><span>Training unavailable while {BUILDINGS[buildingKey].label} is upgrading</span><span className="mono">{fmtMs(building.finishAt - now)}</span></div></div>
        ) : (
          <div className="trainctl">
            <div className="train-mode-row">
              <label htmlFor={`${type}-training-mode`}>ORDER</label>
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
                <option value="train">Train new troops</option>
                <option value="promote" disabled={!promotionUnlocked(view, type)}>Promote existing troops</option>
              </select>
              {!promotionUnlocked(view, type) && <span className="promotion-lock">Promotion unlocks at Lv.{promotionUnlockLevel(type)}</span>}
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
              <div className="bcost mono">Total: {RES_ORDER.map((r) => batchCost[r] ? `${compact(displayResource(batchCost[r]!))}${RES[r].emoji} ` : "").join("")}· ◷ {fmtSec(totalSeconds)}</div>
              <button className="cta sm" disabled={quantity <= 0} onClick={() => act(() => mode === "promote" ? startPromote(game, type, sourceTier, tier, quantity) : startTrain(game, type, tier, quantity))}>
                {mode === "promote" ? `Promote ${compact(displayTroops(quantity))} T${sourceTier} → T${tier}` : `Train ${compact(displayTroops(quantity))} T${tier}`}
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
    const nodeWidth = researchBranch === "battle" ? 168 : 190;
    const nodeHeight = 82;
    const columnGap = 28;
    const rowGap = 62;
    const graphPadding = 34;
    const graphWidth = Math.max(980, maximumColumns * nodeWidth + Math.max(0, maximumColumns - 1) * columnGap + graphPadding * 2);
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
          <div><span className="research-kicker">ACADEMY · LV.{view.buildings.academy.lvl}</span><h2>Research Institute</h2><p>One queue. Permanent bonuses. Higher Academy levels unlock deeper upgrades.</p></div>
          <div className="research-summary mono"><b>{researchedLevels}/{branch.totals.levels}</b><span>levels completed</span></div>
        </div>

        {queue.finishAt > 0 && queueTech ? (
          <div className="research-queue active">
            <div><span>RESEARCHING</span><b>{queueTech.name} → Lv.{queue.targetLevel}</b></div>
            <div className="research-queue-time mono">{fmtMs(queue.finishAt - now)}</div>
            <div className="rmeter"><i style={{ width: Math.min(100, Math.max(0, ((queue.durationSec * 1000 - (queue.finishAt - now)) / (queue.durationSec * 1000)) * 100)) + "%" }} /></div>
          </div>
        ) : <div className="research-queue"><div><span>RESEARCH QUEUE</span><b>Idle — choose a technology</b></div></div>}

        <div className="research-tabs">
          {(Object.keys(config.branches) as ResearchBranch[]).map((key) => {
            const meta = config.branches[key];
            return <button key={key} className={researchBranch === key ? "on" : ""} onClick={() => { setResearchBranch(key); setSelectedResearchKey(""); }}><b>{meta.label}</b><small>{meta.totals.technologies} techs · {meta.totals.levels} levels</small></button>;
          })}
        </div>
        <p className="research-branch-copy">{branch.description}</p>
        <div className="research-account-effects">
          <div className="research-account-title"><b>Active account effects</b><span>Applied automatically to this wallet</span></div>
          {activeEffects.length > 0 ? <div className="research-account-grid">{activeEffects.map(([key]) => {
            const value = accountModifiers[key];
            const flat = key === "trainingCapacityBonus" || key === "hospitalCapacityBonus" || key === "marchQueueBonus";
            const detail = key === "marchQueueBonus"
              ? `${worldMarchSlots(view)} total World queues`
              : key === "marchCapacityBonus"
                ? `${compact(displayTroops(accountMarchCapacity(view)))} current march cap`
                : flat ? `+${compact(displayTroops(value))}` : `+${(value * 100).toFixed(value * 100 < 10 ? 1 : 0)}%`;
            return <div key={key}><span>{researchEffectName(key)}</span><b className="mono">{detail}</b></div>;
          })}</div> : <p>No completed {branch.label} bonuses yet.</p>}
        </div>

        {selectedTech && renderResearchDetail(selectedTech)}

        <div className="research-tree-head">
          <div><b>{branch.label} dependency tree</b><span>Follow the lines from top to bottom. Select a technology to highlight its direct paths and see requirements.</span></div>
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
                <span className="research-tree-node-meta"><i>Academy {row?.academyLevel ?? 30}</i><b className="mono">{complete ? "MAX" : `${current}/${tech.maxLevel}`}</b></span>
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
    const missing = missingResearchRequirements(view, tech.key);
    const currentEffect = current > 0 ? researchLevelRow(tech.key, current)?.effect : null;
    const nextEffect = row?.effect;
    return (
      <article className={`research-detail ${complete ? "complete" : reason ? "locked" : "available"}`}>
        <div className="research-detail-copy"><span className="research-kicker">SELECTED TECHNOLOGY</span><h3>{tech.name}</h3><p>{tech.description}</p></div>
        <div className="research-detail-progress"><span>CURRENT LEVEL</span><b className="mono">{current}/{tech.maxLevel}</b><div className="research-effect"><span>{currentEffect ? effectLabel(currentEffect) : "No bonus"}</span>{!complete && nextEffect && <><i>→</i><b>{effectLabel(nextEffect)}</b></>}</div></div>
        {!complete && <div className="research-detail-gates">
          <span className={view.buildings.academy.lvl >= row.academyLevel ? "met" : ""}>Academy Lv.{row.academyLevel}</span>
          {(tech.requirements ?? []).map((requirement: any) => <span className={researchLevel(view, requirement.tech) >= requirement.level ? "met" : ""} key={requirement.tech}>{researchTech(requirement.tech)?.name} Lv.{requirement.level}</span>)}
          {missing.length === 0 && <span className="met">Prerequisites cleared</span>}
        </div>}
        {!complete && <div className="research-detail-action"><div className="research-cost mono">{RES_ORDER.map((resource) => cost[resource] ? <span key={resource}>{compact(displayResource(cost[resource]))}{RES[resource].emoji}</span> : null)}<span>◷ {fmtSec(row.timeSec)}</span></div><button disabled={!!reason} onClick={() => act(() => startResearch(game, tech.key))}>
          {complete ? "MAXED" : reason ?? `Research Lv.${nextLevel}`}
        </button></div>}
        {complete && <div className="research-detail-maxed">All levels completed</div>}
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
    const time = upgradable ? upgradeTimeSec(k, target) : 0;
    const requirements = k === "keep" ? townhallRequirements(target) : [];
    const missingRequirements = k === "keep" ? missingTownhallPrerequisites(view, target) : [];
    const activeTrainingType = TROOP_ORDER.find((type) => TRAINING_BUILDING[type] === k);
    const occupiedReason = k === "academy" && view.researchQueue.finishAt > 0
      ? "Research in progress"
      : activeTrainingType && view.training[activeTrainingType].finishAt > 0
        ? view.training[activeTrainingType].mode === "promote" ? "Promotion in progress" : "Training in progress"
        : k === "hospital" && view.healing.finishAt > 0 ? "Healing in progress"
        : "";

    return (
      <div className={"bcard" + (locked ? " locked" : "")} key={k}>
        <div className="bicon">{meta.emoji}</div>
        <div className="bmain">
          <div className="brow1"><span className="blabel">{meta.label}</span>
            <span className="blvl">{locked ? "🔒" : !upgradable ? "" : b.lvl === 0 ? "—" : "Lv." + b.lvl}</span></div>
          <div className="bblurb">{meta.blurb}</div>

          {locked ? (
            <div className="bgate">Unlocks at Townhall Lv.{unlockAtKeep(k)}</div>
          ) : !upgradable ? (
            null
          ) : upgrading ? (
            <div className="bprog">
              <div className="rmeter"><i style={{ width: upPct(k, b, now) + "%" }} /></div>
              <span className="mono">{fmtMs(b.finishAt - now)}</span>
            </div>
          ) : atCap && k === "keep" ? (
            <div className="bgate">Max level</div>
          ) : atCap ? (
            <div className="bgate">Raise Townhall to upgrade</div>
          ) : (
            <button className="bupg" disabled={missingRequirements.length > 0 || !!occupiedReason} onClick={() => act(() => startUpgrade(game, k))}>
              <span>{occupiedReason || (b.lvl === 0 ? "Build" : "Upgrade → Lv." + target)}</span>
              <span className="bcost mono">
                {RES_ORDER.map((r) => cost[r] ? `${compact(displayResource(cost[r]!))}${RES[r].emoji} ` : "").join("")}· {fmtSec(time)}
              </span>
            </button>
          )}
          {!locked && !upgrading && k === "keep" && requirements.length > 0 && (
            <div className={"breqs" + (missingRequirements.length > 0 ? " missing" : " met")}>
              Requires {requirements.map((req) => `${BUILDINGS[req].label} Lv.${target - 1}`).join(" · ")}
            </div>
          )}
          {!locked && !upgrading && k === "academy" && b.lvl >= 1 && (
            <button className="academy-open" onClick={() => setResearchOpen(true)}>Open Research →</button>
          )}
          {!locked && k === "hospital" && b.lvl >= 1 && renderHospitalControls(upgrading)}
        </div>
      </div>
    );
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
