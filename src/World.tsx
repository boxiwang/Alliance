import { useEffect, useMemo, useRef, useState } from "react";
import { Profile } from "./lib/profile";
import {
  GameState, RES, RES_ORDER, TROOP_ORDER, TROOPS_META, TroopKey,
  displayResource, displayTroops, project, totalTroops,
} from "./lib/game";
import { loadGame, saveGame, initGame } from "./lib/gamestore";
import { getN } from "./lib/numbers";
import { compact } from "./lib/format";
import { gmFillTroops, grantLocalGm, hasLocalGm, localGmRequested } from "./lib/gm";
import type {
  CityEntity, HeadlessMarch, MonsterEntity, Point, ResourceEntity, WorldReport,
} from "./lib/world-engine";
import { distance, energyAt, worldCenter } from "./lib/world-engine";
import type { LocalWorldSession } from "./lib/world-adapter";
import {
  advanceLocalWorldSession, dispatchLocalWorldMarch, finishLocalWorldMarches,
  localWorldTargetName, openLocalWorldSession, saveLocalWorldSession,
} from "./lib/world-adapter";

type SelectableEntity = ResourceEntity | MonsterEntity | CityEntity;

const KIND_META = {
  resource: { color: "#46c081", icon: "◆", label: "Resource field" },
  monster: { color: "#e5593d", icon: "▲", label: "Wasteland crew" },
  city: { color: "#e8b24c", icon: "⬟", label: "Rival city" },
};

const ERROR_COPY: Record<string, string> = {
  player_not_found: "Player record is unavailable.", invalid_target: "That target is no longer valid.",
  cannot_target_self: "You cannot target your own city.", march_slots_full: "All march queues are busy.",
  troops_required: "Select at least one troop.", march_capacity_exceeded: "The selected force exceeds this march's capacity.",
  insufficient_troops: "Some selected troops are no longer standing in the city.", target_unavailable: "Another march reached that target first.",
  monster_level_locked: "Defeat the previous monster level first.", insufficient_energy: "Not enough Energy for this hunt.",
  target_shielded: "That city is protected by a shield.",
};

function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  return `${(s / 86400).toFixed(1)}d`;
}

function emptySelection(): Record<TroopKey, Record<string, number>> { return { army: {}, navy: {}, air: {} }; }
function entityLevel(entity: SelectableEntity): number { return entity.kind === "city" ? entity.townhallLevel : entity.level; }
function cityShielded(city: CityEntity, now: number, numbers: any): boolean {
  return !city.hasAttacked && (city.shieldUntil > now || city.townhallLevel < (Number(numbers.global?.shield?.protectedUntilKeepLevel) || 0));
}
function marchPhase(march: HeadlessMarch): string {
  if (march.state === "outbound") return "outbound";
  if (march.state === "gathering") return "working";
  if (march.state === "returning") return "returning";
  return "complete";
}
function marchRemainingSec(march: HeadlessMarch, now: number): number {
  const end = march.state === "outbound" ? march.arriveAt : march.state === "gathering" ? march.workUntil : march.state === "returning" ? march.returnAt : now;
  return Math.max(0, Math.ceil((end - now) / 1000));
}

function reportCopy(report: WorldReport, world: LocalWorldSession["world"]): { title: string; detail: string; good: boolean } {
  const target = localWorldTargetName(world, report.targetId);
  const good = ["victory", "scouted", "gathering_started", "gathering_completed", "delivered", "defended"].includes(report.outcome);
  if (report.stage === "return") {
    if (report.action === "scout") return { title: `Scout returned from ${target}`, detail: "Reconnaissance team returned safely.", good: true };
    const cargo = (report.payload.cargo ?? {}) as Record<string, number>;
    const delivered = RES_ORDER.map((resource) => cargo[resource] ? `${compact(displayResource(cargo[resource]))} ${RES[resource].label}` : "").filter(Boolean).join(" · ");
    return { title: `March returned from ${target}`, detail: delivered || `${compact(displayTroops(Number(report.payload.survivingTroops ?? 0)))} troops returned.`, good: true };
  }
  if (report.action === "scout") {
    const snapshot = (report.payload.snapshot ?? {}) as Record<string, number>;
    return { title: `Scout report: ${target}`, detail: `Garrison ${compact(displayTroops(snapshot.garrison ?? 0))} · estimated loot ${compact(displayResource(snapshot.estimatedLoot ?? 0))}.`, good };
  }
  if (report.action === "gather") {
    return { title: report.outcome === "target_unavailable" ? `${target} was claimed first` : `Gathering at ${target}`, detail: report.outcome === "gathering_completed" ? `${compact(displayResource(Number(report.payload.hauled ?? 0)))} supplies loaded for return.` : report.outcome.split("_").join(" "), good };
  }
  const wounded = Number(report.payload.wounded ?? (report.payload.attackerLosses as any)?.wounded ?? 0);
  const dead = Number(report.payload.dead ?? (report.payload.attackerLosses as any)?.dead ?? 0);
  return { title: `${report.outcome === "victory" ? "Victory" : report.outcome === "defeat" ? "Defeat" : "Battle result"} at ${target}`, detail: `${compact(displayTroops(wounded))} wounded · ${compact(displayTroops(dead))} dead.`, good };
}

