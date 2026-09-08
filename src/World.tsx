import { useEffect, useMemo, useRef, useState } from "react";
import { Profile } from "./lib/profile";
import {
  GameState, RES, RES_ORDER, TROOP_ORDER, TROOPS_META, TroopKey,
  displayResource, displayTroops, mightBreakdown, project, totalTroops,
} from "./lib/game";
import { loadGame, saveGame, initGame } from "./lib/gamestore";
import { getN } from "./lib/numbers";
import { compact } from "./lib/format";
import { gmFillTroops, grantLocalGm, hasLocalGm, localGmRequested } from "./lib/gm";
import type {
  CityEntity, HeadlessMarch, MonsterEntity, Point, ResourceEntity, WorldReport,
} from "./lib/world-engine";
import { distance, energyAt, resourceTroopRequirement, worldCenter } from "./lib/world-engine";
import { carryCapacity } from "./lib/expedition";
import type { LocalWorldSession } from "./lib/world-adapter";
import {
  advanceLocalWorldSession, dispatchLocalWorldMarch, finishLocalWorldMarches,
  localWorldTargetName, openLocalWorldSession, recallLocalWorldMarch, saveLocalWorldSession,
} from "./lib/world-adapter";
import GameNav from "./GameNav";

type SelectableEntity = ResourceEntity | MonsterEntity | CityEntity;
type WorldLayer = "resource" | "monster" | "city";
type ResultNotice = { title: string; detail: string; good: boolean };

const KIND_META = {
  resource: { color: "#43f2a1", icon: "●", label: "Resource planet" },
  monster: { color: "#ff5f78", icon: "◉", label: "Rogue planet" },
  city: { color: "#aa82ff", icon: "⬡", label: "Civilization" },
};

const RESOURCE_COLORS = { cash: "#43f2a1", oil: "#ffb454", power: "#38d9ff" };
const RESOURCE_EMOJI = { cash: "💰", oil: "⛽", power: "⚡" };
// In-flight gather milestones (shown live in Live Fleets) are kept out of the results archive.
const ARCHIVE_HIDDEN_OUTCOMES = new Set(["gathering_started", "gathering_completed"]);

type SignalCluster = { id: string; kind: "resource" | "monster"; position: Point; count: number };

export function clusterWorldSignals(entities: SelectableEntity[], cellSize = 44): SignalCluster[] {
  const buckets = new Map<string, { kind: "resource" | "monster"; x: number; y: number; count: number }>();
  entities.forEach((entity) => {
    if (entity.kind === "city") return;
    const id = `${entity.kind}:${Math.floor(entity.position.x / cellSize)}:${Math.floor(entity.position.y / cellSize)}`;
    const bucket = buckets.get(id) || { kind: entity.kind, x: 0, y: 0, count: 0 };
    bucket.x += entity.position.x; bucket.y += entity.position.y; bucket.count += 1; buckets.set(id, bucket);
  });
  return Array.from(buckets, ([id, bucket]) => ({ id, kind: bucket.kind, position: { x: bucket.x / bucket.count, y: bucket.y / bucket.count }, count: bucket.count }));
}

function entityColor(entity: SelectableEntity): string {
  return entity.kind === "resource" ? RESOURCE_COLORS[entity.resource] : KIND_META[entity.kind].color;
}

function entityState(entity: SelectableEntity): string {
  if (entity.kind === "resource") return entity.state === "available" ? "UNCHARTED" : entity.state.toUpperCase();
  if (entity.kind === "monster") return entity.state === "alive" ? "ROAMING" : entity.state.toUpperCase();
  return entity.state === "burning" ? "UNDER ATTACK" : "STABLE";
}

function loadBookmarks(address: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(`ruglands:world-bookmarks:${address.toLowerCase()}`) || "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch { return []; }
}

