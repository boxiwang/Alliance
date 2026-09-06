// Headless Personal World engine. No React, DOM, localStorage or network assumptions.
// The backend can eventually run this same deterministic state machine as the authority.
import type { ResKey, TroopKey } from "./game";
import { TROOP_ORDER } from "./game";
import { carryCapacity, resolveCombat, resolveGather, resolveScout } from "./expedition";
import { getN } from "./numbers";

export interface Point { x: number; y: number }
export type TroopManifest = Record<TroopKey, Record<string, number>>;
export type ResourceWallet = Record<ResKey, number>;

export interface WorldEngineConfig {
  width: number;
  height: number;
  maxPlayers: number;
  spawnGrid: number;
  spawnJitter: number;
  circleReserveRadius: number;
  spatialCellSize: number;
  cityFootprint: number;
  marchSlots: number;
  marchCapacity: number;
  travelSecondsPerTile: number;
  resourceRespawnSec: number;
  monsterRespawnSec: number;
  burnDurationSec: number;
  energyCap: number;
  energyRegenSec: number;
  monsterEnergyCost: number;
  beginnerShieldDurationSec: number;
  baseWallIntegrity: number;
  minimumWallDamageOnWin: number;
  wallDamageAtFullWinRatio: number;
}

export const DEFAULT_WORLD_ENGINE_CONFIG: WorldEngineConfig = {
  width: 512,
  height: 512,
  maxPlayers: 1024,
  spawnGrid: 34,
  spawnJitter: 1.25,
  circleReserveRadius: 38,
  spatialCellSize: 16,
  cityFootprint: 2,
  marchSlots: 2,
  marchCapacity: 1000,
  travelSecondsPerTile: 6,
  resourceRespawnSec: 10 * 60,
  monsterRespawnSec: 10 * 60,
  burnDurationSec: 30 * 60,
  energyCap: 100,
  energyRegenSec: 6 * 60,
  monsterEnergyCost: 10,
  beginnerShieldDurationSec: 72 * 3600,
  baseWallIntegrity: 1000,
  minimumWallDamageOnWin: 100,
  wallDamageAtFullWinRatio: 500,
};

