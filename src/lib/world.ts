// Persistent local world-map loop for the Personal Mode MVP.
// Coordinates and NPCs are deterministic per wallet; marches reserve real GameState troops.
import { getN } from "./numbers";
import {
  GameState, RES_ORDER, TROOP_ORDER, TroopKey, capacity, maxTroops, project,
} from "./game";
import {
  CombatResult, Force, GatherResult, MonsterTarget, NodeTarget, ResKey, RivalTarget,
  ScoutReport, Target, carryCapacity, isShielded, marchTimeSec, resolveCombat,
  resolveGather, resolveScout,
} from "./expedition";

export interface WorldPoint { x: number; y: number }
export interface WorldTarget extends WorldPoint {
  id: string;
  name: string;
  target: Target;
}

export type MarchAction = "scout" | "gather" | "raid";
export interface WorldMarch {
  id: string;
  action: MarchAction;
  targetId: string;
  targetName: string;
  from: WorldPoint;
  to: WorldPoint;
  force: Force;
  departAt: number;
  arriveAt: number;
  actionEndsAt: number;
  returnAt: number;
  result: ScoutReport | GatherResult | CombatResult;
  reward: Partial<Record<ResKey, number>>;
  resolved: boolean;
}

export interface WorldReport {
  id: string;
  at: number;
  title: string;
  detail: string;
  good: boolean;
}

export interface WorldState {
  version: 1;
  address: string;
  player: WorldPoint;
  targets: WorldTarget[];
  marches: WorldMarch[];
  reports: WorldReport[];
}

export interface WorldResult {
  world: WorldState;
  game: GameState;
  ok: boolean;
  reason?: string;
}

const WORLD_SIZE = 2000;
export const WORLD_CENTER: WorldPoint = { x: WORLD_SIZE / 2, y: WORLD_SIZE / 2 };
export const WORLD_RADIUS = 900;
const KEY = (address: string) => `ruglands:world:${address.toLowerCase()}`;

function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let v = seed || 1;
  return () => {
    v = Math.imul(v ^ (v >>> 15), 1 | v);
    v ^= v + Math.imul(v ^ (v >>> 7), 61 | v);
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  };
}

export function distanceTiles(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / 50;
}

export function levelForPoint(point: WorldPoint, numbers: any = getN()): number {
  const rings = numbers.world?.rings ?? 10;
  const distance = Math.min(WORLD_RADIUS, Math.hypot(point.x - WORLD_CENTER.x, point.y - WORLD_CENTER.y));
  const ring = Math.max(1, Math.min(rings, Math.ceil((distance / WORLD_RADIUS) * rings)));
  return rings + 1 - ring;
}

function emptyTroops(): Force["troops"] {
  return { army: {}, navy: {}, air: {} };
}

function generatedTarget(kind: Target["kind"], level: number, random: () => number, numbers: any): Target {
  if (kind === "node") {
    const resources: ResKey[] = ["cash", "oil", "power"];
    const supply = numbers.gatherNodes?.levels?.[String(level)]?.totalSupply ?? level * 1000;
    return { kind, level, resource: resources[Math.floor(random() * resources.length)], remaining: supply };
  }
  if (kind === "monster") {
    return {
      kind, level,
      power: Math.round(160 * Math.pow(1.72, level - 1)),
      reward: { cash: level * 350, oil: level * 180, power: level * 180 },
    };
  }
  const keepLevel = Math.max(1, Math.min(30, level * 3 + Math.floor(random() * 3) - 1));
  const tier = Math.max(1, Math.min(10, level));
  const perArm = Math.round(18 * Math.pow(1.45, level - 1));
  return {
    kind, keepLevel, wallLevel: Math.max(1, keepLevel - 1), hospitalLevel: Math.max(1, keepLevel - 2),
    troops: { army: { [tier]: perArm }, navy: { [tier]: Math.round(perArm * .55) }, air: { [tier]: Math.round(perArm * .35) } },
    resources: { cash: keepLevel * 3500, oil: keepLevel * 2200, power: keepLevel * 2200 },
    storageLevel: keepLevel,
    hasAttacked: keepLevel >= (numbers.global?.shield?.protectedUntilKeepLevel ?? 10),
  };
}