const ERROR_COPY: Record<string, string> = {
  player_not_found: "Player record is unavailable.", invalid_target: "That target is no longer valid.",
  cannot_target_self: "You cannot target your own city.", march_slots_full: "All march queues are busy.",
  troops_required: "Select at least one troop.", march_capacity_exceeded: "The selected force exceeds this march's capacity.",
  resource_force_exceeds_need: "This resource planet cannot use that many troops. Follow its recommended crew cap.",
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
export function recommendedGatherForce(troops: GameState["troops"], limit: number): Record<TroopKey, Record<string, number>> {
  const selected = emptySelection();
  let remaining = Math.max(0, Math.floor(limit));
  const rows = TROOP_ORDER.flatMap((arm) => Object.entries(troops[arm] ?? {})
    .map(([tier, qty]) => ({ arm, tier, qty: Math.max(0, Math.floor(qty)) }))
    .filter((row) => row.qty > 0))
    .sort((left, right) => Number(right.tier) - Number(left.tier));
  rows.forEach(({ arm, tier, qty }) => {
    const take = Math.min(remaining, qty);
    if (take > 0) selected[arm][tier] = take;
    remaining -= take;
  });
  return selected;
}
export function gatherCarryWithAccount(
  troops: Record<TroopKey, Record<string, number>>,
  accountModifiers: Record<string, number>,
  numbers: any,
): number {
  const runtime = { ...(numbers.runtimeAccountModifiers ?? {}) };
  Object.entries(accountModifiers).forEach(([key, value]) => { runtime[key] = (Number(runtime[key]) || 0) + (Number(value) || 0); });
  return carryCapacity({ troops }, { ...numbers, runtimeAccountModifiers: runtime });
}
export function marchMapProgress(march: HeadlessMarch, now: number): number {
  if (march.state === "outbound") return Math.max(0, Math.min(1, (now - march.dispatchedAt) / Math.max(1, march.arriveAt - march.dispatchedAt)));
  if (march.state === "gathering") return 1;
  if (march.state !== "returning") return 0;
  const fullTravel = Math.max(1, march.arriveAt - march.dispatchedAt);
  const legacyRecallStart = march.workUntil > 0
    ? march.returnAt - fullTravel
    : (march.returnAt + march.dispatchedAt) / 2;
  const returnStartedAt = march.returnStartedAt
    || (march.outcome === "recalled" ? legacyRecallStart : march.workUntil || march.arriveAt);
  const outboundProgressAtReturn = returnStartedAt >= march.arriveAt
    ? 1
    : Math.max(0, Math.min(1, (returnStartedAt - march.dispatchedAt) / fullTravel));
  const returnProgress = (now - returnStartedAt) / Math.max(1, march.returnAt - returnStartedAt);
  return Math.max(0, Math.min(1, outboundProgressAtReturn * (1 - returnProgress)));
}
function entityLevel(entity: SelectableEntity): number { return entity.kind === "city" ? entity.townhallLevel : entity.level; }
function cityShielded(city: CityEntity, now: number, numbers: any): boolean {
  return !city.hasAttacked && (city.shieldUntil > now || city.townhallLevel < (Number(numbers.global?.shield?.protectedUntilKeepLevel) || 0));
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
  const sessionRef = useRef(initial.session);
  const [now, setNow] = useState(Date.now());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Record<TroopKey, Record<string, number>>>(emptySelection);
  const [message, setMessage] = useState(initial.session.migratedLegacyAt ? "Old World marches were safely settled and migrated." : "");
  const [zoom, setZoom] = useState(1.8);
  const [layers, setLayers] = useState<Record<WorldLayer, boolean>>({ resource: true, monster: true, city: true });
  const [coordinateDraft, setCoordinateDraft] = useState({ x: "", y: "" });
  const [bookmarks, setBookmarks] = useState<string[]>(() => loadBookmarks(address));
  const [resultNotice, setResultNotice] = useState<ResultNotice | null>(null);
  const [tileMark, setTileMark] = useState<Point | null>(null);
  const playerCity = session.world.entities[session.world.players[session.playerId].cityId] as CityEntity;
  const [camera, setCamera] = useState<Point>(() => ({ ...playerCity.position }));
  const drag = useRef<{ x: number; y: number; camera: Point; moved: boolean } | null>(null);
  const dispatchSeq = useRef(0);
  const seenReportCount = useRef(initial.session.world.players[initial.session.playerId].reportIds.length);
  const gm = hasLocalGm(address) || localGmRequested();

  useEffect(() => { gameRef.current = game; }, [game]);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => {
    if (localGmRequested()) grantLocalGm(address);
    const opened = openLocalWorldSession(address, loadGame(address) || initGame(address), Date.now(), N);
    setGame(opened.game); gameRef.current = opened.game; setSession(opened.session); sessionRef.current = opened.session;
    const city = opened.session.world.entities[opened.session.world.players[opened.session.playerId].cityId] as CityEntity;
    setCamera({ ...city.position }); saveGame(opened.game); saveLocalWorldSession(opened.session);
    setBookmarks(loadBookmarks(address));
    seenReportCount.current = opened.session.world.players[opened.session.playerId].reportIds.length;
    if (opened.session.migratedLegacyAt) setMessage("Old World marches were safely settled and migrated.");
  }, [address, N]);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const tick = Date.now(); setNow(tick);
      const result = advanceLocalWorldSession(sessionRef.current, loadGame(address) || gameRef.current, tick, N);
      if (!result.changed) return;
      const reports = result.session.world.players[result.session.playerId].reportIds;
      if (reports.length > seenReportCount.current) {
        const report = result.session.world.reports[reports[reports.length - 1]];
        if (report) setResultNotice(reportCopy(report, result.session.world));
        seenReportCount.current = reports.length;
      }
      sessionRef.current = result.session; setSession(result.session);
      setGame(result.game); gameRef.current = result.game; saveGame(result.game); saveLocalWorldSession(result.session);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [address, N]);
  useEffect(() => {
    try { localStorage.setItem(`ruglands:world-bookmarks:${address.toLowerCase()}`, JSON.stringify(bookmarks)); } catch {}
  }, [address, bookmarks]);

  const world = session.world;
  const viewGame = useMemo(() => project(game, now), [game, now]);
  const targets = useMemo(() => Object.values(world.entities).filter((entity): entity is SelectableEntity => entity.kind === "resource" || entity.kind === "monster" || (entity.kind === "city" && entity.ownerId !== session.playerId)), [world.entities, session.playerId]);
  const selected = targets.find((target) => target.id === selectedId) || null;
  const activeMarches = Object.values(world.marches).filter((march) => !["completed", "failed"].includes(march.state));
  const sentCount = TROOP_ORDER.reduce((sum, arm) => sum + Object.values(selection[arm]).reduce((subtotal, qty) => subtotal + (qty || 0), 0), 0);
  const viewport = { width: world.config.width / zoom, height: world.config.width * .655 / zoom };
  // The camera may look beyond a State edge. This is intentional: a node near
  // the rim must still be able to occupy the true visual center of the screen.
  const viewX = camera.x - viewport.width / 2;
  const viewY = camera.y - viewport.height / 2;
  const viewBox = `${viewX} ${viewY} ${viewport.width} ${viewport.height}`;
  const center = worldCenter(world.config);
  const worldRadius = Math.hypot(world.config.width / 2, world.config.height / 2);
  const player = world.players[session.playerId];
  const marchSpeed = Math.max(.01, 1 + (Number(N.global?.accountModifiers?.marchSpeedBonus) || 0)
    + (Number(player.accountModifiers.marchSpeedBonus) || 0));
  const marchCapacity = Math.floor(player.marchCapacity * (1 + (Number(N.global?.accountModifiers?.marchCapacityBonus) || 0)
    + (Number(player.accountModifiers.marchCapacityBonus) || 0)));
  const travelSecondsTo = (point: Point) => distance(playerCity.position, point) * world.config.travelSecondsPerTile / marchSpeed;
  const oneWay = selected ? travelSecondsTo(selected.position) : 0;
  const gatherRequirement = selected?.kind === "resource" ? resourceTroopRequirement(selected.level, N) : Number.POSITIVE_INFINITY;
  const forceLimit = Math.min(marchCapacity, gatherRequirement);
  const energy = energyAt(player, now, world.config);
  // How much the CURRENTLY selected force would actually haul from this planet.
  const gatherCrewFraction = selected?.kind === "resource" && Number.isFinite(gatherRequirement) && gatherRequirement > 0 ? Math.min(1, sentCount / gatherRequirement) : 1;
  const expectedHarvest = selected?.kind === "resource" ? Math.floor(Math.min(gatherCarryWithAccount(selection, player.accountModifiers, N), selected.amount * gatherCrewFraction)) : 0;
  // While a harvest march works this planet, show its liquidity draining in real time
  // (the engine only settles the deduction on return, so this is a projected read).
  const activeGatherOnSelected = selected?.kind === "resource" ? activeMarches.find((m) => m.targetId === selected.id && m.action === "gather" && m.state === "gathering") : undefined;
  const liveSelectedAmount = (() => {
    if (!selected || selected.kind !== "resource") return 0;
    if (!activeGatherOnSelected) return selected.amount;
    const m = activeGatherOnSelected;
    const progress = Math.max(0, Math.min(1, (now - m.arriveAt) / Math.max(1, m.workUntil - m.arriveAt)));
    const req = resourceTroopRequirement(selected.level, N);
    const count = TROOP_ORDER.reduce((sum, arm) => sum + Object.values(m.force[arm] ?? {}).reduce((s, q) => s + (q || 0), 0), 0);
    const frac = Number.isFinite(req) && req > 0 ? Math.min(1, count / req) : 1;
    const reserved = Math.floor(Math.min(gatherCarryWithAccount(m.force, player.accountModifiers, N), selected.amount * frac));
    return Math.max(0, selected.amount - Math.floor(reserved * progress));
  })();
  // Mission Archive = settled RESULTS only. In-flight gather milestones are already
  // shown live (with countdowns) in Live Fleets, so they are excluded here to avoid duplication.
  const latestReports = player.reportIds.slice().reverse().map((id) => world.reports[id]).filter((report) => report && !ARCHIVE_HIDDEN_OUTCOMES.has(report.outcome)).slice(0, 6);
  const strategicZoom = zoom < 1.45;
  const playerSearchZoom = zoom >= 2.35;
  const detailZoom = zoom >= 3;
  const markerScale = 1 / zoom;
  const importantScale = (strategicZoom ? 1.6 : 1.18) / zoom;
  const filteredTargets = useMemo(() => targets.filter((entity) => layers[entity.kind]
    && !(entity.kind === "resource" && entity.state === "depleted")
    && !(entity.kind === "monster" && entity.state === "defeated")), [layers, targets]);
  const signalClusters = useMemo(() => clusterWorldSignals(filteredTargets, 72), [filteredTargets]);
  const bookmarkedTargets = bookmarks.map((id) => targets.find((target) => target.id === id)).filter((target): target is SelectableEntity => !!target);
  const scoutedTargetIds = useMemo(() => new Set(player.reportIds.map((id) => world.reports[id]).filter((report) => report?.action === "scout" && report.outcome === "scouted").map((report) => report.targetId)), [player.reportIds, world.reports]);
  const selectedScoutReport = selected ? player.reportIds.slice().reverse().map((id) => world.reports[id]).find((report) => report?.targetId === selected.id && report.action === "scout" && report.outcome === "scouted") : undefined;
  const selectedScoutSnapshot = (selectedScoutReport?.payload.snapshot ?? {}) as Record<string, number>;
  const selectedVerified = !!selected && (selected.kind === "resource" || scoutedTargetIds.has(selected.id));
  const zoomLabel = strategicZoom ? "STRATEGIC" : detailZoom ? "TACTICAL" : "FIELD";

  function commit(result: ReturnType<typeof advanceLocalWorldSession>) {
    sessionRef.current = result.session; setSession(result.session); setGame(result.game); gameRef.current = result.game; saveLocalWorldSession(result.session); saveGame(result.game);
  }
  function revealLatestReport(next: LocalWorldSession) {
    const ids = next.world.players[next.playerId].reportIds;
    seenReportCount.current = ids.length;
    const report = next.world.reports[ids[ids.length - 1]];
    if (report) setResultNotice(reportCopy(report, next.world));
  }
  function setTroop(arm: TroopKey, tier: string, qty: number) {
    const available = viewGame.troops[arm]?.[tier] ?? 0;
    setSelection((current) => {
      const currentRow = current[arm][tier] ?? 0;
      const currentTotal = TROOP_ORDER.reduce((sum, key) => sum + Object.values(current[key]).reduce((subtotal, amount) => subtotal + (amount || 0), 0), 0);
      const rowLimit = Math.max(0, forceLimit - (currentTotal - currentRow));
      return { ...current, [arm]: { ...current[arm], [tier]: Math.max(0, Math.min(available, rowLimit, Math.floor(qty) || 0)) } };
    });
  }
  function maxTroop(arm: TroopKey, tier: string, available: number) {
    setTroop(arm, tier, available);
  }
  function autoAssignGatherForce() { setSelection(recommendedGatherForce(viewGame.troops, forceLimit)); }
  function run(action: "scout" | "gather" | "attack_monster" | "attack_city") {
    if (!selected) return;
    // Scouting occupies a march slot but does not quietly reserve whatever force
    // the player happened to have selected for a later attack.
    const force = action === "scout" ? emptySelection() : selection;
    const result = dispatchLocalWorldMarch(session, viewGame, { targetId: selected.id, action, force, idempotencyKey: `ui:${Date.now()}:${dispatchSeq.current++}` }, Date.now(), N);
    if (result.error) { setMessage(ERROR_COPY[result.error] || result.error.split("_").join(" ")); return; }
    commit(result); setSelection(emptySelection());
    setMessage(`${action === "scout" ? "Survey probe" : action === "gather" ? "Harvest fleet" : "Strike fleet"} launched toward ${localWorldTargetName(result.session.world, selected.id)}.`);
  }
  function finishMarches() {
    const result = finishLocalWorldMarches(session, viewGame, Date.now(), N); commit(result);
    revealLatestReport(result.session);
    setMessage("GM: all active marches completed through the headless engine.");
  }
  function fillTroops() {
    const result = advanceLocalWorldSession(session, gmFillTroops(viewGame), Date.now(), N); commit(result);
    setMessage("GM: standing troops filled to current training-building capacity.");
  }
  function focusTarget(targetId: string) {
    const target = targets.find((entity) => entity.id === targetId);
    if (!target) { setMessage("That signal has left the current sector."); return; }
    setSelectedId(target.id); setCamera({ ...target.position }); setZoom((value) => Math.max(value, target.kind === "city" ? 2.65 : 2.1)); setMessage("");
  }
  function toggleLayer(layer: WorldLayer) {
    setLayers((current) => ({ ...current, [layer]: !current[layer] }));
    if (selected?.kind === layer) setSelectedId(null);
  }
  function toggleBookmark(targetId: string) {
    setBookmarks((current) => current.includes(targetId) ? current.filter((id) => id !== targetId) : [...current, targetId]);
  }
  function viewCoordinates() {
    const x = Number(coordinateDraft.x); const y = Number(coordinateDraft.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) { setMessage("Enter a valid X and Y coordinate."); return; }
    const point = { x: Math.max(0, Math.min(world.config.width, x)), y: Math.max(0, Math.min(world.config.height, y)) };
    setCamera(point); setSelectedId(null); setMessage(`Viewing sector ${Math.round(point.x).toString().padStart(3, "0")}:${Math.round(point.y).toString().padStart(3, "0")}. Your civilization has not moved.`);
  }
  function recall(marchId: string) {
    // gameRef is updated synchronously by commit; the projected render value can
    // lag one frame behind a dispatch during fast GM/browser interactions.
    const result = recallLocalWorldMarch(session, gameRef.current, marchId, Date.now(), N);
    if (result.error) { setMessage("That fleet can no longer be recalled."); return; }
    commit(result); setMessage("Fleet recalled. It is returning along its traveled route.");
  }
  function pointerDown(event: React.PointerEvent<SVGSVGElement>) { drag.current = { x: event.clientX, y: event.clientY, camera, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }
  function pointerMove(event: React.PointerEvent<SVGSVGElement>) {
    if (!drag.current) return;
    if (!drag.current.moved && Math.hypot(event.clientX - drag.current.x, event.clientY - drag.current.y) > 3) drag.current.moved = true;
    const scale = viewport.width / Math.max(1, event.currentTarget.clientWidth);
    setCamera({
      x: Math.max(0, Math.min(world.config.width, drag.current.camera.x - (event.clientX - drag.current.x) * scale)),
      y: Math.max(0, Math.min(world.config.height, drag.current.camera.y - (event.clientY - drag.current.y) * scale)),
    });
  }
  function pointerUp(event: React.PointerEvent<SVGSVGElement>) {
    const state = drag.current; drag.current = null;
    // A press with no drag on empty space = inspect that tile's coordinate (Kingshot-style).
    if (!state || state.moved) return;
    const svg = event.currentTarget; const ctm = svg.getScreenCTM(); if (!ctm) return;
    const pt = svg.createSVGPoint(); pt.x = event.clientX; pt.y = event.clientY;
    const local = pt.matrixTransform(ctm.inverse());
    const tx = Math.max(0, Math.min(world.config.width - 1, Math.floor(local.x)));
    const ty = Math.max(0, Math.min(world.config.height - 1, Math.floor(local.y)));
    setTileMark({ x: tx, y: ty }); setSelectedId(null);
  }

  return <section className="world world-crypto world-cosmos">
    <GameNav view="world" profile={profile} townhallLevel={viewGame.buildings.keep.lvl}
      location={`SECTOR ${world.stateId.slice(-6).toUpperCase()} · HOME ${Math.round(playerCity.position.x).toString().padStart(3, "0")}:${Math.round(playerCity.position.y).toString().padStart(3, "0")}`}
      resources={viewGame.res}
      energy={energy} energyCap={world.config.energyCap} activeFleets={activeMarches.length} fleetCap={player.marchSlots}
      standing={totalTroops(viewGame)} wounded={viewGame.wounded} might={mightBreakdown(viewGame).total}
      onCity={onBack} onWorld={() => {}} />
    {gm && <div className="world-gm-strip"><span>LOCAL GM</span><button onClick={fillTroops}>FILL TROOPS</button><button onClick={finishMarches} disabled={!activeMarches.length}>RESOLVE FLEETS</button></div>}
    {message && <div className="world-message">{message}</div>}
    <div className="world-layout">
      <div className="world-map-shell">
        <div className="world-map-status"><b>{zoomLabel}</b><em>{Math.round(zoom * 100)}%</em></div>
        <div className="world-map-tools"><button onClick={() => setCamera({ ...playerCity.position })}>HOME</button><button onClick={() => setCamera(center)}>WORMHOLE</button><button aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(8, value + .35))}>＋</button><button aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(1, value - .35))}>－</button></div>
        <form className="world-coordinate-jump" onSubmit={(event) => { event.preventDefault(); viewCoordinates(); }}><label>X<input aria-label="X coordinate" value={coordinateDraft.x} onChange={(event) => setCoordinateDraft((value) => ({ ...value, x: event.target.value }))} inputMode="numeric" /></label><label>Y<input aria-label="Y coordinate" value={coordinateDraft.y} onChange={(event) => setCoordinateDraft((value) => ({ ...value, y: event.target.value }))} inputMode="numeric" /></label><button>GO</button><button type="button" className="world-warp-locked" onClick={() => setMessage("Relocation requires a Warp Engine consumable. Warp travel is not enabled in this MVP build.")}>WARP 🔒</button></form>
        <div className="world-coordinate world-coordinate-x">X {Math.round(viewX).toString().padStart(3, "0")} — {Math.round(viewX + viewport.width).toString().padStart(3, "0")}</div>
        <div className="world-coordinate world-coordinate-y">Y {Math.round(viewY).toString().padStart(3, "0")} — {Math.round(viewY + viewport.height).toString().padStart(3, "0")}</div>
        <svg className="world-map world-map-v2" viewBox={viewBox} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={() => { drag.current = null; }} onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.max(1, Math.min(8, value + (event.deltaY < 0 ? .22 : -.22)))); }}>
          <defs>
            <pattern id="world-micro-grid" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M 8 0 L 0 0 0 8" fill="none" stroke="#17344a" strokeWidth=".25" opacity=".34" /></pattern>
            <pattern id="world-grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M 40 0 L 0 0 0 40" fill="none" stroke="#2e7892" strokeWidth=".48" opacity=".52" /><circle cx="0" cy="0" r=".7" fill="#41dffc" opacity=".5" /></pattern>
            <pattern id="world-stars" width="64" height="64" patternUnits="userSpaceOnUse"><circle cx="7" cy="13" r=".42" fill="#c9f4ff" opacity=".72"/><circle cx="43" cy="8" r=".25" fill="#a8c8ff" opacity=".55"/><circle cx="27" cy="47" r=".35" fill="#e2d4ff" opacity=".64"/><circle cx="58" cy="36" r=".18" fill="#fff" opacity=".8"/><circle cx="12" cy="59" r=".2" fill="#73dfff" opacity=".48"/></pattern>
            <radialGradient id="world-ground" cx="58%" cy="42%"><stop offset="0" stopColor="#152044"/><stop offset=".34" stopColor="#0b1532"/><stop offset=".72" stopColor="#060c20"/><stop offset="1" stopColor="#02050e"/></radialGradient>
            <radialGradient id="world-nebula" cx="50%" cy="50%"><stop offset="0" stopColor="#7a49d8" stopOpacity=".16"/><stop offset=".48" stopColor="#215e9b" stopOpacity=".07"/><stop offset="1" stopColor="#030711" stopOpacity="0"/></radialGradient>
            <radialGradient id="circle-core"><stop offset="0" stopColor="#010208" stopOpacity="1"/><stop offset=".22" stopColor="#09051d" stopOpacity="1"/><stop offset=".48" stopColor="#a35cff" stopOpacity=".42"/><stop offset=".72" stopColor="#38d9ff" stopOpacity=".16"/><stop offset="1" stopColor="#1d123a" stopOpacity="0"/></radialGradient>
            <filter id="signal-glow" x="-200%" y="-200%" width="400%" height="400%"><feGaussianBlur stdDeviation="1.6" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>
          <rect x={-world.config.width} y={-world.config.height} width={world.config.width * 3} height={world.config.height * 3} fill="url(#world-ground)" />
          <rect x={-world.config.width} y={-world.config.height} width={world.config.width * 3} height={world.config.height * 3} fill="url(#world-nebula)" />
          <g className="world-starfield">
            <rect x={-world.config.width} y={-world.config.height} width={world.config.width * 3} height={world.config.height * 3} fill="url(#world-stars)" />
            <animateTransform attributeName="transform" type="rotate" from={`0 ${center.x} ${center.y}`} to={`360 ${center.x} ${center.y}`} dur="420s" repeatCount="indefinite" />
          </g>
          <rect x={-world.config.width} y={-world.config.height} width={world.config.width * 3} height={world.config.height * 3} fill="url(#world-micro-grid)" />
          <rect x={-world.config.width} y={-world.config.height} width={world.config.width * 3} height={world.config.height * 3} fill="url(#world-grid)" />
          {Array.from({ length: 5 }, (_, index) => index + 1).map((ring) => <circle key={ring} cx={center.x} cy={center.y} r={worldRadius * ring / 5} className="world-sector-ring" opacity={ring === 5 ? .9 : .34} />)}
          <circle cx={center.x} cy={center.y} r={world.config.circleReserveRadius * 1.55} fill="url(#circle-core)" />
          <circle cx={center.x} cy={center.y} r={world.config.circleReserveRadius} className="world-core-ring" />
          <circle cx={center.x} cy={center.y} r={world.config.circleReserveRadius * .62} className="world-core-ring inner" />
          <path d={`M ${center.x - world.config.circleReserveRadius - 8} ${center.y} H ${center.x + world.config.circleReserveRadius + 8} M ${center.x} ${center.y - world.config.circleReserveRadius - 8} V ${center.y + world.config.circleReserveRadius + 8}`} className="world-core-cross" />
          <g transform={`translate(${center.x} ${center.y}) scale(${importantScale}) translate(${-center.x} ${-center.y})`} className="world-core-marker" onPointerDown={(event) => event.stopPropagation()} onClick={() => setCamera(center)}><circle cx={center.x} cy={center.y} r="7.5" /><ellipse cx={center.x} cy={center.y} rx="5.2" ry="2.8" /><circle cx={center.x} cy={center.y} r="2.1" /><text x={center.x} y={center.y - 11} className="world-circle-label">WORMHOLE</text></g>
          {activeMarches.map((march) => <MarchLine key={march.id} march={march} now={now} zoom={zoom} />)}
          {strategicZoom && signalClusters.map((cluster) => <g key={cluster.id} transform={`translate(${cluster.position.x} ${cluster.position.y}) scale(${markerScale * 1.1}) translate(${-cluster.position.x} ${-cluster.position.y})`} className={`world-cluster ${cluster.kind}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setCamera(cluster.position); setZoom(1.8); }}>
            <circle cx={cluster.position.x} cy={cluster.position.y} r="6.5" /><circle cx={cluster.position.x} cy={cluster.position.y} r="3.7" /><text x={cluster.position.x} y={cluster.position.y + 1.3}>{cluster.count}</text>
          </g>)}
          {filteredTargets.filter((entity) => !strategicZoom && (entity.kind !== "city" || playerSearchZoom)).map((entity) => {
            const color = entityColor(entity); const unavailable = (entity.kind === "resource" && entity.state !== "available") || (entity.kind === "monster" && entity.state !== "alive"); const selectedTarget = selectedId === entity.id; const verified = entity.kind === "resource" || scoutedTargetIds.has(entity.id);
            return <g key={entity.id} transform={`translate(${entity.position.x} ${entity.position.y}) scale(${markerScale}) translate(${-entity.position.x} ${-entity.position.y})`} className={`world-target ${entity.kind} state-${entity.state} ${selectedTarget ? "selected" : ""} ${verified ? "verified" : "public"} ${bookmarks.includes(entity.id) ? "bookmarked" : ""} ${unavailable ? "depleted" : ""}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => { setSelectedId(entity.id); setSelection(emptySelection()); setMessage(""); setTileMark(null); }}>
              {selectedTarget && <><circle cx={entity.position.x} cy={entity.position.y} r="9" className="world-lock-ring" /><path d={`M ${entity.position.x - 12} ${entity.position.y} h 6 M ${entity.position.x + 6} ${entity.position.y} h 6 M ${entity.position.x} ${entity.position.y - 12} v 6 M ${entity.position.x} ${entity.position.y + 6} v 6`} className="world-lock-cross" /></>}
              <circle cx={entity.position.x} cy={entity.position.y} r={entity.kind === "city" ? 4.5 : 3.6} fill={color} className="world-signal-halo" />
              {detailZoom && entity.kind !== "city" ? <text x={entity.position.x} y={entity.position.y + 3.4} className="world-target-emoji">{entity.kind === "monster" ? "💀" : RESOURCE_EMOJI[entity.resource]}</text> : entity.kind === "city" ? <polygon points={`${entity.position.x},${entity.position.y - 4.1} ${entity.position.x + 3.6},${entity.position.y - 2} ${entity.position.x + 3.6},${entity.position.y + 2} ${entity.position.x},${entity.position.y + 4.1} ${entity.position.x - 3.6},${entity.position.y + 2} ${entity.position.x - 3.6},${entity.position.y - 2}`} fill={color} /> : entity.kind === "monster" ? <path d={`M ${entity.position.x} ${entity.position.y - 4.2} L ${entity.position.x + 4} ${entity.position.y + 3.4} H ${entity.position.x - 4} Z`} fill={color} /> : <rect x={entity.position.x - 3} y={entity.position.y - 3} width="6" height="6" fill={color} transform={`rotate(45 ${entity.position.x} ${entity.position.y})`} />}
              {verified && entity.kind !== "resource" && <circle cx={entity.position.x + 4.5} cy={entity.position.y - 4.5} r="1.2" className="world-verified-dot" />}
              {bookmarks.includes(entity.id) && <text x={entity.position.x + 7} y={entity.position.y - 6} className="world-bookmark-star">★</text>}
              {(selectedTarget || detailZoom) && <text x={entity.position.x} y={entity.position.y - 8} className="world-target-name">{localWorldTargetName(world, entity.id)}</text>}
              {(selectedTarget || detailZoom) && <text x={entity.position.x} y={entity.position.y + 8} className="world-target-level">L{entityLevel(entity)} · {entityState(entity)} · ETA {fmtDuration(travelSecondsTo(entity.position))}</text>}
            </g>;
          })}
          <g className="world-city" transform={`translate(${playerCity.position.x} ${playerCity.position.y}) scale(${importantScale}) translate(${-playerCity.position.x} ${-playerCity.position.y})`} onPointerDown={(event) => event.stopPropagation()} onClick={() => setCamera({ ...playerCity.position })}>
            <circle cx={playerCity.position.x} cy={playerCity.position.y} r="7.5" className="world-home-ring" />
            <rect x={playerCity.position.x - 4} y={playerCity.position.y - 4} width="8" height="8" rx="1" transform={`rotate(45 ${playerCity.position.x} ${playerCity.position.y})`} />
            <circle cx={playerCity.position.x} cy={playerCity.position.y} r="1.5" />
            <text x={playerCity.position.x} y={playerCity.position.y - 11} className="world-city-name">YOUR CIVILIZATION · TH{viewGame.buildings.keep.lvl}</text>
            <text x={playerCity.position.x} y={playerCity.position.y + 12} className="world-city-coordinate">{Math.round(playerCity.position.x).toString().padStart(3, "0")}:{Math.round(playerCity.position.y).toString().padStart(3, "0")}</text>
          </g>
          {tileMark && <g className="world-tile-mark" pointerEvents="none">
            <rect x={tileMark.x} y={tileMark.y} width="1" height="1" className="world-tile-cell" />
            <g transform={`translate(${tileMark.x + .5} ${tileMark.y + .5}) scale(${markerScale}) translate(${-(tileMark.x + .5)} ${-(tileMark.y + .5)})`}>
              <path d={`M ${tileMark.x + .5 - 6} ${tileMark.y + .5} h 3.5 M ${tileMark.x + .5 + 2.5} ${tileMark.y + .5} h 3.5 M ${tileMark.x + .5} ${tileMark.y + .5 - 6} v 3.5 M ${tileMark.x + .5} ${tileMark.y + .5 + 2.5} v 3.5`} className="world-tile-cross" />
              <text x={tileMark.x + .5} y={tileMark.y + .5 - 7.5} className="world-tile-coord">{tileMark.x.toString().padStart(3, "0")}:{tileMark.y.toString().padStart(3, "0")}</text>
            </g>
          </g>}
        </svg>
        {resultNotice && <div className={`world-event-toast ${resultNotice.good ? "good" : "bad"}`}><div><small>MISSION UPDATE</small><b>{resultNotice.title}</b><span>{resultNotice.detail}</span></div><button aria-label="Dismiss mission update" onClick={() => setResultNotice(null)}>×</button></div>}
        <div className="world-map-legend"><button className={layers.city ? "active" : ""} onClick={() => toggleLayer("city")}><i className="city" />CIVILIZATIONS</button><button className={layers.resource ? "active" : ""} onClick={() => toggleLayer("resource")}><i className="resource" />PLANETS</button><button className={layers.monster ? "active" : ""} onClick={() => toggleLayer("monster")}><i className="hostile" />ROGUES</button><span><i className="march" />FLEETS</span></div>
        <div className="world-map-hint">{world.config.width}×{world.config.height} · {Object.keys(world.players).length}/{world.config.maxPlayers} CIVILIZATIONS</div>
      </div>
      <aside className="world-side">
        {!selected ? <div className="world-empty"><div className="world-empty-radar"><i /><i /><i /></div><b>SELECT A SIGNAL</b></div> : <>
          <div className={`world-intel-ribbon ${selectedVerified ? "verified" : "public"}`}><span>{selected.kind === "resource" ? "LIVE" : selectedVerified ? "SCANNED" : "PUBLIC"}</span></div>
          <div className="world-target-actions"><button className={bookmarks.includes(selected.id) ? "saved" : ""} onClick={() => toggleBookmark(selected.id)}>{bookmarks.includes(selected.id) ? "★ SAVED" : "☆ SAVE"}</button></div>
          <div className="world-target-head"><span style={{ color: entityColor(selected) }}>{KIND_META[selected.kind].icon}</span><div><small>{KIND_META[selected.kind].label}</small><b>{localWorldTargetName(world, selected.id)}</b></div><em>L{entityLevel(selected)}</em></div>
          <div className="world-facts"><span>COORDS <b>{Math.round(selected.position.x).toString().padStart(3, "0")}:{Math.round(selected.position.y).toString().padStart(3, "0")}</b></span><span>DISTANCE <b>{distance(playerCity.position, selected.position).toFixed(1)} LU</b></span><span>ETA <b>{fmtDuration(oneWay)}</b></span>
            {selected.kind === "resource" && <><span>ASSET <b style={{ color: RESOURCE_COLORS[selected.resource] }}>{RES[selected.resource].label}</b></span><span>AVAILABLE <b className={activeGatherOnSelected ? "world-liquidity-draining" : ""}>{compact(displayResource(liveSelectedAmount))}</b></span></>}
            {selected.kind === "monster" && <><span>POWER <b>{selectedVerified ? compact(selected.power) : "ENCRYPTED"}</b></span><span>TYPE <b>{selectedVerified ? TROOPS_META[selected.dominantArm].label : "UNKNOWN"}</b></span></>}
            {selected.kind === "city" && <><span>SHIELD <b>{cityShielded(selected, now, N) ? "ACTIVE" : "OPEN"}</b></span><span>WALL <b>{selectedVerified ? `${selected.wall.value}/${selected.wall.max}` : "ENCRYPTED"}</b></span><span>GARRISON <b>{selectedVerified ? compact(displayTroops(selectedScoutSnapshot.garrison ?? 0)) : "ENCRYPTED"}</b></span><span>LOOT <b>{selectedVerified ? compact(displayResource(selectedScoutSnapshot.estimatedLoot ?? 0)) : "ENCRYPTED"}</b></span></>}
          </div>
          {selected.kind !== "resource" && <button className="world-scout" onClick={() => run("scout")}><span>SCAN</span><em>1 SLOT</em></button>}
          <div className="world-force-title"><b>FLEET</b><span className="world-force-count"><b>{compact(displayTroops(sentCount))}</b> / {compact(displayTroops(forceLimit))}</span></div>
          {selected.kind === "resource" && <div className="world-gather-recommend"><div><b>CREW {compact(displayTroops(gatherRequirement))}</b></div><button onClick={autoAssignGatherForce}>AUTO</button></div>}
          <div className="world-force-list">
            {TROOP_ORDER.flatMap((arm) => Object.entries(viewGame.troops[arm] ?? {}).filter(([, qty]) => qty > 0).map(([tier, qty]) => {
              const sel = selection[arm][tier] ?? 0;
              const rowMax = Math.max(sel, Math.min(qty, forceLimit - (sentCount - sel)));
              return <div className="world-force-row" key={`${arm}-${tier}`}>
                <span>{TROOPS_META[arm].emoji} {TROOPS_META[arm].label} T{tier}<small><b>{compact(displayTroops(sel))}</b> / {compact(displayTroops(qty))}</small></span>
                <input type="range" min="0" max={rowMax} step="1" value={sel} onChange={(event) => setTroop(arm, tier, Number(event.target.value))} disabled={rowMax <= 0} />
                <button onClick={() => maxTroop(arm, tier, rowMax)}>MAX</button>
              </div>;
            }))}
            {totalTroops(viewGame) === 0 && <div className="world-no-force">NO TROOPS</div>}
          </div>
          {selected.kind === "resource" && sentCount > 0 && <div className="world-harvest-estimate"><span>HAUL</span><b style={{ color: RESOURCE_COLORS[selected.resource] }}>{RESOURCE_EMOJI[selected.resource]} {compact(displayResource(expectedHarvest))} {RES[selected.resource].label}</b></div>}
          {selected.kind === "resource" ? <button className="world-dispatch" disabled={sentCount <= 0 || selected.state !== "available"} onClick={() => run("gather")}>HARVEST PLANET →</button> : selected.kind === "monster" ? <button className="world-dispatch danger" disabled={sentCount <= 0 || selected.state !== "alive"} onClick={() => run("attack_monster")}>ENGAGE ROGUE · {world.config.monsterEnergyCost} ENERGY →</button> : <button className="world-dispatch danger" disabled={sentCount <= 0 || cityShielded(selected, now, N)} onClick={() => run("attack_city")}>ATTACK CIVILIZATION →</button>}
        </>}
        <div className="world-marches"><div className="world-force-title"><b>FLEETS</b><span>{activeMarches.length}/{player.marchSlots}</span></div>{activeMarches.map((march) => <div className="world-march" key={march.id}><button className="world-march-focus" onClick={() => focusTarget(march.targetId)}><span>{march.action === "scout" ? "◎" : march.action === "gather" ? "◇" : "△"}</span><div><b>{localWorldTargetName(world, march.targetId)}</b><small>{march.state === "outbound" ? (march.action === "gather" ? "EN ROUTE TO HARVEST" : march.action === "scout" ? "SCOUT EN ROUTE" : "STRIKE EN ROUTE") : march.state === "gathering" ? "HARVESTING" : "RETURNING"} · <b>{fmtDuration(marchRemainingSec(march, now))}</b></small></div></button>{["outbound", "gathering"].includes(march.state) && <button className="world-recall" onClick={() => recall(march.id)}>RECALL</button>}</div>)}{!activeMarches.length && <div className="world-no-force">IDLE</div>}</div>
        {!!bookmarkedTargets.length && <div className="world-bookmarks"><div className="world-force-title"><b>SAVED</b><span>{bookmarkedTargets.length}</span></div>{bookmarkedTargets.map((target) => <button key={target.id} onClick={() => focusTarget(target.id)}><span style={{ color: entityColor(target) }}>{KIND_META[target.kind].icon}</span><b>{localWorldTargetName(world, target.id)}</b><small>{Math.round(target.position.x).toString().padStart(3, "0")}:{Math.round(target.position.y).toString().padStart(3, "0")}</small></button>)}</div>}
        {!!latestReports.length && <div className="world-reports"><div className="world-force-title"><b>REPORTS</b></div>{latestReports.map((report) => { const copy = reportCopy(report, world); return <button onClick={() => focusTarget(report.targetId)} className={`world-report ${copy.good ? "good" : "bad"}`} key={report.id}><b>{copy.title}</b><span>{copy.detail}</span></button>; })}</div>}
      </aside>
    </div>
  </section>;
}

