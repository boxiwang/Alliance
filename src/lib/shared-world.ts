// One engine world shared by every real player (docs/SHARED-ECOLOGY.md, P0-1).
// Pure: no DOM, storage or network — the WorldRoom Durable Object owns the instance,
// persists it and wakes it with alarms. Economy (game_json) stays in D1; each player's
// world record is reconciled with their projected game through the existing
// world-authority delta rule, using a per-player `synced` snapshot.
import type { GameState } from "./game";
import { might, project } from "./game";
import {
  applyWorldAuthorityCommand, snapshotAuthorityGame,
  type WorldAuthorityCommand, type WorldAuthoritySession, type WorldAuthoritySnapshot,
} from "./world-authority";
import {
  advanceHeadlessWorld, distance, initHeadlessWorld, mutateInPlace, populateWorld, settlePlayerMarches, spawnPlayer, worldEngineConfig, worldPlayableRadius, zoneForPoint,
  type CityEntity, type HeadlessMarch, type HeadlessPlayer, type HeadlessWorld, type Point, type PublicCosmeticLoadout, type WorldEntity,
} from "./world-engine";

export const SHARED_STATE_ID = "frontier-1";

export interface SharedWorldState {
  version: 1;
  world: HeadlessWorld;
  synced: Record<string, WorldAuthoritySnapshot>;
}

/** Progress a player keeps when their private world is retired. */
export interface SharedCarryOver {
  highestMonsterDefeated?: number;
  deepScanCooldowns?: Record<string, number>;
  energyStored?: number;
  energyUpdatedAt?: number;
  cosmetics?: Partial<PublicCosmeticLoadout>;
}

export type SharedCommandResult = {
  state: SharedWorldState;
  game: GameState;
  ok: boolean;
  reason?: string;
  targetId?: string | null;
  spawned?: boolean;
  position?: Point;
};

/** Playable area of the open quadrants (the Wormhole reserve excluded), in tiles. */
export function openArea(world: HeadlessWorld): number {
  const outer = worldPlayableRadius(world.config), inner = world.config.circleReserveRadius;
  const open = world.config.openQuadrants?.length ?? 4;
  return Math.PI * (outer * outer - inner * inner) * open / 4;
}

function population(world: HeadlessWorld, numbers: any): { resources: number; monsters: number } {
  const pop = numbers.world?.population ?? {};
  // Map 2048: the ecology fills the open territory by area (docs/MAP-2048.md), so every
  // alliance's land has resource points regardless of how many players arrived yet.
  const perResource = Number(pop.resourceTilesPer), perMonster = Number(pop.monsterTilesPer);
  if (perResource > 0 && perMonster > 0) {
    const area = openArea(world);
    return { resources: Math.floor(area / perResource), monsters: Math.floor(area / perMonster) };
  }
  const players = Object.keys(world.players).length;
  const resources = Math.min(Math.floor(Number(pop.resourceCap) || Infinity),
    Math.ceil(Math.max(Number(pop.minimumResourceFields) || 0, players * (Number(pop.resourceFieldsPerPlayer) || 0))));
  const monsters = Math.min(Math.floor(Number(pop.monsterCap) || Infinity),
    Math.ceil(Math.max(Number(pop.minimumMonsters) || 0, players * (Number(pop.monstersPerPlayer) || 0))));
  return { resources, monsters };
}

/** Top the public ecology up to the population the current player count calls for. */
export function topUpEcology(world: HeadlessWorld, now: number, numbers: any): HeadlessWorld {
  const want = population(world, numbers);
  const entities = Object.values(world.entities);
  const resources = entities.filter((entity) => entity.kind === "resource").length;
  const monsters = entities.filter((entity) => entity.kind === "monster").length;
  const addResources = Math.max(0, want.resources - resources), addMonsters = Math.max(0, want.monsters - monsters);
  return addResources || addMonsters ? populateWorld(world, addResources, addMonsters, now, numbers) : world;
}

/** Quadrant opening order: NW, NE, SE, SW (clockwise). */
export const QUADRANT_ORDER = [0, 1, 3, 2];

export function sharedWorldConfig(numbers: any, openQuadrants: number[] = [QUADRANT_ORDER[0]]) {
  return { ...worldEngineConfig(numbers), openQuadrants: [...openQuadrants] };
}

export function createSharedWorld(now: number, numbers: any): SharedWorldState {
  const world = mutateInPlace(() => topUpEcology(initHeadlessWorld(SHARED_STATE_ID, now, sharedWorldConfig(numbers)), now, numbers));
  return { version: 1, world, synced: {} };
}

