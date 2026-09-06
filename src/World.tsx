import { useEffect, useMemo, useRef, useState } from "react";
import { Profile } from "./lib/profile";
import {
  GameState, RES, RES_ORDER, TROOP_ORDER, TROOPS_META, TroopKey,
  displayResource, displayTroops, project, totalTroops,
} from "./lib/game";
import { loadGame, saveGame, initGame } from "./lib/gamestore";
import { Force, isShielded, marchTimeSec } from "./lib/expedition";
import { getN } from "./lib/numbers";
import { compact } from "./lib/format";
import { gmFillTroops, grantLocalGm, hasLocalGm, localGmRequested } from "./lib/gm";
import {
  WORLD_CENTER, WORLD_RADIUS, WorldMarch, WorldPoint, WorldState, WorldTarget,
  dispatchMarch, distanceTiles, initWorld, levelForPoint, loadWorld, marchPhase,
  marchRemainingSec, projectWorld, saveWorld,
} from "./lib/world";

const KIND_META = {
  node: { color: "#46c081", icon: "◆", label: "Resource field" },
  monster: { color: "#e5593d", icon: "▲", label: "Wasteland crew" },
  rival: { color: "#e8b24c", icon: "⬟", label: "Rival city" },
};

function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${(s / 86400).toFixed(1)}d`;
}

function emptySelection(): Record<TroopKey, Record<string, number>> {
  return { army: {}, navy: {}, air: {} };
}

function kindLevel(item: WorldTarget): number {
  if (item.target.kind === "rival") return item.target.keepLevel;
  return item.target.level;
}

export default function World({ address, profile, onBack }: { address: string; profile: Profile; onBack: () => void }) {
  const N = useMemo(() => getN(), []);
  const [game, setGame] = useState<GameState>(() => project(loadGame(address) || initGame(address), Date.now()));
  const [world, setWorld] = useState<WorldState>(() => loadWorld(address) || initWorld(address, N));
  const [now, setNow] = useState(Date.now());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Record<TroopKey, Record<string, number>>>(emptySelection);
  const [message, setMessage] = useState("");
  const [zoom, setZoom] = useState(1.15);
  const [camera, setCamera] = useState<WorldPoint>(() => (loadWorld(address) || initWorld(address, N)).player);
  const drag = useRef<{ x: number; y: number; camera: WorldPoint } | null>(null);
  const gm = hasLocalGm(address) || localGmRequested();

  useEffect(() => {
    if (localGmRequested()) grantLocalGm(address);
    const baseGame = project(loadGame(address) || initGame(address), Date.now());
    const baseWorld = loadWorld(address) || initWorld(address, N);
    const projected = projectWorld(baseWorld, baseGame, Date.now());
    setGame(projected.game);
    setWorld(projected.world);
    setCamera(projected.world.player);
    saveGame(projected.game);
    saveWorld(projected.world);
  }, [address, N]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const tick = Date.now();
      setNow(tick);
      setWorld((currentWorld) => {
        const currentGame = loadGame(address) || game;
        const projected = projectWorld(currentWorld, currentGame, tick);
        if (projected.changed) {
          setGame(projected.game);
          saveGame(projected.game);
          saveWorld(projected.world);
          return projected.world;
        }
        return currentWorld;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [address, game]);

  const viewGame = useMemo(() => project(game, now), [game, now]);
  const selected = world.targets.find((target) => target.id === selectedId) || null;
  const activeMarches = world.marches.filter((march) => !march.resolved && march.returnAt > now);
  const force: Force = { troops: selection };
  const sentCount = TROOP_ORDER.reduce((sum, arm) => sum + Object.values(selection[arm]).reduce((s, qty) => s + (qty || 0), 0), 0);
  const oneWay = selected ? marchTimeSec(distanceTiles(world.player, selected), N) : 0;
  const viewport = { width: 900 / zoom, height: 590 / zoom };
  const viewBox = `${camera.x - viewport.width / 2} ${camera.y - viewport.height / 2} ${viewport.width} ${viewport.height}`;

  function setTroop(arm: TroopKey, tier: string, qty: number) {
    const available = viewGame.troops[arm]?.[tier] ?? 0;
    setSelection((current) => ({
      ...current,
      [arm]: { ...current[arm], [tier]: Math.max(0, Math.min(available, Math.floor(qty) || 0)) },
    }));
  }

  function run(action: "scout" | "gather" | "raid") {
    if (!selected) return;
    const result = dispatchMarch(world, viewGame, selected.id, action, force, Date.now(), N);
    if (!result.ok) { setMessage(result.reason || "Unable to dispatch."); return; }
    setWorld(result.world);
    setGame(result.game);
    saveWorld(result.world);
    saveGame(result.game);
    setSelection(emptySelection());
    setMessage(`${action === "scout" ? "Scout" : action === "gather" ? "Gatherers" : "Strike force"} dispatched to ${selected.name}.`);
  }

  function finishMarches() {
    const forced: WorldState = JSON.parse(JSON.stringify(world));
    forced.marches.forEach((march) => { if (!march.resolved) march.returnAt = Date.now(); });
    const projected = projectWorld(forced, viewGame, Date.now());
    setWorld(projected.world); setGame(projected.game);
    saveWorld(projected.world); saveGame(projected.game);
    setMessage("GM: all active marches returned and resolved.");
  }

  function fillTroops() {
    const next = gmFillTroops(viewGame);
    setGame(next); saveGame(next);
    setMessage("GM: standing troops filled to current training-building capacity.");
  }

  function pointerDown(event: React.PointerEvent<SVGSVGElement>) {
    drag.current = { x: event.clientX, y: event.clientY, camera };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    setCamera({
      x: drag.current.camera.x - (event.clientX - drag.current.x) / zoom,
      y: drag.current.camera.y - (event.clientY - drag.current.y) / zoom,
    });
  }
  function pointerUp() { drag.current = null; }

  return (
    <section className="world">
      <div className="world-command card">
        <div>
          <button className="world-back" onClick={onBack}>← Town</button>
          <b>Outer Wastes</b>
          <span>{profile.name} · coordinate {Math.round(world.player.x)},{Math.round(world.player.y)}</span>
        </div>
        <div className="world-command-stats">
          {RES_ORDER.map((resource) => <span key={resource}><b>{RES[resource].emoji} {compact(displayResource(viewGame.res[resource]))}</b>{RES[resource].label}</span>)}
          <span><b>{activeMarches.length}/{N.global.march.marchQueueSlots}</b> marches</span>
          <span><b>{compact(displayTroops(totalTroops(viewGame)))}</b> standing</span>
          <span><b>{compact(displayTroops(viewGame.wounded))}</b> wounded</span>
          {gm && <button onClick={fillTroops}>GM fill troops</button>}
          {gm && <button onClick={finishMarches} disabled={!activeMarches.length}>GM finish marches</button>}
        </div>
      </div>

      {message && <div className="world-message">{message}</div>}
      <div className="world-layout">
        <div className="world-map-shell">
          <div className="world-map-tools">
            <button onClick={() => setCamera(world.player)}>My city</button>
            <button onClick={() => setCamera(WORLD_CENTER)}>The Circle</button>
            <button onClick={() => setZoom((value) => Math.min(2.4, value + .2))}>＋</button>
            <button onClick={() => setZoom((value) => Math.max(.55, value - .2))}>－</button>
          </div>
          <svg className="world-map" viewBox={viewBox} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}
            onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.max(.55, Math.min(2.4, value + (event.deltaY < 0 ? .12 : -.12)))); }}>
            <defs>
              <pattern id="world-grid" width="50" height="50" patternUnits="userSpaceOnUse"><path d="M 50 0 L 0 0 0 50" fill="none" stroke="#26304d" strokeWidth="1" opacity=".45" /></pattern>
              <radialGradient id="world-ground"><stop offset="0" stopColor="#273047"/><stop offset=".45" stopColor="#16233a"/><stop offset="1" stopColor="#101728"/></radialGradient>
            </defs>
            <rect x="0" y="0" width="2000" height="2000" fill="url(#world-ground)" />
            <rect x="0" y="0" width="2000" height="2000" fill="url(#world-grid)" />
            {Array.from({ length: N.world.rings }, (_, index) => index + 1).map((ring) => (
              <circle key={ring} cx={WORLD_CENTER.x} cy={WORLD_CENTER.y} r={WORLD_RADIUS * ring / N.world.rings} fill="none" stroke="#40506c" strokeWidth="2" strokeDasharray="9 12" opacity={ring === N.world.rings ? .8 : .3} />
            ))}
            <circle cx={WORLD_CENTER.x} cy={WORLD_CENTER.y} r="44" fill="#d99b36" opacity=".16" stroke="#e8b24c" strokeWidth="4" />
            <text x={WORLD_CENTER.x} y={WORLD_CENTER.y + 5} className="world-circle-label">THE CIRCLE</text>
            {activeMarches.map((march) => <MarchLine key={march.id} march={march} now={now} />)}
            {world.targets.map((item) => {
              const meta = KIND_META[item.target.kind];
              const depleted = item.target.kind === "node" && item.target.remaining <= 0;
              return <g key={item.id} className={`world-target ${selectedId === item.id ? "selected" : ""} ${depleted ? "depleted" : ""}`}
                onPointerDown={(event) => event.stopPropagation()} onClick={() => { setSelectedId(item.id); setMessage(""); }}>
                <circle cx={item.x} cy={item.y} r={selectedId === item.id ? 18 : 14} fill={meta.color} opacity={depleted ? .25 : .9} stroke={selectedId === item.id ? "#fff" : "#0b1020"} strokeWidth="4" />
                <text x={item.x} y={item.y + 5} className="world-target-icon">{meta.icon}</text>
                <text x={item.x} y={item.y - 24} className="world-target-name">{item.name}</text>
                <text x={item.x} y={item.y + 31} className="world-target-level">L{kindLevel(item)}</text>
              </g>;
            })}
            <g className="world-city" onPointerDown={(event) => event.stopPropagation()} onClick={() => setCamera(world.player)}>
              <rect x={world.player.x - 18} y={world.player.y - 18} width="36" height="36" rx="7" fill="#5aa9e6" stroke="#dbe2f3" strokeWidth="4" transform={`rotate(45 ${world.player.x} ${world.player.y})`} />
              <text x={world.player.x} y={world.player.y - 32} className="world-city-name">YOUR CITY · TH{viewGame.buildings.keep.lvl}</text>
            </g>
          </svg>
          <div className="world-map-hint">Drag to pan · wheel or ± to zoom · closer to the Circle means stronger targets</div>
        </div>

        <aside className="world-side">
          {!selected ? <div className="world-empty"><b>Select a map target</b><span>Green fields gather resources. Red crews and gold cities can be scouted or raided.</span></div> : (
            <>
              <div className="world-target-head">
                <span style={{ color: KIND_META[selected.target.kind].color }}>{KIND_META[selected.target.kind].icon}</span>
                <div><small>{KIND_META[selected.target.kind].label}</small><b>{selected.name}</b></div>
                <em>L{kindLevel(selected)}</em>
              </div>
              <div className="world-facts">
                <span>Distance <b>{distanceTiles(world.player, selected).toFixed(1)} tiles</b></span>
                <span>One-way march <b>{fmtDuration(oneWay)}</b></span>
                <span>Center zone <b>L{levelForPoint(selected, N)}</b></span>
                {selected.target.kind === "node" && <span>Remaining <b>{compact(displayResource(selected.target.remaining))} {RES[selected.target.resource].label}</b></span>}
                {selected.target.kind === "monster" && <span>Known power <b>{compact(selected.target.power)}</b></span>}
                {selected.target.kind === "rival" && <span>Protection <b>{isShielded(selected.target, N) ? "Shielded" : "Open"}</b></span>}
              </div>

              {selected.target.kind !== "node" && <button className="world-scout" onClick={() => run("scout")}>🔭 Scout · uses 1 march slot</button>}

              <div className="world-force-title"><b>Dispatch force</b><span>{compact(displayTroops(sentCount))} selected</span></div>
              <div className="world-force-list">
                {TROOP_ORDER.flatMap((arm) => Object.entries(viewGame.troops[arm] ?? {}).filter(([, qty]) => qty > 0).map(([tier, qty]) => (
                  <div className="world-force-row" key={`${arm}-${tier}`}>
                    <span>{TROOPS_META[arm].emoji} {TROOPS_META[arm].label} T{tier}<small>{compact(displayTroops(qty))} home</small></span>
                    <input type="number" min="0" max={qty} value={selection[arm][tier] ?? 0} onChange={(event) => setTroop(arm, tier, Number(event.target.value))} />
                    <button onClick={() => setTroop(arm, tier, qty)}>max</button>
                  </div>
                )))}
                {totalTroops(viewGame) === 0 && <div className="world-no-force">No standing troops. Train units in Town before dispatching.</div>}
              </div>
              {selected.target.kind === "node" ? (
                <button className="world-dispatch" disabled={sentCount <= 0 || selected.target.remaining <= 0} onClick={() => run("gather")}>Gather resources →</button>
              ) : (
                <button className="world-dispatch danger" disabled={sentCount <= 0 || (selected.target.kind === "rival" && isShielded(selected.target, N))} onClick={() => run("raid")}>Raid target →</button>
              )}
            </>
          )}

          <div className="world-marches">
            <div className="world-force-title"><b>March queues</b><span>{activeMarches.length}/{N.global.march.marchQueueSlots}</span></div>
            {activeMarches.map((march) => <div className="world-march" key={march.id}><span>{march.action === "scout" ? "🔭" : march.action === "gather" ? "⛏️" : "⚔️"}</span><div><b>{march.targetName}</b><small>{marchPhase(march, now)} · {fmtDuration(marchRemainingSec(march, now))}</small></div></div>)}
            {!activeMarches.length && <div className="world-no-force">Both march queues are idle.</div>}
          </div>

          {!!world.reports.length && <div className="world-reports">
            <div className="world-force-title"><b>Latest reports</b></div>
            {world.reports.slice(0, 4).map((report) => <div className={`world-report ${report.good ? "good" : "bad"}`} key={report.id}><b>{report.title}</b><span>{report.detail}</span></div>)}
          </div>}
        </aside>
      </div>
    </section>
  );
}

function MarchLine({ march, now }: { march: WorldMarch; now: number }) {
  const phase = marchPhase(march, now);
  let progress = 0;
  if (phase === "outbound") progress = (now - march.departAt) / Math.max(1, march.arriveAt - march.departAt);
  else if (phase === "working") progress = 1;
  else if (phase === "returning") progress = 1 - (now - march.actionEndsAt) / Math.max(1, march.returnAt - march.actionEndsAt);
  const x = march.from.x + (march.to.x - march.from.x) * Math.max(0, Math.min(1, progress));
  const y = march.from.y + (march.to.y - march.from.y) * Math.max(0, Math.min(1, progress));
  return <g className="world-march-line"><line x1={march.from.x} y1={march.from.y} x2={march.to.x} y2={march.to.y} /><circle cx={x} cy={y} r="7" /><text x={x} y={y - 12}>{march.action === "scout" ? "SCOUT" : march.action.toUpperCase()}</text></g>;
}