export default function World({ address, profile, onBack }: { address: string; profile: Profile; onBack: () => void }) {
  const N = useMemo(() => getN(), []);
  const initial = useMemo(() => openLocalWorldSession(address, loadGame(address) || initGame(address), Date.now(), N), [address, N]);
  const [game, setGame] = useState<GameState>(() => initial.game);
  const [session, setSession] = useState<LocalWorldSession>(() => initial.session);
  const gameRef = useRef(initial.game);
  const [now, setNow] = useState(Date.now());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Record<TroopKey, Record<string, number>>>(emptySelection);
  const [message, setMessage] = useState(initial.session.migratedLegacyAt ? "Old World marches were safely settled and migrated." : "");
  const [zoom, setZoom] = useState(1.15);
  const playerCity = session.world.entities[session.world.players[session.playerId].cityId] as CityEntity;
  const [camera, setCamera] = useState<Point>(() => ({ ...playerCity.position }));
  const drag = useRef<{ x: number; y: number; camera: Point } | null>(null);
  const dispatchSeq = useRef(0);
  const gm = hasLocalGm(address) || localGmRequested();

  useEffect(() => { gameRef.current = game; }, [game]);
  useEffect(() => {
    if (localGmRequested()) grantLocalGm(address);
    const opened = openLocalWorldSession(address, loadGame(address) || initGame(address), Date.now(), N);
    setGame(opened.game); gameRef.current = opened.game; setSession(opened.session);
    const city = opened.session.world.entities[opened.session.world.players[opened.session.playerId].cityId] as CityEntity;
    setCamera({ ...city.position }); saveGame(opened.game); saveLocalWorldSession(opened.session);
    if (opened.session.migratedLegacyAt) setMessage("Old World marches were safely settled and migrated.");
  }, [address, N]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const tick = Date.now(); setNow(tick);
      setSession((current) => {
        const result = advanceLocalWorldSession(current, loadGame(address) || gameRef.current, tick, N);
        if (!result.changed) return current;
        setGame(result.game); gameRef.current = result.game; saveGame(result.game); saveLocalWorldSession(result.session);
        return result.session;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [address, N]);

  const world = session.world;
  const viewGame = useMemo(() => project(game, now), [game, now]);
  const targets = useMemo(() => Object.values(world.entities).filter((entity): entity is SelectableEntity => entity.kind === "resource" || entity.kind === "monster" || (entity.kind === "city" && entity.ownerId !== session.playerId)), [world.entities, session.playerId]);
  const selected = targets.find((target) => target.id === selectedId) || null;
  const activeMarches = Object.values(world.marches).filter((march) => !["completed", "failed"].includes(march.state));
  const sentCount = TROOP_ORDER.reduce((sum, arm) => sum + Object.values(selection[arm]).reduce((subtotal, qty) => subtotal + (qty || 0), 0), 0);
  const oneWay = selected ? distance(playerCity.position, selected.position) * world.config.travelSecondsPerTile : 0;
  const viewport = { width: world.config.width / zoom, height: world.config.width * .655 / zoom };
  // New players intentionally spawn near the outer rim. Keep their camera
  // inside the State so the initial view is map, not off-map empty space.
  const viewX = Math.max(0, Math.min(world.config.width - viewport.width, camera.x - viewport.width / 2));
  const viewY = Math.max(0, Math.min(world.config.height - viewport.height, camera.y - viewport.height / 2));
  const viewBox = `${viewX} ${viewY} ${viewport.width} ${viewport.height}`;
  const center = worldCenter(world.config);
  const worldRadius = Math.hypot(world.config.width / 2, world.config.height / 2);
  const player = world.players[session.playerId];
  const energy = energyAt(player, now, world.config);
  const latestReports = player.reportIds.slice().reverse().slice(0, 6).map((id) => world.reports[id]).filter(Boolean);

  function commit(result: ReturnType<typeof advanceLocalWorldSession>) {
    setSession(result.session); setGame(result.game); gameRef.current = result.game; saveLocalWorldSession(result.session); saveGame(result.game);
  }
  function setTroop(arm: TroopKey, tier: string, qty: number) {
    const available = viewGame.troops[arm]?.[tier] ?? 0;
    setSelection((current) => ({ ...current, [arm]: { ...current[arm], [tier]: Math.max(0, Math.min(available, Math.floor(qty) || 0)) } }));
  }
  function run(action: "scout" | "gather" | "attack_monster" | "attack_city") {
    if (!selected) return;
    // Scouting occupies a march slot but does not quietly reserve whatever force
    // the player happened to have selected for a later attack.
    const force = action === "scout" ? emptySelection() : selection;
    const result = dispatchLocalWorldMarch(session, viewGame, { targetId: selected.id, action, force, idempotencyKey: `ui:${Date.now()}:${dispatchSeq.current++}` }, Date.now(), N);
    if (result.error) { setMessage(ERROR_COPY[result.error] || result.error.split("_").join(" ")); return; }
    commit(result); setSelection(emptySelection());
    setMessage(`${action === "scout" ? "Scout" : action === "gather" ? "Gatherers" : "Strike force"} dispatched to ${localWorldTargetName(result.session.world, selected.id)}.`);
  }
  function finishMarches() {
    const result = finishLocalWorldMarches(session, viewGame, Date.now(), N); commit(result);
    setMessage("GM: all active marches completed through the headless engine.");
  }
  function fillTroops() {
    const result = advanceLocalWorldSession(session, gmFillTroops(viewGame), Date.now(), N); commit(result);
    setMessage("GM: standing troops filled to current training-building capacity.");
  }
  function pointerDown(event: React.PointerEvent<SVGSVGElement>) { drag.current = { x: event.clientX, y: event.clientY, camera }; event.currentTarget.setPointerCapture(event.pointerId); }
  function pointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    setCamera({ x: drag.current.camera.x - (event.clientX - drag.current.x) / zoom, y: drag.current.camera.y - (event.clientY - drag.current.y) / zoom });
  }
  function pointerUp() { drag.current = null; }

  return <section className="world">
    <div className="world-command card">
      <div><button className="world-back" onClick={onBack}>← Town</button><b>Outer Wastes · State {world.stateId.slice(-6)}</b><span>{profile.name} · coordinate {Math.round(playerCity.position.x)},{Math.round(playerCity.position.y)}</span></div>
      <div className="world-command-stats">
        {RES_ORDER.map((resource) => <span key={resource}><b>{RES[resource].emoji} {compact(displayResource(viewGame.res[resource]))}</b>{RES[resource].label}</span>)}
        <span><b>{Math.floor(energy)}/{world.config.energyCap}</b> Energy</span><span><b>{activeMarches.length}/{player.marchSlots}</b> marches</span>
        <span><b>{compact(displayTroops(totalTroops(viewGame)))}</b> standing</span><span><b>{compact(displayTroops(viewGame.wounded))}</b> wounded</span>
        {gm && <button onClick={fillTroops}>GM fill troops</button>}{gm && <button onClick={finishMarches} disabled={!activeMarches.length}>GM finish marches</button>}
      </div>
    </div>
    {message && <div className="world-message">{message}</div>}
    <div className="world-layout">
      <div className="world-map-shell">
        <div className="world-map-tools"><button onClick={() => setCamera(playerCity.position)}>My city</button><button onClick={() => setCamera(center)}>The Circle</button><button onClick={() => setZoom((value) => Math.min(4, value + .25))}>＋</button><button onClick={() => setZoom((value) => Math.max(1, value - .25))}>－</button></div>
        <svg className="world-map world-map-v2" viewBox={viewBox} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp} onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.max(1, Math.min(4, value + (event.deltaY < 0 ? .15 : -.15)))); }}>
          <defs><pattern id="world-grid" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M 16 0 L 0 0 0 16" fill="none" stroke="#26304d" strokeWidth=".35" opacity=".45" /></pattern><radialGradient id="world-ground"><stop offset="0" stopColor="#273047"/><stop offset=".45" stopColor="#16233a"/><stop offset="1" stopColor="#101728"/></radialGradient></defs>
          <rect x={-world.config.width} y={-world.config.height} width={world.config.width * 3} height={world.config.height * 3} fill="#0b1020" /><rect x="0" y="0" width={world.config.width} height={world.config.height} fill="url(#world-ground)" /><rect x="0" y="0" width={world.config.width} height={world.config.height} fill="url(#world-grid)" />
          {Array.from({ length: 5 }, (_, index) => index + 1).map((ring) => <circle key={ring} cx={center.x} cy={center.y} r={worldRadius * ring / 5} fill="none" stroke="#40506c" strokeWidth=".7" strokeDasharray="3 4" opacity={ring === 5 ? .8 : .3} />)}
          <circle cx={center.x} cy={center.y} r={world.config.circleReserveRadius} fill="#d99b36" opacity=".16" stroke="#e8b24c" strokeWidth="1.2" /><text x={center.x} y={center.y + 2} className="world-circle-label">THE CIRCLE</text>
          {activeMarches.map((march) => <MarchLine key={march.id} march={march} now={now} />)}
          {targets.map((entity) => {
            const meta = KIND_META[entity.kind]; const unavailable = (entity.kind === "resource" && entity.state !== "available") || (entity.kind === "monster" && entity.state !== "alive"); const selectedTarget = selectedId === entity.id;
            return <g key={entity.id} className={`world-target ${selectedTarget ? "selected" : ""} ${unavailable ? "depleted" : ""}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setSelectedId(entity.id); setMessage(""); }}>
              <circle cx={entity.position.x} cy={entity.position.y} r={selectedTarget ? 5.5 : 4} fill={meta.color} opacity={unavailable ? .25 : .9} stroke={selectedTarget ? "#fff" : "#0b1020"} strokeWidth="1.2" /><text x={entity.position.x} y={entity.position.y + 1.5} className="world-target-icon">{meta.icon}</text>
              {(selectedTarget || zoom >= 2.7) && <text x={entity.position.x} y={entity.position.y - 7} className="world-target-name">{localWorldTargetName(world, entity.id)}</text>}<text x={entity.position.x} y={entity.position.y + 8} className="world-target-level">L{entityLevel(entity)}</text>
            </g>;
          })}
          <g className="world-city" onPointerDown={(event) => event.stopPropagation()} onClick={() => setCamera(playerCity.position)}><rect x={playerCity.position.x - 5} y={playerCity.position.y - 5} width="10" height="10" rx="2" fill="#5aa9e6" stroke="#dbe2f3" strokeWidth="1.2" transform={`rotate(45 ${playerCity.position.x} ${playerCity.position.y})`} /><text x={playerCity.position.x < 45 ? playerCity.position.x + 30 : playerCity.position.x > world.config.width - 45 ? playerCity.position.x - 30 : playerCity.position.x} y={playerCity.position.y < 18 ? playerCity.position.y + 14 : playerCity.position.y - 9} className="world-city-name">YOUR CITY · TH{viewGame.buildings.keep.lvl}</text></g>
        </svg>
        <div className="world-map-hint">Drag to pan · wheel or ± to zoom · 512×512 State · {Object.keys(world.players).length}/{world.config.maxPlayers} cities</div>
      </div>
      <aside className="world-side">
        {!selected ? <div className="world-empty"><b>Select a map target</b><span>Green fields gather resources. Red crews and gold cities can be scouted or attacked.</span></div> : <>
          <div className="world-target-head"><span style={{ color: KIND_META[selected.kind].color }}>{KIND_META[selected.kind].icon}</span><div><small>{KIND_META[selected.kind].label}</small><b>{localWorldTargetName(world, selected.id)}</b></div><em>L{entityLevel(selected)}</em></div>
          <div className="world-facts"><span>Distance <b>{distance(playerCity.position, selected.position).toFixed(1)} tiles</b></span><span>One-way march <b>{fmtDuration(oneWay)}</b></span><span>Map zone <b>{selected.zone}</b></span>
            {selected.kind === "resource" && <span>Remaining <b>{compact(displayResource(selected.amount))} {RES[selected.resource].label}</b></span>}
            {selected.kind === "monster" && <><span>Known power <b>{compact(selected.power)}</b></span><span>Counter identity <b>{TROOPS_META[selected.dominantArm].label}</b></span></>}
            {selected.kind === "city" && <><span>Protection <b>{cityShielded(selected, now, N) ? "Shielded" : "Open"}</b></span><span>Wall integrity <b>{selected.wall.value}/{selected.wall.max}</b></span></>}
          </div>
          {selected.kind !== "resource" && <button className="world-scout" onClick={() => run("scout")}>🔭 Scout · uses 1 march slot</button>}
          <div className="world-force-title"><b>Dispatch force</b><span>{compact(displayTroops(sentCount))} selected · cap {compact(displayTroops(player.marchCapacity))}</span></div>
          <div className="world-force-list">
            {TROOP_ORDER.flatMap((arm) => Object.entries(viewGame.troops[arm] ?? {}).filter(([, qty]) => qty > 0).map(([tier, qty]) => <div className="world-force-row" key={`${arm}-${tier}`}><span>{TROOPS_META[arm].emoji} {TROOPS_META[arm].label} T{tier}<small>{compact(displayTroops(qty))} home</small></span><input type="number" min="0" max={qty} value={selection[arm][tier] ?? 0} onChange={(event) => setTroop(arm, tier, Number(event.target.value))} /><button onClick={() => setTroop(arm, tier, qty)}>max</button></div>))}
            {totalTroops(viewGame) === 0 && <div className="world-no-force">No standing troops. Train units in Town before dispatching.</div>}
          </div>
          {selected.kind === "resource" ? <button className="world-dispatch" disabled={sentCount <= 0 || selected.state !== "available"} onClick={() => run("gather")}>Gather resources →</button> : selected.kind === "monster" ? <button className="world-dispatch danger" disabled={sentCount <= 0 || selected.state !== "alive"} onClick={() => run("attack_monster")}>Attack crew · {world.config.monsterEnergyCost} Energy →</button> : <button className="world-dispatch danger" disabled={sentCount <= 0 || cityShielded(selected, now, N)} onClick={() => run("attack_city")}>Attack city →</button>}
        </>}
        <div className="world-marches"><div className="world-force-title"><b>March queues</b><span>{activeMarches.length}/{player.marchSlots}</span></div>{activeMarches.map((march) => <div className="world-march" key={march.id}><span>{march.action === "scout" ? "🔭" : march.action === "gather" ? "⛏️" : "⚔️"}</span><div><b>{localWorldTargetName(world, march.targetId)}</b><small>{marchPhase(march)} · {fmtDuration(marchRemainingSec(march, now))}</small></div></div>)}{!activeMarches.length && <div className="world-no-force">Both march queues are idle.</div>}</div>
        {!!latestReports.length && <div className="world-reports"><div className="world-force-title"><b>Latest reports</b><span>arrival + return</span></div>{latestReports.map((report) => { const copy = reportCopy(report, world); return <div className={`world-report ${copy.good ? "good" : "bad"}`} key={report.id}><b>{copy.title}</b><span>{copy.detail}</span></div>; })}</div>}
      </aside>
    </div>
  </section>;
}

function MarchLine({ march, now }: { march: HeadlessMarch; now: number }) {
  let progress = 0;
  if (march.state === "outbound") progress = (now - march.dispatchedAt) / Math.max(1, march.arriveAt - march.dispatchedAt);
  else if (march.state === "gathering") progress = 1;
  else if (march.state === "returning") { const start = march.workUntil || march.arriveAt; progress = 1 - (now - start) / Math.max(1, march.returnAt - start); }
  const safe = Math.max(0, Math.min(1, progress)); const x = march.origin.x + (march.destination.x - march.origin.x) * safe; const y = march.origin.y + (march.destination.y - march.origin.y) * safe;
  return <g className="world-march-line"><line x1={march.origin.x} y1={march.origin.y} x2={march.destination.x} y2={march.destination.y} /><circle cx={x} cy={y} r="2.2" /><text x={x} y={y - 4}>{march.action === "scout" ? "SCOUT" : march.action === "gather" ? "GATHER" : "ATTACK"}</text></g>;
}