export function openQuadrants(state: SharedWorldState): number[] {
  return state.world.config.openQuadrants ? [...state.world.config.openQuadrants] : [0, 1, 2, 3];
}

/** Opens a quadrant for settlement and fills its ecology. */
export function openSharedQuadrant(state: SharedWorldState, quadrant: number, now: number, numbers: any): SharedWorldState {
  const open = openQuadrants(state);
  if (open.includes(quadrant)) return state;
  state.world.config = { ...state.world.config, openQuadrants: [...open, quadrant] };
  return { ...state, world: mutateInPlace(() => topUpEcology(state.world, now, numbers)) };
}

/**
 * One-time move to a new map size (docs/MAP-2048.md): every fleet is brought home, all
 * public targets are regenerated, and each player keeps troops, resources, wounded, energy
 * and progress at the new home the WorldRoom assigned (`homes`). Economy snapshots carry over.
 */
export function rebuildSharedWorld(old: SharedWorldState, homes: Record<string, Point>, now: number, numbers: any): SharedWorldState {
  const quadrants = new Set<number>();
  const config = sharedWorldConfig(numbers);
  const center = { x: config.width / 2, y: config.height / 2 };
  for (const home of Object.values(homes)) quadrants.add((home.y < center.y ? 0 : 2) + (home.x < center.x ? 0 : 1));
  const opened = QUADRANT_ORDER.filter((quadrant) => quadrant === QUADRANT_ORDER[0] || quadrants.has(quadrant));
  return mutateInPlace(() => {
    let settled = old.world;
    for (const playerId of Object.keys(old.world.players)) settled = settlePlayerMarches(settled, playerId, now, numbers);
    let world = initHeadlessWorld(SHARED_STATE_ID, now, sharedWorldConfig(numbers, opened));
    const synced: Record<string, WorldAuthoritySnapshot> = {};
    for (const [playerId, previous] of Object.entries(settled.players)) {
      const home = homes[playerId];
      if (!home || !old.synced[playerId]) continue;
      world = spawnPlayer(world, { id: playerId, allianceId: null }, now);
      const player = world.players[playerId];
      const city = world.entities[player.cityId] as CityEntity;
      const previousCity = settled.entities[previous.cityId];
      Object.assign(player, {
        troops: previous.troops, woundedTroops: previous.woundedTroops, wounded: previous.wounded, dead: previous.dead,
        resources: previous.resources, energyStored: previous.energyStored, energyUpdatedAt: previous.energyUpdatedAt,
        highestMonsterDefeated: previous.highestMonsterDefeated, deepScanCooldowns: previous.deepScanCooldowns,
        marchSlots: previous.marchSlots, marchCapacity: previous.marchCapacity, accountModifiers: previous.accountModifiers,
        cosmetics: previous.cosmetics, reportIds: [], deepScanTargetIds: {},
      });
      if (previousCity?.kind === "city") {
        Object.assign(city, {
          townhallLevel: previousCity.townhallLevel, wallLevel: previousCity.wallLevel, hospitalLevel: previousCity.hospitalLevel,
          storageLevel: previousCity.storageLevel, might: previousCity.might, garrison: previousCity.garrison, resources: previousCity.resources,
          shieldUntil: previousCity.shieldUntil, hasAttacked: previousCity.hasAttacked,
        });
      }
      city.position = { ...home };
      city.zone = zoneForPoint(home, world.config);
      synced[playerId] = old.synced[playerId];
    }
    world = topUpEcology(world, now, numbers);
    return { version: 1 as const, world, synced };
  });
}

export function sharedHasPlayer(state: SharedWorldState, playerId: string): boolean {
  return !!state.world.players[playerId] && !!state.synced[playerId];
}

function sessionFor(state: SharedWorldState, playerId: string): WorldAuthoritySession {
  return { version: 1, address: playerId, playerId, world: state.world, syncedGame: state.synced[playerId], createdAt: 0, migratedLegacyAt: 0 };
}

/**
 * Adds a player to the shared world at their shared coordinate. `game` must already be
 * settled (no troops/cargo away in a retired private world).
 */
export function joinSharedWorld(source: SharedWorldState, input: {
  playerId: string; coord: Point; game: GameState; carry?: SharedCarryOver; now: number; numbers: any;
}): SharedWorldState {
  if (sharedHasPlayer(source, input.playerId)) return source;
  return mutateInPlace(() => joinInPlace(source, input));
}