export function initWorld(address: string, numbers: any = getN()): WorldState {
  const random = rng(hashText(address.toLowerCase()));
  const spawnAngle = random() * Math.PI * 2;
  const spawnRadius = 760 + random() * 100;
  const player = {
    x: WORLD_CENTER.x + Math.cos(spawnAngle) * spawnRadius,
    y: WORLD_CENTER.y + Math.sin(spawnAngle) * spawnRadius,
  };
  const targets: WorldTarget[] = [];
  for (let i = 0; i < 42; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 80 + Math.sqrt(random()) * (WORLD_RADIUS - 80);
    const point = {
      x: WORLD_CENTER.x + Math.cos(angle) * radius,
      y: WORLD_CENTER.y + Math.sin(angle) * radius,
    };
    const level = levelForPoint(point, numbers);
    const roll = i % 6;
    const kind: Target["kind"] = roll <= 2 ? "node" : roll <= 4 ? "monster" : "rival";
    const target = generatedTarget(kind, level, random, numbers);
    const name = target.kind === "node"
      ? `${target.resource.toUpperCase()} FIELD`
      : target.kind === "monster" ? `WASTELAND CREW ${level}` : `OUTPOST ${String(i + 1).padStart(2, "0")}`;
    targets.push({ id: `target-${i + 1}`, name, ...point, target });
  }
  return { version: 1, address, player, targets, marches: [], reports: [] };
}

export function loadWorld(address: string): WorldState | null {
  try {
    const raw = localStorage.getItem(KEY(address));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.version === 1 ? parsed as WorldState : null;
  } catch { return null; }
}

export function saveWorld(world: WorldState): void {
  try { localStorage.setItem(KEY(world.address), JSON.stringify(world)); } catch {}
}

export function clearWorld(address: string): void {
  try { localStorage.removeItem(KEY(address)); } catch {}
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)); }

function forceCount(force: Force): number {
  return TROOP_ORDER.reduce((sum, arm) => sum + Object.values(force.troops[arm] ?? {}).reduce((s, qty) => s + (qty || 0), 0), 0);
}

function validateAndReserve(game: GameState, force: Force, action: MarchAction, numbers: any): string | null {
  if (action === "scout") return null;
  const count = forceCount(force);
  if (count <= 0) return "Select at least one troop.";
  const cap = Math.floor(maxTroops(game) * (numbers.global?.march?.capacityFractionOfMaxTroops ?? 1));
  if (count > cap) return `This march can carry at most ${cap.toLocaleString()} internal troop units.`;
  for (const arm of TROOP_ORDER) {
    for (const [tier, qty] of Object.entries(force.troops[arm] ?? {})) {
      if (qty < 0 || qty > (game.troops[arm]?.[tier] ?? 0)) return `Not enough ${arm} T${tier} troops in the city.`;
    }
  }
  return null;
}

function reserveForce(game: GameState, force: Force): void {
  for (const arm of TROOP_ORDER) {
    for (const [tier, qty] of Object.entries(force.troops[arm] ?? {})) {
      game.troops[arm][tier] = Math.max(0, (game.troops[arm][tier] ?? 0) - qty);
    }
  }
}

function rivalReward(target: RivalTarget, loot: number): Partial<Record<ResKey, number>> {
  const resources = target.resources ?? {};
  const total = RES_ORDER.reduce((sum, key) => sum + (resources[key] ?? 0), 0);
  if (total <= 0 || loot <= 0) return {};
  const reward: Partial<Record<ResKey, number>> = {};
  RES_ORDER.forEach((key) => { reward[key] = loot * ((resources[key] ?? 0) / total); });
  return reward;
}

export function dispatchMarch(
  sourceWorld: WorldState,
  sourceGame: GameState,
  targetId: string,
  action: MarchAction,
  force: Force,
  now = Date.now(),
  numbers: any = getN(),
): WorldResult {
  const world = clone(sourceWorld);
  const game = project(sourceGame, now);
  const target = world.targets.find((item) => item.id === targetId);
  if (!target) return { world, game, ok: false, reason: "Target no longer exists." };
  const active = world.marches.filter((march) => !march.resolved).length;
  if (active >= (numbers.global?.march?.marchQueueSlots ?? 1)) return { world, game, ok: false, reason: "All march queues are busy." };
  if (action === "scout" && target.target.kind === "node") return { world, game, ok: false, reason: "Resource fields are visible and never need scouting." };
  if (action === "gather" && target.target.kind !== "node") return { world, game, ok: false, reason: "Only resource fields can be gathered." };
  if (action === "raid" && target.target.kind === "node") return { world, game, ok: false, reason: "Choose a crew or rival outpost to raid." };
  if (action === "raid" && target.target.kind === "rival" && isShielded(target.target, numbers)) {
    return { world, game, ok: false, reason: "That city is still under newcomer protection." };
  }
  const invalid = validateAndReserve(game, force, action, numbers);
  if (invalid) return { world, game, ok: false, reason: invalid };

  const travelSec = marchTimeSec(distanceTiles(world.player, target), numbers);
  const arriveAt = now + travelSec * 1000;
  let result: WorldMarch["result"];
  let actionSec = 4;
  let reward: Partial<Record<ResKey, number>> = {};
  if (action === "scout") {
    result = resolveScout(target.target as MonsterTarget | RivalTarget, numbers);
  } else if (action === "gather") {
    const node = target.target as NodeTarget;
    result = resolveGather(node, carryCapacity(force, numbers), numbers);
    actionSec = result.tripTimeSec;
    reward = { [node.resource]: result.hauled };
    node.remaining = result.remainingAfter;
  } else {
    const hospitalRow = numbers.buildings?.["building.hospital"]?.levels?.[String(game.buildings.hospital.lvl)];
    const hospitalRoom = Math.max(0, (hospitalRow?.woundedCapacity ?? 0) - game.wounded);
    result = resolveCombat(force, target.target, numbers, hospitalRoom);
    reward = target.target.kind === "monster"
      ? (result.win ? target.target.reward : {})
      : rivalReward(target.target as RivalTarget, result.loot);
    if (result.win && target.target.kind === "rival") {
      RES_ORDER.forEach((key) => {
        const rival = target.target as RivalTarget;
        if (rival.resources) rival.resources[key] = Math.max(0, (rival.resources[key] ?? 0) - (reward[key] ?? 0));
      });
    }
  }
  if (action !== "scout") reserveForce(game, force);
  const actionEndsAt = arriveAt + actionSec * 1000;
  const march: WorldMarch = {
    id: `march-${now}-${world.marches.length}`,
    action, targetId, targetName: target.name, from: world.player, to: { x: target.x, y: target.y },
    force: clone(force), departAt: now, arriveAt, actionEndsAt,
    returnAt: actionEndsAt + travelSec * 1000, result, reward, resolved: false,
  };
  world.marches.push(march);
  return { world, game, ok: true };
}

