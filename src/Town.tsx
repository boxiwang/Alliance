import { useEffect, useMemo, useRef, useState } from "react";
import {
  GameState, BKey, TroopKey, BUILDINGS, BUILDING_ORDER, RES, RES_ORDER, TROOPS_META, TROOP_ORDER,
  project, startUpgrade, startTrain, upgradeCost, upgradeTimeSec,
  isUnlocked, isUpgradable, unlockAtKeep, capForLevel, capacity, prodPerHour, maxTroops, totalTroops,
  might, TROOPS,
} from "./lib/game";
import { loadGame, saveGame, initGame } from "./lib/gamestore";
import { Profile } from "./lib/profile";
import { compact } from "./lib/format";

function fmtMs(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return s + "s";
  if (s < 3600) return Math.floor(s / 60) + "m " + (s % 60) + "s";
  return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
}
function fmtSec(s: number): string { return fmtMs(s * 1000); }

export default function Town({ address, profile }: { address: string; profile: Profile }) {
  const [game, setGame] = useState<GameState>(() => loadGame(address) || initGame(address));
  const [now, setNow] = useState(Date.now());
  const [msg, setMsg] = useState<string>("");
  const [away, setAway] = useState<{ cash: number; oil: number; power: number } | null>(null);
  const [trainQty, setTrainQty] = useState(10);
  const [trainType, setTrainType] = useState<TroopKey>("army");
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

  // Heartbeat: re-render every second; commit when something finishes.
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setGame((g) => {
        const anyDone =
          BUILDING_ORDER.some((k) => g.buildings[k].finishAt > 0 && t >= g.buildings[k].finishAt) ||
          (g.train.finishAt > 0 && t >= g.train.finishAt);
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

  function act(fn: () => { state: GameState; ok: boolean; reason?: string }) {
    const r = fn();
    if (r.ok) { setGame(r.state); saveGame(r.state); setMsg(""); }
    else setMsg(r.reason || "Can't do that");
  }

  const banner = profile.factionSymbol ? "$" + profile.factionSymbol : "Solo";

  return (
    <section className="town">
      {/* command bar */}
      <div className="card cmdbar">
        <div className="cb-id">
          <span className="cb-name">{profile.name}</span>
          <span className="cb-banner">{banner}</span>
        </div>
        <div className="cb-stats">
          <div className="cbs"><span>Might</span><b className="mono">{compact(might(view))}</b></div>
          <div className="cbs"><span>Troops</span><b className="mono">{troopsTotal}/{mt}</b></div>
        </div>
      </div>

      {/* resources */}
      <div className="resbar">
        {RES_ORDER.map((r) => {
          const cur = view.res[r]; const pct = Math.min(100, (cur / cap) * 100);
          return (
            <div className="resbox" key={r}>
              <div className="rhead"><span>{RES[r].emoji} {RES[r].label}</span>
                <span className="mono">{compact(cur)}<span className="cap">/{compact(cap)}</span></span></div>
              <div className="rmeter"><i style={{ width: pct + "%" }} className={cur >= cap ? "full" : ""} /></div>
              <div className="rrate mono">+{compact(rate[r])}/hr</div>
            </div>
          );
        })}
      </div>

      {away && (away.cash > 0 || away.oil > 0 || away.power > 0) && (
        <div className="awaynote">🌙 While you were away: <b>+{compact(away.cash)} Cash</b>, <b>+{compact(away.oil)} Oil</b>, <b>+{compact(away.power)} Power</b>
          <button className="mini" onClick={() => setAway(null)}>collect</button></div>
      )}
      {msg && <div className="gmsg">{msg}</div>}

      {/* buildings */}
      <div className="ct town-ct">Your keep</div>
      <div className="bgrid">
        {BUILDING_ORDER.map((k) => renderBuilding(k))}
      </div>

      {/* barracks / training */}
      {view.buildings.barracks.lvl >= 1 && (
        <div className="card trainer">
          <div className="ct">Muster troops <span className="from">{fmtSec(TROOPS[trainType].trainTimeSec)} base</span></div>
          {view.train.finishAt > 0 ? (
            <div className="training">
              <div className="tr-row"><span>Training {view.train.qty} {TROOPS_META[view.train.type].label}</span><span className="mono">{fmtMs(view.train.finishAt - now)}</span></div>
              <div className="rmeter"><i style={{ width: trainPct(view, now) + "%" }} /></div>
            </div>
          ) : (
            <div className="trainctl">
              <div className="qty">
                {TROOP_ORDER.map((t) => (
                  <button key={t} className={"chip" + (trainType === t ? " on" : "")} onClick={() => setTrainType(t)}>
                    {TROOPS_META[t].emoji} {TROOPS_META[t].label}
                  </button>
                ))}
              </div>
              <div className="qty">
                {[10, 50].map((q) => <button key={q} className={"chip" + (trainQty === q ? " on" : "")} onClick={() => setTrainQty(q)}>{q}</button>)}
                <button className={"chip" + (trainQty === -1 ? " on" : "")} onClick={() => setTrainQty(-1)}>max</button>
              </div>
              <div className="bcost mono">
                {RES_ORDER.map((r) => TROOPS[trainType].cost[r] ? `${TROOPS[trainType].cost[r]}${RES[r].emoji} ` : "").join("")}each
              </div>
              <button className="cta sm" onClick={() => act(() => startTrain(game, trainType, trainQty === -1 ? mt - troopsTotal : trainQty))}>
                Train {trainQty === -1 ? Math.max(0, mt - troopsTotal) : trainQty}
              </button>
            </div>
          )}
        </div>
      )}

      <div className="worldsoon">🗺️ The world map — explore, gather, raid — is the next build.</div>
    </section>
  );

  function trainPct(v: GameState, t: number) {
    const total = v.train.per * v.train.qty * 1000;
    if (total <= 0) return 0;
    return Math.min(100, ((total - (v.train.finishAt - t)) / total) * 100);
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
            <button className="bupg" onClick={() => act(() => startUpgrade(game, k))}>
              <span>{b.lvl === 0 ? "Build" : "Upgrade → Lv." + target}</span>
              <span className="bcost mono">
                {RES_ORDER.map((r) => cost[r] ? `${compact(cost[r]!)}${RES[r].emoji} ` : "").join("")}· {fmtSec(time)}
              </span>
            </button>
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