function joinInPlace(source: SharedWorldState, input: {
  playerId: string; coord: Point; game: GameState; carry?: SharedCarryOver; now: number; numbers: any;
}): SharedWorldState {
  const game = project(input.game, input.now);
  let world = spawnPlayer(source.world, {
    id: input.playerId, allianceId: null, // alliances are not live; contest truce waits for them
    cosmetics: input.carry?.cosmetics,
    townhallLevel: game.buildings.keep.lvl,
    wallLevel: Math.max(1, game.buildings.wall.lvl),
    hospitalLevel: Math.max(1, game.buildings.hospital.lvl),
    storageLevel: Math.max(1, game.buildings.storage.lvl),
    might: might(game), troops: game.troops, woundedTroops: game.woundedTroops, resources: game.res,
    shieldDurationSec: 0,
  }, input.now);
  const player = world.players[input.playerId];
  const city = world.entities[player.cityId] as CityEntity;
  city.position = { ...input.coord };
  city.zone = zoneForPoint(input.coord, world.config);
  const carry = input.carry ?? {};
  player.highestMonsterDefeated = Math.max(0, Math.floor(Number(carry.highestMonsterDefeated) || 0));
  player.deepScanCooldowns = { ...(carry.deepScanCooldowns ?? {}) };
  if (Number.isFinite(carry.energyStored) && Number.isFinite(carry.energyUpdatedAt)) {
    player.energyStored = Number(carry.energyStored); player.energyUpdatedAt = Number(carry.energyUpdatedAt);
  }
  world = topUpEcology(world, input.now, input.numbers);
  return { version: 1, world, synced: { ...source.synced, [input.playerId]: snapshotAuthorityGame(game) } };
}

/** Everything a retired private world hands over: settled game + carried progress. */
export function retirePrivateWorld(session: WorldAuthoritySession, game: GameState, now: number, numbers: any): { game: GameState; carry: SharedCarryOver } {
  const synced = applyWorldAuthorityCommand(session, game, { type: "world.advance", args: {} }, now, numbers);
  const settled = { ...synced.session, world: settlePlayerMarches(synced.session.world, synced.session.playerId, now, numbers) };
  const final = applyWorldAuthorityCommand(settled, synced.game, { type: "world.advance", args: {} }, now, numbers);
  const player = final.session.world.players[final.session.playerId];
  return {
    game: final.game,
    carry: {
      highestMonsterDefeated: player.highestMonsterDefeated,
      deepScanCooldowns: player.deepScanCooldowns,
      energyStored: player.energyStored,
      energyUpdatedAt: player.energyUpdatedAt,
      cosmetics: player.cosmetics,
    },
  };
}

/** Runs one world command (or a plain sync with `world.advance`) for a player. */
export function applySharedCommand(state: SharedWorldState, playerId: string, game: GameState, command: WorldAuthorityCommand, now: number, numbers: any): SharedCommandResult {
  if (!sharedHasPlayer(state, playerId)) return { state, game, ok: false, reason: "not_in_shared_world" };
  // In place: the shared world is large; a failed D1 write reloads the last committed copy.
  const result = mutateInPlace(() => applyWorldAuthorityCommand(sessionFor(state, playerId), game, command, now, numbers));
  const next: SharedWorldState = { version: 1, world: result.session.world, synced: { ...state.synced, [playerId]: result.session.syncedGame } };
  return { state: next, game: result.game, ok: result.ok, reason: result.reason, targetId: result.targetId, spawned: result.spawned, position: result.position };
}

/** Alarm tick: resolve every due arrival, gather, return and respawn. */
export function advanceSharedWorld(state: SharedWorldState, now: number, numbers: any): SharedWorldState {
  return { ...state, world: mutateInPlace(() => advanceHeadlessWorld(state.world, now, numbers)) };
}

export function nextSharedEventAt(state: SharedWorldState): number | null {
  let next = Infinity;
  for (const event of state.world.scheduledEvents) if (!event.processedAt && event.at < next) next = event.at;
  return Number.isFinite(next) ? next : null;
}

/** Moves a player's city (spawn, warp or dormant respawn decided by the WorldRoom). */
export function setSharedHome(state: SharedWorldState, playerId: string, coord: Point): SharedWorldState {
  const player = state.world.players[playerId];
  const city = player ? state.world.entities[player.cityId] : undefined;
  if (!city || city.kind !== "city" || (city.position.x === coord.x && city.position.y === coord.y)) return state;
  city.position = { ...coord };
  city.zone = zoneForPoint(coord, state.world.config);
  city.revision += 1;
  return { ...state };
}

// ---- Reads (never expose other players' homes, troops or resources) ----

export type ViewRect = { x0: number; y0: number; x1: number; y1: number };
const inRect = (rect: ViewRect, point: Point) => point.x >= rect.x0 && point.x <= rect.x1 && point.y >= rect.y0 && point.y <= rect.y1;

