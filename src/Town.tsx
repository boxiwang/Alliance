import { useEffect, useMemo, useRef, useState } from "react";
import {
  GameState, BKey, TroopKey, BUILDINGS, BUILDING_ORDER, RES, RES_ORDER, TROOPS_META, TROOP_ORDER,
  project, startUpgrade, startTrain, upgradeCost, upgradeTimeSec,
  isUnlocked, isUpgradable, unlockAtKeep, capForLevel, capacity, prodPerHour, maxTroops, totalTroops,
  mightBreakdown, troopStats, troopBatchCost, troopCountByType, maxTroopsForType, trainQueueSize, TRAINING_BUILDING,
  displayResource, displayTroops,
  townhallRequirements, missingTownhallPrerequisites,
} from "./lib/game";
import { loadGame, saveGame, initGame } from "./lib/gamestore";
import {
  gmFillResources, gmFillTroops, gmFinishQueues, gmRaiseTownhall,
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

export default function Town({ address, profile, onWorld }: { address: string; profile: Profile; onWorld: () => void }) {
  const [game, setGame] = useState<GameState>(() => loadGame(address) || initGame(address));
  const [now, setNow] = useState(Date.now());
  const [msg, setMsg] = useState<string>("");
  const [away, setAway] = useState<{ cash: number; oil: number; power: number } | null>(null);
  const [trainQty, setTrainQty] = useState<Record<TroopKey, number>>({ army: 10, navy: 10, air: 10 });
  const [trainTier, setTrainTier] = useState<Record<TroopKey, number>>({ army: 1, navy: 1, air: 1 });
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
          TROOP_ORDER.some((type) => g.training[type].finishAt > 0 && t >= g.training[type].finishAt);
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
          <div className="cbs"><span>Might</span><b className="mono">{compact(mightScore.total)}</b><small className="mono">{compact(mightScore.infrastructure)} base · {compact(mightScore.troops)} troops</small></div>
          <div className="cbs"><span>Troops</span><b className="mono">{compact(displayTroops(troopsTotal))}/{compact(displayTroops(mt))}</b></div>
        </div>
      </div>


      {gm && (
        <div className="gm-panel">
          <div className="gm-panel-copy"><b>Local GM tools</b><span>Only this browser + wallet on localhost. Never active in production.</span></div>
          <div className="gm-actions">
            <button onClick={() => gmAct(gmFillResources, "GM: resources filled to Warehouse capacity.")}>Fill resources</button>
            <button onClick={() => gmAct(gmFillTroops, "GM: every trained arm filled to capacity at its highest unlocked tier.")}>Fill troops</button>
            <button onClick={() => gmAct(gmFinishQueues, "GM: active build and training queues completed.")}>Finish queues</button>
            <span className="gm-building-stepper">
              <select aria-label="GM building" value={gmBuilding} onChange={(event) => setGmBuilding(event.target.value as BKey)}>
                {BUILDING_ORDER.filter(isUpgradable).map((building) => <option value={building} key={building}>{BUILDINGS[building].label} · Lv.{view.buildings[building].lvl}</option>)}
              </select>
              <button disabled={view.buildings[gmBuilding].lvl >= 30} onClick={() => gmAct((state) => gmRaiseBuilding(state, gmBuilding), `GM: ${BUILDINGS[gmBuilding].label} raised by one level.`)}>Selected building +1</button>
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
    const tier = trainTier[type];
    const quantityChoice = trainQty[type];
    const stats = troopStats(type, tier)!;
    const armCount = troopCountByType(view, type);
    const armCapacity = maxTroopsForType(view, type);
    const queueCapacity = trainQueueSize(view, type);
    const maxQuantity = Math.max(0, Math.min(armCapacity - armCount, queueCapacity));
    const quantity = Math.max(0, Math.min(quantityChoice === -1 ? maxQuantity : quantityChoice, maxQuantity));
    const batchCost = troopBatchCost(type, tier, quantity);

    return (
      <div className="card trainer" key={type}>
        <div className="trainer-head">
          <div className="ct">{TROOPS_META[type].emoji} {BUILDINGS[buildingKey].label} <span className="from">Lv.{building.lvl}</span></div>
          <span className="trainer-cap mono">{compact(displayTroops(armCount))}/{compact(displayTroops(armCapacity))} · batch {compact(displayTroops(queueCapacity))}</span>
        </div>
        {queue.finishAt > 0 ? (
          <div className="training">
            <div className="tr-row"><span>Training {compact(displayTroops(queue.qty))} T{queue.tier} {TROOPS_META[type].label}</span><span className="mono">{fmtMs(queue.finishAt - now)}</span></div>
            <div className="rmeter"><i style={{ width: trainPct(view, type, now) + "%" }} /></div>
          </div>
        ) : (
          <div className="trainctl">
            <div className="train-section">
              <span className="train-label">TIER</span>
              <div className="qty tier-row">
                {Array.from({ length: 10 }, (_, i) => i + 1).map((candidate) => {
                  const candidateStats = troopStats(type, candidate)!;
                  const requiredLevel = candidateStats.unlockAtTrainingBuilding;
                  const unlocked = requiredLevel <= building.lvl;
                  return <button key={candidate} disabled={!unlocked} title={unlocked ? `T${candidate}` : `Requires ${BUILDINGS[buildingKey].label} Lv.${requiredLevel}`} className={"chip tier-chip" + (tier === candidate ? " on" : "")} onClick={() => setTrainTier((current) => ({ ...current, [type]: candidate }))}>T{candidate}</button>;
                })}
              </div>
            </div>
            <div className="train-section train-bottom">
              <div className="qty">
                {[10, 50].map((q) => <button key={q} className={"chip" + (quantityChoice === q ? " on" : "")} onClick={() => setTrainQty((current) => ({ ...current, [type]: q }))}>{compact(displayTroops(q))}</button>)}
                <button className={"chip" + (quantityChoice === -1 ? " on" : "")} onClick={() => setTrainQty((current) => ({ ...current, [type]: -1 }))}>max</button>
              </div>
              <div className="troop-stats mono">T{tier} · ATK {stats.attack} · DEF {stats.defense} · MIGHT {stats.power}</div>
              <div className="bcost mono">Batch: {RES_ORDER.map((r) => batchCost[r] ? `${compact(displayResource(batchCost[r]!))}${RES[r].emoji} ` : "").join("")}· {fmtSec(stats.trainTimeSec)} / {compact(displayTroops(1))}</div>
              <button className="cta sm" disabled={quantity <= 0} onClick={() => act(() => startTrain(game, type, tier, quantity))}>Train {compact(displayTroops(quantity))} T{tier}</button>
            </div>
          </div>
        )}
      </div>
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
            <button className="bupg" disabled={missingRequirements.length > 0} onClick={() => act(() => startUpgrade(game, k))}>
              <span>{b.lvl === 0 ? "Build" : "Upgrade → Lv." + target}</span>
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
        </div>
      </div>
    );
  }

  function upPct(k: BKey, b: { lvl: number; finishAt: number }, t: number) {
    const total = upgradeTimeSec(k, b.lvl + 1) * 1000;
    if (total <= 0) return 0;
    return Math.min(100, ((total - (b.finishAt - t)) / total) * 100);
  }
}