function returnSurvivors(game: GameState, force: Force, casualtyTotal: number): void {
  let remainingLoss = Math.max(0, Math.round(casualtyTotal));
  let remainingTroops = forceCount(force);
  for (const arm of TROOP_ORDER) {
    for (const tier of Object.keys(force.troops[arm] ?? {}).sort((a, b) => Number(b) - Number(a))) {
      const sent = force.troops[arm][tier] ?? 0;
      const loss = remainingTroops > 0 ? Math.min(sent, Math.round(remainingLoss * sent / remainingTroops)) : 0;
      game.troops[arm][tier] = (game.troops[arm][tier] ?? 0) + sent - loss;
      remainingLoss -= loss;
      remainingTroops -= sent;
    }
  }
}

export function projectWorld(sourceWorld: WorldState, sourceGame: GameState, now = Date.now()): { world: WorldState; game: GameState; changed: boolean } {
  const world = clone(sourceWorld);
  const game = project(sourceGame, now);
  let changed = false;
  for (const march of world.marches) {
    if (march.resolved || now < march.returnAt) continue;
    changed = true;
    march.resolved = true;
    if (march.action === "gather") {
      returnSurvivors(game, march.force, 0);
      RES_ORDER.forEach((key) => { game.res[key] = Math.min(capacity(game), game.res[key] + (march.reward[key] ?? 0)); });
      const gathered = march.result as GatherResult;
      world.reports.unshift({ id: march.id, at: now, title: `Gatherers returned from ${march.targetName}`, detail: `${Math.round(gathered.hauled).toLocaleString()} supplies delivered.`, good: true });
    } else if (march.action === "raid") {
      const combat = march.result as CombatResult;
      const casualties = combat.attackerLosses.wounded + combat.attackerLosses.dead;
      returnSurvivors(game, march.force, casualties);
      game.wounded += combat.attackerLosses.wounded;
      RES_ORDER.forEach((key) => { game.res[key] = Math.min(capacity(game), game.res[key] + (march.reward[key] ?? 0)); });
      world.reports.unshift({ id: march.id, at: now, title: `${combat.win ? "Victory" : "Defeat"} at ${march.targetName}`, detail: `${casualties.toLocaleString()} casualties · ${Math.round(combat.loot).toLocaleString()} loot.`, good: combat.win });
    } else {
      const scout = march.result as ScoutReport;
      world.reports.unshift({ id: march.id, at: now, title: `Scout report: ${march.targetName}`, detail: `Level ${scout.level ?? "?"} · power ${Math.round(scout.garrison ?? 0).toLocaleString()} · estimated loot ${Math.round(scout.estimatedLoot).toLocaleString()}.`, good: true });
    }
  }
  world.reports = world.reports.slice(0, 12);
  world.marches = world.marches.filter((march) => !march.resolved || now - march.returnAt < 300_000).slice(-16);
  return { world, game, changed };
}

export function marchPhase(march: WorldMarch, now: number): "outbound" | "working" | "returning" | "complete" {
  if (march.resolved || now >= march.returnAt) return "complete";
  if (now < march.arriveAt) return "outbound";
  if (now < march.actionEndsAt) return "working";
  return "returning";
}

export function marchRemainingSec(march: WorldMarch, now: number): number {
  return Math.max(0, Math.ceil((march.returnAt - now) / 1000));
}