export function worldEngineConfig(numbers: any = getN()): WorldEngineConfig {
  const state = numbers.world?.state ?? {};
  const lifecycle = numbers.world?.lifecycle ?? {};
  const energy = numbers.world?.energy ?? {};
  const cityCombat = numbers.world?.cityCombat ?? {};
  const march = numbers.global?.march ?? {};
  const value = (candidate: unknown, fallback: number) => {
    const parsed = Number(candidate);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  return {
    width: value(state.width, DEFAULT_WORLD_ENGINE_CONFIG.width),
    height: value(state.height, DEFAULT_WORLD_ENGINE_CONFIG.height),
    maxPlayers: value(state.maxPlayers, DEFAULT_WORLD_ENGINE_CONFIG.maxPlayers),
    spawnGrid: value(state.spawnGrid, DEFAULT_WORLD_ENGINE_CONFIG.spawnGrid),
    spawnJitter: value(state.spawnJitter, DEFAULT_WORLD_ENGINE_CONFIG.spawnJitter),
    circleReserveRadius: value(state.circleReserveRadius, DEFAULT_WORLD_ENGINE_CONFIG.circleReserveRadius),
    spatialCellSize: value(state.spatialCellSize, DEFAULT_WORLD_ENGINE_CONFIG.spatialCellSize),
    cityFootprint: value(state.cityFootprint, DEFAULT_WORLD_ENGINE_CONFIG.cityFootprint),
    marchSlots: value(march.marchQueueSlots, DEFAULT_WORLD_ENGINE_CONFIG.marchSlots),
    marchCapacity: value(march.baseMarchCapacity, DEFAULT_WORLD_ENGINE_CONFIG.marchCapacity),
    travelSecondsPerTile: value(march.baseTravelSecondsPerTile, DEFAULT_WORLD_ENGINE_CONFIG.travelSecondsPerTile),
    resourceRespawnSec: value(lifecycle.resourceRespawnSec, DEFAULT_WORLD_ENGINE_CONFIG.resourceRespawnSec),
    monsterRespawnSec: value(lifecycle.monsterRespawnSec, DEFAULT_WORLD_ENGINE_CONFIG.monsterRespawnSec),
    burnDurationSec: value(lifecycle.burnDurationSec, DEFAULT_WORLD_ENGINE_CONFIG.burnDurationSec),
    energyCap: value(energy.cap, DEFAULT_WORLD_ENGINE_CONFIG.energyCap),
    energyRegenSec: value(energy.regenSecPerPoint, DEFAULT_WORLD_ENGINE_CONFIG.energyRegenSec),
    monsterEnergyCost: value(energy.monsterAttackCost, DEFAULT_WORLD_ENGINE_CONFIG.monsterEnergyCost),
    beginnerShieldDurationSec: value(cityCombat.beginnerShieldDurationSec, DEFAULT_WORLD_ENGINE_CONFIG.beginnerShieldDurationSec),
    baseWallIntegrity: value(cityCombat.baseWallIntegrity, DEFAULT_WORLD_ENGINE_CONFIG.baseWallIntegrity),
    minimumWallDamageOnWin: value(cityCombat.minimumWallDamageOnWin, DEFAULT_WORLD_ENGINE_CONFIG.minimumWallDamageOnWin),
    wallDamageAtFullWinRatio: value(cityCombat.wallDamageAtFullWinRatio, DEFAULT_WORLD_ENGINE_CONFIG.wallDamageAtFullWinRatio),
  };
}

export interface MarchModifiers {
  marchSpeedBonus: number;
  gatherSpeedBonus: number;
  troopAttackBonus: number;
  troopDefenseBonus: number;
  loadBonus: number;
  marchCapacityBonus: number;
}

export interface CommanderSnapshot {
  primaryHeroId: string | null;
  secondaryHeroId: string | null;
  sourceVersion: string;
  modifiers: MarchModifiers;
  effects: Array<{ key: string; value: number; source: string }>;
}

export function emptyCommanderSnapshot(): CommanderSnapshot {
  return {
    primaryHeroId: null,
    secondaryHeroId: null,
    sourceVersion: "no-hero-system:v1",
    modifiers: {
      marchSpeedBonus: 0,
      gatherSpeedBonus: 0,
      troopAttackBonus: 0,
      troopDefenseBonus: 0,
      loadBonus: 0,
      marchCapacityBonus: 0,
    },
    effects: [],
  };
}

interface EntityBase {
  id: string;
  position: Point;
  zone: number;
  spawnedAt: number;
  revision: number;
}

export interface CityEntity extends EntityBase {
  kind: "city";
  ownerId: string;
  state: "normal" | "burning";
  townhallLevel: number;
  wallLevel: number;
  hospitalLevel: number;
  storageLevel: number;
  might: number;
  shieldUntil: number;
  hasAttacked: boolean;
  wall: { value: number; max: number; burningUntil: number; relocateAt: number };
  garrison: TroopManifest;
  resources: ResourceWallet;
  protectedFraction: number;
}

export interface ResourceEntity extends EntityBase {
  kind: "resource";
  state: "available" | "occupied" | "depleted";
  resource: ResKey;
  level: number;
  amount: number;
  capacity: number;
  occupiedByMarchId: string | null;
  respawnAt: number;
}

export interface MonsterEntity extends EntityBase {
  kind: "monster";
  state: "alive" | "engaged" | "defeated";
  level: number;
  dominantArm: TroopKey;
  power: number;
  reward: Partial<ResourceWallet>;
  engagedByMarchId: string | null;
  respawnAt: number;
}

export interface PoiEntity extends EntityBase {
  kind: "poi";
  state: "locked" | "open";
  poiType: "circle";
  name: string;
}

export type WorldEntity = CityEntity | ResourceEntity | MonsterEntity | PoiEntity;

export interface HeadlessPlayer {
  id: string;
  cityId: string;
  joinedAt: number;
  spawnIndex: number;
  troops: TroopManifest;
  wounded: number;
  dead: number;
  resources: ResourceWallet;
  energyStored: number;
  energyUpdatedAt: number;
  highestMonsterDefeated: number;
  marchSlots: number;
  marchCapacity: number;
  accountModifiers: MarchModifiers;
  reportIds: string[];
}

export type MarchAction = "scout" | "gather" | "attack_monster" | "attack_city";
export type MarchState = "outbound" | "gathering" | "returning" | "completed" | "recalled" | "failed";

export interface HeadlessMarch {
  id: string;
  playerId: string;
  action: MarchAction;
  state: MarchState;
  targetId: string;
  origin: Point;
  destination: Point;
  force: TroopManifest;
  commanderSnapshot: CommanderSnapshot;
  balanceVersion: string;
  idempotencyKey: string;
  dispatchedAt: number;
  arriveAt: number;
  workUntil: number;
  returnAt: number;
  completedAt: number;
  cargo: Partial<ResourceWallet>;
  wounded: number;
  dead: number;
  outcome: string | null;
  reportIds: string[];
}

export interface WorldReport {
  id: string;
  playerId: string;
  marchId: string;
  targetId: string;
  action: MarchAction;
  stage: "arrival" | "return";
  outcome: string;
  createdAt: number;
  payload: Record<string, unknown>;
}

export interface ScheduledWorldEvent {
  id: string;
  type: "resource_respawn" | "monster_respawn" | "city_recover" | "march_arrival" | "gather_complete" | "march_return";
  at: number;
  entityId: string;
  processedAt: number;
}

export interface WorldFeedEvent {
  id: string;
  at: number;
  type: string;
  actorId: string | null;
  targetId: string;
  payload: Record<string, unknown>;
}

export interface HeadlessWorld {
  version: 2;
  stateId: string;
  config: WorldEngineConfig;
  createdAt: number;
  phase: number;
  spawnAnchors: Point[];
  spawnCursor: number;
  players: Record<string, HeadlessPlayer>;
  entities: Record<string, WorldEntity>;
  marches: Record<string, HeadlessMarch>;
  reports: Record<string, WorldReport>;
  dispatchKeys: Record<string, string>;
  scheduledEvents: ScheduledWorldEvent[];
  feed: WorldFeedEvent[];
  nextEntitySeq: number;
  nextEventSeq: number;
  nextMarchSeq: number;
  nextReportSeq: number;
}

export interface SpawnPlayerInput {
  id: string;
  townhallLevel?: number;
  might?: number;
  troops?: Partial<TroopManifest>;
  resources?: Partial<ResourceWallet>;
  protectedFraction?: number;
  shieldDurationSec?: number;
  wallLevel?: number;
  hospitalLevel?: number;
  storageLevel?: number;
}

export interface DispatchMarchInput {
  playerId: string;
  targetId: string;
  action: MarchAction;
  force?: Partial<TroopManifest>;
  commanderSnapshot?: CommanderSnapshot;
  idempotencyKey: string;
}

export type DispatchMarchResult =
  | { ok: true; world: HeadlessWorld; march: HeadlessMarch; duplicate: boolean }
  | { ok: false; world: HeadlessWorld; error: string };

function clone<T>(value: T): T { return structuredClone(value); }

function hashText(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let value = seed || 1;
  return () => {
    value = Math.imul(value ^ (value >>> 15), 1 | value);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function worldCenter(config: WorldEngineConfig = DEFAULT_WORLD_ENGINE_CONFIG): Point {
  return { x: config.width / 2, y: config.height / 2 };
}

export function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }

export function zoneForPoint(point: Point, config: WorldEngineConfig = DEFAULT_WORLD_ENGINE_CONFIG): number {
  const center = worldCenter(config);
  const radial = distance(point, center);
  const maxRadial = Math.hypot(config.width / 2, config.height / 2);
  const inward = 1 - Math.min(1, radial / maxRadial);
  return Math.max(1, Math.min(5, 1 + Math.floor(inward * 5)));
}

function troopManifest(input?: Partial<TroopManifest>): TroopManifest {
  const manifest: TroopManifest = { army: {}, navy: {}, air: {} };
  (["army", "navy", "air"] as TroopKey[]).forEach((arm) => {
    Object.entries(input?.[arm] ?? {}).forEach(([tier, quantity]) => {
      manifest[arm][tier] = Math.max(0, Math.floor(Number(quantity) || 0));
    });
  });
  return manifest;
}

function modifiers(): MarchModifiers { return { ...emptyCommanderSnapshot().modifiers }; }

export function generateSpawnAnchors(stateId: string, config: WorldEngineConfig = DEFAULT_WORLD_ENGINE_CONFIG): Point[] {
  const random = rng(hashText(`${stateId}:spawn:v2`));
  const stepX = config.width / config.spawnGrid;
  const stepY = config.height / config.spawnGrid;
  const center = worldCenter(config);
  const candidates: Point[] = [];
  for (let row = 0; row < config.spawnGrid; row += 1) {
    for (let col = 0; col < config.spawnGrid; col += 1) {
      const point = {
        x: (col + .5) * stepX + (random() * 2 - 1) * config.spawnJitter,
        y: (row + .5) * stepY + (random() * 2 - 1) * config.spawnJitter,
      };
      if (distance(point, center) > config.circleReserveRadius + config.cityFootprint) candidates.push(point);
    }
  }
  if (candidates.length < config.maxPlayers) throw new Error("Spawn grid cannot hold configured maxPlayers outside the Circle reserve.");

  // Max-min ordering: each new player takes the candidate farthest from every prior city.
  // This makes a young State quiet without sacrificing the eventual 1,024-player capacity.
  const ordered: Point[] = [];
  const remaining = candidates.slice();
  const firstIndex = hashText(stateId) % remaining.length;
  ordered.push(remaining.splice(firstIndex, 1)[0]);
  const minDistanceSq = remaining.map((point) => {
    const dx = point.x - ordered[0].x; const dy = point.y - ordered[0].y;
    return dx * dx + dy * dy;
  });
  while (ordered.length < config.maxPlayers) {
    let bestIndex = 0;
    for (let i = 1; i < remaining.length; i += 1) if (minDistanceSq[i] > minDistanceSq[bestIndex]) bestIndex = i;
    const chosen = remaining[bestIndex];
    ordered.push(chosen);
    remaining.splice(bestIndex, 1);
    minDistanceSq.splice(bestIndex, 1);
    for (let i = 0; i < remaining.length; i += 1) {
      const dx = remaining[i].x - chosen.x; const dy = remaining[i].y - chosen.y;
      minDistanceSq[i] = Math.min(minDistanceSq[i], dx * dx + dy * dy);
    }
  }
  return ordered;
}

export function initHeadlessWorld(
  stateId: string,
  now = Date.now(),
  config: WorldEngineConfig = worldEngineConfig(),
): HeadlessWorld {
  const anchors = generateSpawnAnchors(stateId, config);
  const center = worldCenter(config);
  const circle: PoiEntity = {
    id: "poi.circle", kind: "poi", state: "locked", poiType: "circle", name: "The Circle",
    position: center, zone: 5, spawnedAt: now, revision: 1,
  };
  return {
    version: 2, stateId, config: { ...config }, createdAt: now, phase: 1,
    spawnAnchors: anchors, spawnCursor: 0, players: {}, entities: { [circle.id]: circle },
    marches: {}, reports: {}, dispatchKeys: {}, scheduledEvents: [], feed: [],
    nextEntitySeq: 1, nextEventSeq: 1, nextMarchSeq: 1, nextReportSeq: 1,
  };
}

function addFeed(world: HeadlessWorld, at: number, type: string, targetId: string, actorId: string | null, payload: Record<string, unknown> = {}): void {
  world.feed.push({ id: `feed-${world.nextEventSeq++}`, at, type, actorId, targetId, payload });
  if (world.feed.length > 5000) world.feed.splice(0, world.feed.length - 5000);
}

function spawnPlayerMutable(world: HeadlessWorld, input: SpawnPlayerInput, now: number): void {
  if (world.players[input.id]) throw new Error(`Player already exists: ${input.id}`);
  const occupied = new Set(Object.values(world.players).map((player) => player.spawnIndex));
  let spawnIndex = -1;
  for (let offset = 0; offset < world.config.maxPlayers; offset += 1) {
    const candidate = (world.spawnCursor + offset) % world.config.maxPlayers;
    if (!occupied.has(candidate)) { spawnIndex = candidate; break; }
  }
  if (spawnIndex < 0) throw new Error("State is full.");
  world.spawnCursor = (spawnIndex + 1) % world.config.maxPlayers;
  const position = world.spawnAnchors[spawnIndex];
  const cityId = `city.${input.id}`;
  const resources: ResourceWallet = {
    cash: Math.max(0, input.resources?.cash ?? 0),
    oil: Math.max(0, input.resources?.oil ?? 0),
    power: Math.max(0, input.resources?.power ?? 0),
  };
  const troops = troopManifest(input.troops);
  const city: CityEntity = {
    id: cityId, kind: "city", ownerId: input.id, state: "normal", position: { ...position },
    zone: zoneForPoint(position, world.config), spawnedAt: now, revision: 1,
    townhallLevel: Math.max(1, input.townhallLevel ?? 1),
    wallLevel: Math.max(1, input.wallLevel ?? input.townhallLevel ?? 1),
    hospitalLevel: Math.max(1, input.hospitalLevel ?? input.townhallLevel ?? 1),
    storageLevel: Math.max(1, input.storageLevel ?? input.townhallLevel ?? 1),
    might: Math.max(0, input.might ?? 0),
    shieldUntil: now + Math.max(0, input.shieldDurationSec ?? world.config.beginnerShieldDurationSec) * 1000,
    hasAttacked: false, wall: {
      value: world.config.baseWallIntegrity, max: world.config.baseWallIntegrity, burningUntil: 0, relocateAt: 0,
    },
    garrison: clone(troops), resources: clone(resources), protectedFraction: input.protectedFraction ?? .25,
  };
  world.entities[cityId] = city;
  world.players[input.id] = {
    id: input.id, cityId, joinedAt: now, spawnIndex, troops, wounded: 0, dead: 0,
    resources, energyStored: world.config.energyCap, energyUpdatedAt: now,
    highestMonsterDefeated: 0, marchSlots: world.config.marchSlots,
    marchCapacity: world.config.marchCapacity, accountModifiers: modifiers(), reportIds: [],
  };
  addFeed(world, now, "player_spawned", cityId, input.id, { spawnIndex, position });
}

export function spawnPlayers(source: HeadlessWorld, inputs: SpawnPlayerInput[], now = Date.now()): HeadlessWorld {
  const world = clone(source);
  inputs.forEach((input) => spawnPlayerMutable(world, input, now));
  return world;
}

export function spawnPlayer(source: HeadlessWorld, input: SpawnPlayerInput, now = Date.now()): HeadlessWorld {
  return spawnPlayers(source, [input], now);
}

export interface SpatialIndex {
  cellSize: number;
  cells: Record<string, string[]>;
}

function cellKey(x: number, y: number): string { return `${x}:${y}`; }

export function buildSpatialIndex(world: HeadlessWorld): SpatialIndex {
  const cellSize = world.config.spatialCellSize;
  const cells: Record<string, string[]> = {};
  Object.values(world.entities).forEach((entity) => {
    const key = cellKey(Math.floor(entity.position.x / cellSize), Math.floor(entity.position.y / cellSize));
    (cells[key] ||= []).push(entity.id);
  });
  return { cellSize, cells };
}

export function queryNearby(
  world: HeadlessWorld,
  point: Point,
  radius: number,
  kinds?: WorldEntity["kind"][],
  index = buildSpatialIndex(world),
): WorldEntity[] {
  const minX = Math.floor((point.x - radius) / index.cellSize);
  const maxX = Math.floor((point.x + radius) / index.cellSize);
  const minY = Math.floor((point.y - radius) / index.cellSize);
  const maxY = Math.floor((point.y + radius) / index.cellSize);
  const found: WorldEntity[] = [];
  for (let y = minY; y <= maxY; y += 1) for (let x = minX; x <= maxX; x += 1) {
    for (const id of index.cells[cellKey(x, y)] ?? []) {
      const entity = world.entities[id];
      if ((!kinds || kinds.includes(entity.kind)) && distance(point, entity.position) <= radius) found.push(entity);
    }
  }
  return found.sort((a, b) => distance(point, a.position) - distance(point, b.position));
}

function randomLegalPoint(world: HeadlessWorld, random: () => number, minimumCityDistance = 4): Point {
  const center = worldCenter(world.config);
  const index = buildSpatialIndex(world);
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const point = { x: 3 + random() * (world.config.width - 6), y: 3 + random() * (world.config.height - 6) };
    if (distance(point, center) <= world.config.circleReserveRadius) continue;
    const nearby = queryNearby(world, point, minimumCityDistance, undefined, index);
    if (!nearby.length) return point;
  }
  throw new Error("Could not find a legal world-object coordinate.");
}

function targetLevel(zone: number, random: () => number): number {
  return Math.max(1, Math.min(10, zone * 2 - (random() < .5 ? 1 : 0)));
}

export function populateWorld(
  source: HeadlessWorld,
  resourceCount: number,
  monsterCount: number,
  now = Date.now(),
  numbers: any = getN(),
): HeadlessWorld {
  const world = clone(source);
  const random = rng(hashText(`${world.stateId}:population:${world.nextEntitySeq}`));
  const resources: ResKey[] = ["cash", "oil", "power"];
  const arms: TroopKey[] = ["army", "navy", "air"];
  for (let i = 0; i < resourceCount; i += 1) {
    const position = randomLegalPoint(world, random);
    const zone = zoneForPoint(position, world.config);
    const level = targetLevel(zone, random);
    const capacity = Number(numbers.gatherNodes?.levels?.[String(level)]?.totalSupply)
      || 1000 * Math.pow(2, level - 1);
    const id = `resource-${world.nextEntitySeq++}`;
    world.entities[id] = {
      id, kind: "resource", state: "available", position, zone, spawnedAt: now, revision: 1,
      resource: resources[Math.floor(random() * resources.length)], level, amount: capacity, capacity,
      occupiedByMarchId: null, respawnAt: 0,
    };
  }
  for (let i = 0; i < monsterCount; i += 1) {
    const position = randomLegalPoint(world, random);
    const zone = zoneForPoint(position, world.config);
    const level = targetLevel(zone, random);
    const id = `monster-${world.nextEntitySeq++}`;
    const row = numbers.world?.monsters?.levels?.[String(level)] ?? {};
    world.entities[id] = {
      id, kind: "monster", state: "alive", position, zone, spawnedAt: now, revision: 1,
      level, dominantArm: row.dominantArm ?? arms[Math.floor(random() * arms.length)],
      power: Number(row.power) || Math.round(160 * Math.pow(1.72, level - 1)),
      reward: {
        cash: Number(row.reward?.["res.cash"]) || level * 350,
        oil: Number(row.reward?.["res.oil"]) || level * 180,
        power: Number(row.reward?.["res.power"]) || level * 180,
      },
      engagedByMarchId: null, respawnAt: 0,
    };
  }
  return world;
}

function schedule(world: HeadlessWorld, type: ScheduledWorldEvent["type"], entityId: string, at: number): void {
  world.scheduledEvents.push({ id: `scheduled-${world.nextEventSeq++}`, type, entityId, at, processedAt: 0 });
}

export function occupyResource(source: HeadlessWorld, resourceId: string, marchId: string, now = Date.now()): { world: HeadlessWorld; ok: boolean } {
  const world = clone(source);
  const entity = world.entities[resourceId];
  if (!entity || entity.kind !== "resource" || entity.state !== "available") return { world, ok: false };
  entity.state = "occupied"; entity.occupiedByMarchId = marchId; entity.revision += 1;
  addFeed(world, now, "resource_occupied", entity.id, null, { marchId });
  return { world, ok: true };
}

export function depleteResource(source: HeadlessWorld, resourceId: string, amount: number, now = Date.now()): HeadlessWorld {
  const world = clone(source);
  const entity = world.entities[resourceId];
  if (!entity || entity.kind !== "resource") return world;
  entity.amount = Math.max(0, entity.amount - Math.max(0, amount));
  entity.revision += 1;
  if (entity.amount === 0) {
    entity.state = "depleted"; entity.occupiedByMarchId = null;
    entity.respawnAt = now + world.config.resourceRespawnSec * 1000;
    schedule(world, "resource_respawn", entity.id, entity.respawnAt);
    addFeed(world, now, "resource_depleted", entity.id, null, { respawnAt: entity.respawnAt });
  }
  return world;
}

export function defeatMonster(source: HeadlessWorld, monsterId: string, actorId: string, now = Date.now()): HeadlessWorld {
  const world = clone(source);
  const entity = world.entities[monsterId];
  if (!entity || entity.kind !== "monster" || entity.state === "defeated") return world;
  entity.state = "defeated"; entity.engagedByMarchId = null; entity.revision += 1;
  entity.respawnAt = now + world.config.monsterRespawnSec * 1000;
  schedule(world, "monster_respawn", entity.id, entity.respawnAt);
  addFeed(world, now, "monster_defeated", entity.id, actorId, { level: entity.level, respawnAt: entity.respawnAt });
  return world;
}

export function breachCity(source: HeadlessWorld, cityId: string, actorId: string, wallDamage: number, now = Date.now()): HeadlessWorld {
  const world = clone(source);
  const entity = world.entities[cityId];
  if (!entity || entity.kind !== "city") return world;
  entity.wall.value = Math.max(0, entity.wall.value - Math.max(0, wallDamage));
  entity.state = "burning";
  entity.wall.burningUntil = now + world.config.burnDurationSec * 1000;
  entity.wall.relocateAt = entity.wall.value === 0 ? entity.wall.burningUntil : 0;
  entity.revision += 1;
  schedule(world, "city_recover", entity.id, entity.wall.burningUntil);
  addFeed(world, now, "city_breached", entity.id, actorId, { wall: entity.wall.value, relocateAt: entity.wall.relocateAt });
  return world;
}

function respawnTarget(world: HeadlessWorld, entity: ResourceEntity | MonsterEntity, now: number, numbers: any): void {
  const random = rng(hashText(`${world.stateId}:${entity.id}:${entity.revision}:${now}`));
  const oldPosition = entity.position;
  const position = randomLegalPoint(world, random);
  entity.position = position; entity.zone = zoneForPoint(position, world.config);
  entity.spawnedAt = now; entity.revision += 1; entity.respawnAt = 0;
  const level = targetLevel(entity.zone, random);
  entity.level = level;
  if (entity.kind === "resource") {
    entity.state = "available";
    entity.capacity = Number(numbers.gatherNodes?.levels?.[String(level)]?.totalSupply)
      || 1000 * Math.pow(2, level - 1);
    entity.amount = entity.capacity; entity.occupiedByMarchId = null;
  } else {
    const row = numbers.world?.monsters?.levels?.[String(level)] ?? {};
    entity.state = "alive";
    entity.dominantArm = row.dominantArm ?? entity.dominantArm;
    entity.power = Number(row.power) || Math.round(160 * Math.pow(1.72, level - 1));
    entity.reward = {
      cash: Number(row.reward?.["res.cash"]) || level * 350,
      oil: Number(row.reward?.["res.oil"]) || level * 180,
      power: Number(row.reward?.["res.power"]) || level * 180,
    };
    entity.engagedByMarchId = null;
  }
  addFeed(world, now, `${entity.kind}_respawned`, entity.id, null, { oldPosition, position, level });
}

function recoverCity(world: HeadlessWorld, city: CityEntity, now: number): void {
  const shouldRelocate = city.wall.value === 0 && city.wall.relocateAt > 0 && now >= city.wall.relocateAt;
  if (shouldRelocate) {
    const occupied = new Set(Object.values(world.players).map((player) => player.spawnIndex));
    const index = world.spawnAnchors.findIndex((_, candidate) => !occupied.has(candidate));
    if (index >= 0) {
      city.position = { ...world.spawnAnchors[index] };
      city.zone = zoneForPoint(city.position, world.config);
      world.players[city.ownerId].spawnIndex = index;
    }
    city.wall.value = city.wall.max;
  }
  city.state = "normal"; city.wall.burningUntil = 0; city.wall.relocateAt = 0; city.revision += 1;
  addFeed(world, now, shouldRelocate ? "city_relocated" : "city_recovered", city.id, city.ownerId, { position: city.position });
}

export function advanceTargetLifecycle(source: HeadlessWorld, now = Date.now()): HeadlessWorld {
  return advanceHeadlessWorld(source, now);
}

export function energyAt(player: HeadlessPlayer, now: number, config: WorldEngineConfig): number {
  const recovered = Math.floor(Math.max(0, now - player.energyUpdatedAt) / (config.energyRegenSec * 1000));
  return Math.min(config.energyCap, player.energyStored + recovered);
}

function troopCount(troops: TroopManifest): number {
  return TROOP_ORDER.reduce((total, arm) => total
    + Object.values(troops[arm] ?? {}).reduce((sum, amount) => sum + Math.max(0, Number(amount) || 0), 0), 0);
}

function hasTroops(available: TroopManifest, requested: TroopManifest): boolean {
  return TROOP_ORDER.every((arm) => Object.entries(requested[arm]).every(([tier, amount]) =>
    amount >= 0 && Number.isInteger(amount) && amount <= (available[arm]?.[tier] ?? 0)));
}

function changeTroops(target: TroopManifest, delta: TroopManifest, direction: 1 | -1): void {
  TROOP_ORDER.forEach((arm) => Object.entries(delta[arm]).forEach(([tier, amount]) => {
    target[arm][tier] = Math.max(0, (target[arm][tier] ?? 0) + direction * amount);
  }));
}

function removeCasualties(source: TroopManifest, requested: number): { troops: TroopManifest; removed: number } {
  const troops = troopManifest(source);
  const total = troopCount(troops);
  let remaining = Math.min(total, Math.max(0, Math.round(requested)));
  // Highest tiers take losses first. It is deterministic and conserves every troop.
  const rows = TROOP_ORDER.flatMap((arm) => Object.keys(troops[arm])
    .map(Number).sort((a, b) => b - a).map((tier) => ({ arm, tier: String(tier) })));
  rows.forEach(({ arm, tier }) => {
    const removed = Math.min(remaining, troops[arm][tier] ?? 0);
    troops[arm][tier] = (troops[arm][tier] ?? 0) - removed;
    remaining -= removed;
  });
  return { troops, removed: Math.min(total, Math.max(0, Math.round(requested))) - remaining };
}

function effectiveNumbers(player: HeadlessPlayer, commander: CommanderSnapshot, numbers: any): any {
  const output = clone(numbers);
  const account = output.global.accountModifiers ||= {};
  (Object.keys(commander.modifiers) as Array<keyof MarchModifiers>).forEach((key) => {
    account[key] = (Number(account[key]) || 0) + (Number(player.accountModifiers[key]) || 0)
      + (Number(commander.modifiers[key]) || 0);
  });
  return output;
}

function report(
  world: HeadlessWorld,
  march: HeadlessMarch,
  stage: WorldReport["stage"],
  outcome: string,
  at: number,
  payload: Record<string, unknown>,
): void {
  const id = `report-${world.nextReportSeq++}`;
  world.reports[id] = {
    id, playerId: march.playerId, marchId: march.id, targetId: march.targetId,
    action: march.action, stage, outcome, createdAt: at, payload,
  };
  march.reportIds.push(id);
  world.players[march.playerId]?.reportIds.push(id);
  addFeed(world, at, `march_${stage}`, march.targetId, march.playerId, { marchId: march.id, reportId: id, outcome });
}

function opponentReport(
  world: HeadlessWorld,
  playerId: string,
  march: HeadlessMarch,
  outcome: string,
  at: number,
  payload: Record<string, unknown>,
): void {
  const player = world.players[playerId];
  if (!player) return;
  const id = `report-${world.nextReportSeq++}`;
  world.reports[id] = {
    id, playerId, marchId: march.id, targetId: march.targetId, action: march.action,
    stage: "arrival", outcome, createdAt: at, payload,
  };
  player.reportIds.push(id);
  addFeed(world, at, "city_defense_report", march.targetId, march.playerId, { reportId: id, defenderId: playerId, outcome });
}

function scheduleReturn(world: HeadlessWorld, march: HeadlessMarch, at: number): void {
  const travelMs = Math.max(0, march.arriveAt - march.dispatchedAt);
  march.state = "returning";
  march.returnAt = at + travelMs;
  schedule(world, "march_return", march.id, march.returnAt);
}

function actionMatchesTarget(action: MarchAction, target: WorldEntity): boolean {
  if (action === "gather") return target.kind === "resource";
  if (action === "attack_monster") return target.kind === "monster";
  if (action === "attack_city") return target.kind === "city";
  return target.kind === "city" || target.kind === "monster";
}

function cityShielded(city: CityEntity, now: number, numbers: any): boolean {
  if (city.hasAttacked) return false;
  const protectedUntilLevel = Number(numbers.global?.shield?.protectedUntilKeepLevel) || 0;
  return city.townhallLevel < protectedUntilLevel || city.shieldUntil > now;
}

export function dispatchMarch(
  source: HeadlessWorld,
  input: DispatchMarchInput,
  now = Date.now(),
  numbers: any = getN(),
): DispatchMarchResult {
  const world = clone(source);
  const player = world.players[input.playerId];
  if (!player) return { ok: false, world, error: "player_not_found" };
  if (!input.idempotencyKey.trim()) return { ok: false, world, error: "idempotency_key_required" };
  const dispatchKey = `${input.playerId}:${input.idempotencyKey}`;
  const existingId = world.dispatchKeys[dispatchKey];
  if (existingId) {
    const existing = world.marches[existingId];
    if (existing && existing.targetId === input.targetId && existing.action === input.action) {
      return { ok: true, world, march: existing, duplicate: true };
    }
    return { ok: false, world, error: "idempotency_key_conflict" };
  }
  const target = world.entities[input.targetId];
  if (!target || !actionMatchesTarget(input.action, target)) return { ok: false, world, error: "invalid_target" };
  if (target.kind === "city" && target.ownerId === player.id) return { ok: false, world, error: "cannot_target_self" };
  const active = Object.values(world.marches).filter((march) => march.playerId === player.id
    && !["completed", "failed"].includes(march.state)).length;
  if (active >= player.marchSlots) return { ok: false, world, error: "march_slots_full" };

  const force = troopManifest(input.force);
  const count = troopCount(force);
  const commander = clone(input.commanderSnapshot ?? emptyCommanderSnapshot());
  const configuredCapacityBonus = Number(numbers.global?.accountModifiers?.marchCapacityBonus) || 0;
  const capacity = Math.floor(player.marchCapacity * (1 + configuredCapacityBonus + player.accountModifiers.marchCapacityBonus
    + commander.modifiers.marchCapacityBonus));
  if (input.action !== "scout" && count === 0) return { ok: false, world, error: "troops_required" };
  if (count > capacity) return { ok: false, world, error: "march_capacity_exceeded" };
  if (!hasTroops(player.troops, force)) return { ok: false, world, error: "insufficient_troops" };

  if (input.action === "attack_monster") {
    const monster = target as MonsterEntity;
    if (monster.state !== "alive") return { ok: false, world, error: "target_unavailable" };
    if (monster.level > player.highestMonsterDefeated + 1) return { ok: false, world, error: "monster_level_locked" };
    const currentEnergy = energyAt(player, now, world.config);
    if (currentEnergy < world.config.monsterEnergyCost) return { ok: false, world, error: "insufficient_energy" };
    const regenMs = world.config.energyRegenSec * 1000;
    const recovered = Math.floor(Math.max(0, now - player.energyUpdatedAt) / regenMs);
    player.energyStored = currentEnergy - world.config.monsterEnergyCost;
    // Preserve a partial regeneration tick unless Energy had already reached the cap.
    player.energyUpdatedAt = currentEnergy >= world.config.energyCap
      ? now
      : player.energyUpdatedAt + recovered * regenMs;
  }
  if (input.action === "attack_city") {
    const city = target as CityEntity;
    if (cityShielded(city, now, numbers)) return { ok: false, world, error: "target_shielded" };
  }

  changeTroops(player.troops, force, -1);
  const home = world.entities[player.cityId] as CityEntity;
  home.garrison = clone(player.troops);
  const globalModifiers = numbers.global?.accountModifiers ?? {};
  const speed = 1 + (Number(globalModifiers.marchSpeedBonus) || 0)
    + player.accountModifiers.marchSpeedBonus + commander.modifiers.marchSpeedBonus;
  const travelMs = Math.ceil(distance(home.position, target.position) * world.config.travelSecondsPerTile * 1000 / Math.max(.01, speed));
  const id = `march-${world.nextMarchSeq++}`;
  const march: HeadlessMarch = {
    id, playerId: player.id, action: input.action, state: "outbound", targetId: target.id,
    origin: { ...home.position }, destination: { ...target.position }, force,
    commanderSnapshot: commander, balanceVersion: String(numbers.meta?.version ?? "unknown"), idempotencyKey: input.idempotencyKey,
    dispatchedAt: now, arriveAt: now + travelMs, workUntil: 0, returnAt: 0, completedAt: 0,
    cargo: {}, wounded: 0, dead: 0, outcome: null, reportIds: [],
  };
  world.marches[id] = march;
  world.dispatchKeys[dispatchKey] = id;
  schedule(world, "march_arrival", id, march.arriveAt);
  if (input.action === "attack_city") {
    home.hasAttacked = true;
    home.shieldUntil = 0;
  }
  addFeed(world, now, "march_dispatched", target.id, player.id, { marchId: id, action: input.action, arriveAt: march.arriveAt });
  return { ok: true, world, march: clone(march), duplicate: false };
}

function allocateLoot(city: CityEntity, total: number): Partial<ResourceWallet> {
  const available: ResourceWallet = {
    cash: Math.floor(city.resources.cash * (1 - city.protectedFraction)),
    oil: Math.floor(city.resources.oil * (1 - city.protectedFraction)),
    power: Math.floor(city.resources.power * (1 - city.protectedFraction)),
  };
  const availableTotal = available.cash + available.oil + available.power;
  const wanted = Math.min(Math.max(0, Math.floor(total)), availableTotal);
  const loot: Partial<ResourceWallet> = {};
  let remaining = wanted;
  (["cash", "oil", "power"] as ResKey[]).forEach((resource, index) => {
    const amount = index === 2
      ? Math.min(remaining, available[resource])
      : Math.min(remaining, available[resource], Math.floor(wanted * available[resource] / Math.max(1, availableTotal)));
    loot[resource] = amount;
    city.resources[resource] -= amount;
    remaining -= amount;
  });
  return loot;
}

function arriveScout(world: HeadlessWorld, march: HeadlessMarch, target: CityEntity | MonsterEntity, at: number, numbers: any): void {
  const payload = target.kind === "city"
    ? resolveScout({
      kind: "rival", keepLevel: target.townhallLevel, wallLevel: target.wallLevel,
      hospitalLevel: target.hospitalLevel, storageLevel: target.storageLevel,
      troops: target.garrison, resources: target.resources, protectedFraction: target.protectedFraction,
      hasAttacked: target.hasAttacked,
    }, numbers)
    : resolveScout({ kind: "monster", level: target.level, power: target.power, reward: target.reward }, numbers);
  march.outcome = "scouted";
  report(world, march, "arrival", "scouted", at, { snapshot: payload, targetRevision: target.revision });
  scheduleReturn(world, march, at);
}

function arriveGather(world: HeadlessWorld, march: HeadlessMarch, target: ResourceEntity, at: number, numbers: any): void {
  if (target.state !== "available") {
    march.outcome = "target_unavailable";
    report(world, march, "arrival", march.outcome, at, { targetState: target.state });
    scheduleReturn(world, march, at);
    return;
  }
  target.state = "occupied"; target.occupiedByMarchId = march.id; target.revision += 1;
  const player = world.players[march.playerId];
  const tuned = effectiveNumbers(player, march.commanderSnapshot, numbers);
  const capacity = carryCapacity({ troops: march.force }, tuned);
  const result = resolveGather({ kind: "node", level: target.level, resource: target.resource, remaining: target.amount }, capacity, tuned);
  march.state = "gathering";
  march.workUntil = at + Math.ceil(result.tripTimeSec * 1000);
  march.outcome = "gathering";
  schedule(world, "gather_complete", march.id, march.workUntil);
  report(world, march, "arrival", "gathering_started", at, { resource: target.resource, reserved: result.hauled, completesAt: march.workUntil });
}

function arriveMonster(world: HeadlessWorld, march: HeadlessMarch, target: MonsterEntity, at: number, numbers: any): void {
  if (target.state !== "alive") {
    march.outcome = "target_unavailable";
    report(world, march, "arrival", march.outcome, at, { targetState: target.state });
    scheduleReturn(world, march, at);
    return;
  }
  target.state = "engaged"; target.engagedByMarchId = march.id; target.revision += 1;
  const player = world.players[march.playerId];
  const tuned = effectiveNumbers(player, march.commanderSnapshot, numbers);
  const pveCasualtyScaling = Number(numbers.world?.monsters?.casualtyScaling);
  const pveWoundedRatio = Number(numbers.world?.monsters?.woundedRatio);
  if (Number.isFinite(pveCasualtyScaling) && pveCasualtyScaling >= 0) tuned.global.combat.casualtyScaling = pveCasualtyScaling;
  if (Number.isFinite(pveWoundedRatio) && pveWoundedRatio >= 0) tuned.global.combat.woundedRatio = pveWoundedRatio;
  const home = world.entities[player.cityId] as CityEntity;
  const hospitalCapacity = Number(tuned.buildings?.["building.hospital"]?.levels?.[String(home.hospitalLevel)]?.woundedCapacity) || 0;
  const combat = resolveCombat({ troops: march.force }, {
    kind: "monster", level: target.level, power: target.power, reward: target.reward,
    dominantArm: target.dominantArm,
  }, tuned, hospitalCapacity);
  const casualties = combat.attackerLosses.wounded + combat.attackerLosses.dead;
  const surviving = removeCasualties(march.force, casualties);
  march.force = surviving.troops;
  march.wounded += combat.attackerLosses.wounded;
  march.dead += combat.attackerLosses.dead;
  march.outcome = combat.win ? "victory" : "defeat";
  if (combat.win) {
    target.state = "defeated"; target.engagedByMarchId = null; target.respawnAt = at + world.config.monsterRespawnSec * 1000;
    target.revision += 1;
    schedule(world, "monster_respawn", target.id, target.respawnAt);
    march.cargo = clone(target.reward);
    player.highestMonsterDefeated = Math.max(player.highestMonsterDefeated, target.level);
  } else {
    target.state = "alive"; target.engagedByMarchId = null; target.revision += 1;
  }
  report(world, march, "arrival", march.outcome, at, {
    targetLevel: target.level, ap: combat.ap, dp: combat.dp, winRatio: combat.winRatio,
    wounded: march.wounded, dead: march.dead, rewardOnReturn: march.cargo,
  });
  scheduleReturn(world, march, at);
}

function arriveCity(world: HeadlessWorld, march: HeadlessMarch, target: CityEntity, at: number, numbers: any): void {
  if (cityShielded(target, at, numbers)) {
    march.outcome = "target_shielded";
    report(world, march, "arrival", march.outcome, at, { shieldUntil: target.shieldUntil });
    scheduleReturn(world, march, at);
    return;
  }
  const attacker = world.players[march.playerId];
  const defender = world.players[target.ownerId];
  target.garrison = clone(defender?.troops ?? target.garrison);
  const tuned = effectiveNumbers(attacker, march.commanderSnapshot, numbers);
  const hospitalCapacity = Number(tuned.buildings?.["building.hospital"]?.levels?.[String((world.entities[attacker.cityId] as CityEntity).hospitalLevel)]?.woundedCapacity) || 0;
  const combat = resolveCombat({ troops: march.force }, {
    kind: "rival", keepLevel: target.townhallLevel, wallLevel: target.wallLevel,
    hospitalLevel: target.hospitalLevel, storageLevel: target.storageLevel, troops: target.garrison,
    resources: target.resources, protectedFraction: target.protectedFraction, hasAttacked: target.hasAttacked,
    troopDefenseBonus: (Number(numbers.global?.accountModifiers?.troopDefenseBonus) || 0)
      + (defender?.accountModifiers.troopDefenseBonus ?? 0),
  }, tuned, hospitalCapacity);
  const attackerCasualties = combat.attackerLosses.wounded + combat.attackerLosses.dead;
  march.force = removeCasualties(march.force, attackerCasualties).troops;
  march.wounded += combat.attackerLosses.wounded; march.dead += combat.attackerLosses.dead;
  if (defender) {
    defender.troops = removeCasualties(defender.troops, combat.defenderLosses.wounded + combat.defenderLosses.dead).troops;
    defender.wounded += combat.defenderLosses.wounded; defender.dead += combat.defenderLosses.dead;
    target.garrison = clone(defender.troops);
  }
  march.outcome = combat.win ? "victory" : "defeat";
  if (combat.win) {
    march.cargo = allocateLoot(target, combat.loot);
    if (defender) (Object.keys(march.cargo) as ResKey[]).forEach((resource) => {
      defender.resources[resource] = target.resources[resource];
    });
    const wallDamage = Math.max(world.config.minimumWallDamageOnWin,
      Math.round(world.config.wallDamageAtFullWinRatio * combat.winRatio));
    target.wall.value = Math.max(0, target.wall.value - wallDamage);
    target.state = "burning";
    target.wall.burningUntil = at + world.config.burnDurationSec * 1000;
    target.wall.relocateAt = target.wall.value === 0 ? target.wall.burningUntil : 0;
    schedule(world, "city_recover", target.id, target.wall.burningUntil);
  }
  target.revision += 1;
  report(world, march, "arrival", march.outcome, at, {
    ap: combat.ap, dp: combat.dp, winRatio: combat.winRatio,
    attackerLosses: combat.attackerLosses, defenderLosses: combat.defenderLosses,
    wallAfter: target.wall.value, lootOnReturn: march.cargo,
  });
  opponentReport(world, target.ownerId, march, combat.win ? "defeat" : "defended", at, {
    attackerId: march.playerId, attackerLosses: combat.attackerLosses,
    defenderLosses: combat.defenderLosses, wallAfter: target.wall.value,
    resourcesLost: march.cargo, balanceVersion: march.balanceVersion,
  });
  scheduleReturn(world, march, at);
}

function processArrival(world: HeadlessWorld, march: HeadlessMarch, at: number, numbers: any): void {
  if (march.state !== "outbound") return;
  const target = world.entities[march.targetId];
  if (!target) {
    march.outcome = "target_missing";
    report(world, march, "arrival", march.outcome, at, {});
    scheduleReturn(world, march, at);
    return;
  }
  if (march.action === "scout" && (target.kind === "city" || target.kind === "monster")) arriveScout(world, march, target, at, numbers);
  else if (march.action === "gather" && target.kind === "resource") arriveGather(world, march, target, at, numbers);
  else if (march.action === "attack_monster" && target.kind === "monster") arriveMonster(world, march, target, at, numbers);
  else if (march.action === "attack_city" && target.kind === "city") arriveCity(world, march, target, at, numbers);
  else {
    march.outcome = "target_changed";
    report(world, march, "arrival", march.outcome, at, {});
    scheduleReturn(world, march, at);
  }
}

function processGatherComplete(world: HeadlessWorld, march: HeadlessMarch, at: number, numbers: any): void {
  if (march.state !== "gathering") return;
  const target = world.entities[march.targetId];
  if (!target || target.kind !== "resource" || target.occupiedByMarchId !== march.id) {
    march.outcome = "gather_interrupted";
    report(world, march, "arrival", march.outcome, at, {});
    scheduleReturn(world, march, at);
    return;
  }
  const player = world.players[march.playerId];
  const tuned = effectiveNumbers(player, march.commanderSnapshot, numbers);
  const capacity = carryCapacity({ troops: march.force }, tuned);
  const hauled = Math.floor(Math.min(capacity, target.amount));
  march.cargo[target.resource] = hauled;
  target.amount -= hauled;
  target.occupiedByMarchId = null;
  target.revision += 1;
  if (target.amount <= 0) {
    target.amount = 0; target.state = "depleted";
    target.respawnAt = at + world.config.resourceRespawnSec * 1000;
    schedule(world, "resource_respawn", target.id, target.respawnAt);
  } else target.state = "available";
  march.outcome = "gathered";
  report(world, march, "arrival", "gathering_completed", at, { resource: target.resource, hauled, remaining: target.amount });
  scheduleReturn(world, march, at);
}

function processReturn(world: HeadlessWorld, march: HeadlessMarch, at: number): void {
  if (march.state !== "returning") return;
  const player = world.players[march.playerId];
  if (!player) { march.state = "failed"; march.completedAt = at; return; }
  changeTroops(player.troops, march.force, 1);
  player.wounded += march.wounded;
  player.dead += march.dead;
  (Object.keys(march.cargo) as ResKey[]).forEach((resource) => {
    player.resources[resource] += march.cargo[resource] ?? 0;
  });
  const home = world.entities[player.cityId];
  if (home?.kind === "city") {
    home.garrison = clone(player.troops);
    home.resources = clone(player.resources);
  }
  march.state = "completed"; march.completedAt = at;
  report(world, march, "return", march.outcome === "recalled" ? "recalled" : "delivered", at, {
    cargo: march.cargo, survivingTroops: troopCount(march.force), wounded: march.wounded, dead: march.dead,
  });
}

export function recallMarch(source: HeadlessWorld, marchId: string, playerId: string, now = Date.now()): HeadlessWorld {
  const world = clone(source);
  const march = world.marches[marchId];
  if (!march || march.playerId !== playerId || !["outbound", "gathering"].includes(march.state)) return world;
  const target = world.entities[march.targetId];
  if (target?.kind === "resource" && target.occupiedByMarchId === march.id) {
    target.state = "available"; target.occupiedByMarchId = null; target.revision += 1;
  }
  const fullTravel = Math.max(0, march.arriveAt - march.dispatchedAt);
  const elapsed = Math.max(0, Math.min(fullTravel, now - march.dispatchedAt));
  march.state = "returning"; march.outcome = "recalled"; march.returnAt = now + elapsed;
  schedule(world, "march_return", march.id, march.returnAt);
  addFeed(world, now, "march_recalled", march.targetId, playerId, { marchId, returnAt: march.returnAt });
  return world;
}

export function advanceHeadlessWorld(source: HeadlessWorld, now = Date.now(), numbers: any = getN()): HeadlessWorld {
  const world = clone(source);
  // Batch-sort due events. Repeat only when a handler creates another already-due event,
  // so a 10k-event catch-up is O(n log n), not 10k repeated full-array scans.
  for (;;) {
    const due = world.scheduledEvents
      .filter((item) => !item.processedAt && item.at <= now)
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    if (!due.length) break;
    due.forEach((event) => {
      const entity = world.entities[event.entityId];
      const march = world.marches[event.entityId];
      if (event.type === "resource_respawn" && entity?.kind === "resource" && entity.state === "depleted" && event.at >= entity.respawnAt) respawnTarget(world, entity, event.at, numbers);
      else if (event.type === "monster_respawn" && entity?.kind === "monster" && entity.state === "defeated" && event.at >= entity.respawnAt) respawnTarget(world, entity, event.at, numbers);
      else if (event.type === "city_recover" && entity?.kind === "city" && entity.state === "burning" && event.at >= entity.wall.burningUntil) recoverCity(world, entity, event.at);
      else if (event.type === "march_arrival" && march) processArrival(world, march, event.at, numbers);
      else if (event.type === "gather_complete" && march) processGatherComplete(world, march, event.at, numbers);
      else if (event.type === "march_return" && march) processReturn(world, march, event.at);
      event.processedAt = now || 1;
    });
  }
  world.scheduledEvents = world.scheduledEvents.filter((event) => !event.processedAt);
  return world;
}