function MarchLine({ march, now, zoom }: { march: HeadlessMarch; now: number; zoom: number }) {
  const progress = marchMapProgress(march, now); const x = march.origin.x + (march.destination.x - march.origin.x) * progress; const y = march.origin.y + (march.destination.y - march.origin.y) * progress;
  const heading = march.state === "returning"
    ? Math.atan2(march.origin.y - march.destination.y, march.origin.x - march.destination.x)
    : Math.atan2(march.destination.y - march.origin.y, march.destination.x - march.origin.x);
  const rocketDeg = heading * 180 / Math.PI + 45; // 🚀 glyph nominally points up-right (~-45°)
  const eta = fmtDuration(marchRemainingSec(march, now));
  return <g className={`world-march-line ${march.action} state-${march.state}`}><line x1={march.origin.x} y1={march.origin.y} x2={march.destination.x} y2={march.destination.y} /><g transform={`translate(${x} ${y}) scale(${1 / zoom}) translate(${-x} ${-y})`}><circle cx={x} cy={y} r="4.6" className="world-march-pulse" /><text x={x} y={y} className="world-march-rocket" transform={`rotate(${rocketDeg} ${x} ${y})`}>🚀</text><text x={x} y={y - 6.5} className="world-march-eta">{eta}</text></g></g>;
}