export type SharedView = {
  rect: ViewRect;
  /** Resource planets and Rogues inside the rect. */
  targets: WorldEntity[];
  /** Occupying fleet → owner, so the map can colour occupation without march paths. */
  occupiers: Record<string, string>;
};

export function sharedView(state: SharedWorldState, rect: ViewRect, limit = 1500): SharedView {
  const targets: WorldEntity[] = [];
  const occupiers: Record<string, string> = {};
  for (const entity of Object.values(state.world.entities)) {
    if ((entity.kind !== "resource" && entity.kind !== "monster") || !inRect(rect, entity.position)) continue;
    targets.push(entity);
    const marchId = entity.kind === "resource" ? entity.occupiedByMarchId : entity.engagedByMarchId;
    const owner = marchId ? state.world.marches[marchId]?.playerId : undefined;
    if (marchId && owner) occupiers[marchId] = owner;
    if (targets.length >= limit) break;
  }
  return { rect, targets, occupiers };
}

/**
 * The player's own slice of the shared world, shaped like a HeadlessWorld so the
 * client renders it with the existing code: own player + city, own marches and the
 * targets they reference, own reports. Other players' records are not included.
 */
export function playerSlice(state: SharedWorldState, playerId: string): HeadlessWorld | null {
  const world = state.world;
  const player = world.players[playerId];
  if (!player) return null;
  const marches: Record<string, HeadlessMarch> = {};
  const entities: Record<string, WorldEntity> = {};
  const home = world.entities[player.cityId];
  if (home) entities[home.id] = home;
  // Rogues this player's Deep Scan charted (public, but the client needs them to focus).
  for (const targetId of Object.values(player.deepScanTargetIds ?? {})) {
    const target = world.entities[targetId];
    if (target && target.kind === "monster") entities[target.id] = target;
  }
  for (const march of Object.values(world.marches)) {
    if (march.playerId !== playerId) continue;
    marches[march.id] = march;
    const target = world.entities[march.targetId];
    if (target && target.kind !== "city") entities[target.id] = target;
  }
  const reports = Object.fromEntries(player.reportIds.map((id) => [id, world.reports[id]]).filter(([, report]) => !!report));
  const players: Record<string, HeadlessPlayer> = { [playerId]: player };
  return {
    ...world,
    players, entities, marches, reports,
    dispatchKeys: Object.fromEntries(Object.entries(world.dispatchKeys).filter(([, marchId]) => marches[marchId])),
    scheduledEvents: world.scheduledEvents.filter((event) => marches[event.entityId] || entities[event.entityId]),
    feed: [],
  };
}

export type SearchKind = "monster" | "cash" | "oil" | "power";

/** Nearest free target of a kind/level from the player's home; `index` walks outward. */
export function searchShared(state: SharedWorldState, playerId: string, kind: SearchKind, level: number, index = 0): { target: WorldEntity | null; total: number } {
  const player = state.world.players[playerId];
  const home = player ? state.world.entities[player.cityId] : undefined;
  if (!home) return { target: null, total: 0 };
  const matches = Object.values(state.world.entities).filter((entity) => kind === "monster"
    ? entity.kind === "monster" && entity.state === "alive" && entity.level === level
    : entity.kind === "resource" && entity.resource === kind && entity.state === "available" && entity.level === level)
    .sort((a, b) => distance(a.position, home.position) - distance(b.position, home.position));
  if (!matches.length) return { target: null, total: 0 };
  return { target: matches[((index % matches.length) + matches.length) % matches.length], total: matches.length };
}

export type SharedCluster = { id: string; kind: "resource" | "monster"; position: Point; count: number };

/** Strategic-zoom aggregate of live public targets (no player data), same shape as the Star Map clusters. */
export function sharedClusters(state: SharedWorldState, cellSize = 72 * state.world.config.width / 512): SharedCluster[] {
  const buckets = new Map<string, { kind: "resource" | "monster"; x: number; y: number; count: number }>();
  for (const entity of Object.values(state.world.entities)) {
    if (entity.kind === "resource" ? entity.state !== "available" && entity.state !== "occupied" : entity.kind !== "monster" || entity.state !== "alive") continue;
    const id = `${entity.kind}:${Math.floor(entity.position.x / cellSize)}:${Math.floor(entity.position.y / cellSize)}`;
    const bucket = buckets.get(id) || { kind: entity.kind as "resource" | "monster", x: 0, y: 0, count: 0 };
    bucket.x += entity.position.x; bucket.y += entity.position.y; bucket.count += 1; buckets.set(id, bucket);
  }
  return Array.from(buckets, ([id, bucket]) => ({ id, kind: bucket.kind, position: { x: bucket.x / bucket.count, y: bucket.y / bucket.count }, count: bucket.count }));
}
