// Browser-local bridge between the existing city GameState and the headless World authority.
// Temporary by design: a server adapter can replace persistence without changing World.tsx actions.
import type { GameState, TroopKey } from "./game";
import {
  RES_ORDER, TROOP_ORDER, capacity, maxTroops, might, project,
} from "./game";
import type { DispatchMarchInput, HeadlessWorld, ResourceWallet, SpawnPlayerInput, TroopManifest } from "./world-engine";
import {
  advanceHeadlessWorld, dispatchMarch, initHeadlessWorld, populateWorld, spawnPlayers,
  worldEngineConfig, zoneForPoint,
} from "./world-engine";
import { clearWorld as clearLegacyWorld, loadWorld as loadLegacyWorld, projectWorld as projectLegacyWorld } from "./world";

export interface WorldGameSnapshot {
  troops: TroopManifest;
  resources: ResourceWallet;
  wounded: number;
}

export interface LocalWorldSession {
  version: 1;
  address: string;
  playerId: string;
  world: HeadlessWorld;
  syncedGame: WorldGameSnapshot;
  createdAt: number;
  migratedLegacyAt: number;
}

export interface LocalWorldResult {
  session: LocalWorldSession;
  game: GameState;
  changed: boolean;
  error?: string;
}

const KEY = (address: string) => `ruglands:world-engine:${address.toLowerCase()}`;

function clone<T>(value: T): T { return structuredClone(value); }

function manifest(source: GameState["troops"]): TroopManifest {
  const troops: TroopManifest = { army: {}, navy: {}, air: {} };
  TROOP_ORDER.forEach((arm) => {
    for (let tier = 1; tier <= 10; tier += 1) troops[arm][String(tier)] = Math.max(0, Math.floor(source[arm]?.[String(tier)] ?? 0));
  });
  return troops;
}

export function snapshotWorldGame(game: GameState): WorldGameSnapshot {
  return {
    troops: manifest(game.troops),
    resources: { cash: game.res.cash, oil: game.res.oil, power: game.res.power },
    wounded: Math.max(0, game.wounded),
  };
}

function troopTierAt(numbers: any, townhall: number): number {
  let tier = 1;
  for (let candidate = 1; candidate <= 10; candidate += 1) {
    const unlock = Number(numbers.troops?.["troop.army"]?.tiers?.[String(candidate)]?.unlockAtTrainingBuilding) || Number.POSITIVE_INFINITY;
    if (unlock <= townhall) tier = candidate;
  }
  return tier;
}

function npcInput(index: number, world: HeadlessWorld, numbers: any): SpawnPlayerInput {
  const position = world.spawnAnchors[index];
  const zone = zoneForPoint(position, world.config);
  const monsterLevel = Math.max(1, Math.min(10, zone * 2 - 1));
  const townhall = Number(numbers.world?.monsters?.levels?.[String(monsterLevel)]?.expectedTownhall) || monsterLevel;
  const tier = troopTierAt(numbers, townhall);
  const fill = Number(numbers.world?.balanceTargets?.referenceArmyFill) || .6;
  const troops = { army: {}, navy: {}, air: {} } as TroopManifest;
  const buildingFor: Record<TroopKey, string> = {
    army: "building.armyCamp", navy: "building.navalBase", air: "building.airfield",
  };
  TROOP_ORDER.forEach((arm) => {
    const armCapacity = Number(numbers.buildings?.[buildingFor[arm]]?.levels?.[String(townhall)]?.troopCapacity) || 0;
    troops[arm][String(tier)] = Math.max(1, Math.floor(armCapacity * fill));
  });
  const storage = Number(numbers.buildings?.["building.storage"]?.levels?.[String(townhall)]?.capacityPerResource) || 5000;
  return {
    id: `npc.${String(index).padStart(4, "0")}`,
    townhallLevel: townhall,
    wallLevel: townhall,
    hospitalLevel: townhall,
    storageLevel: townhall,
    might: Math.round(TROOP_ORDER.reduce((sum, arm) => sum + (troops[arm][String(tier)] || 0), 0)
      * (Number(numbers.troops?.["troop.army"]?.tiers?.[String(tier)]?.power) || 1)),
    troops,
    resources: { cash: storage * .6, oil: storage * .45, power: storage * .45 },
    protectedFraction: Number(numbers.buildings?.["building.storage"]?.protectedFraction) || .25,
    shieldDurationSec: 0,
    hasAttacked: true,
  };
}

export function createLocalWorldSession(address: string, sourceGame: GameState, now = Date.now(), numbers: any): LocalWorldResult {
  const game = project(sourceGame, now);
  const playerId = address.toLowerCase();
  let world = initHeadlessWorld(`local:${playerId}`, now, worldEngineConfig(numbers));
  world = spawnPlayers(world, [{
    id: playerId,
    townhallLevel: game.buildings.keep.lvl,
    wallLevel: Math.max(1, game.buildings.wall.lvl),
    hospitalLevel: Math.max(1, game.buildings.hospital.lvl),
    storageLevel: Math.max(1, game.buildings.storage.lvl),
    might: might(game), troops: game.troops, resources: game.res,
    protectedFraction: Number(numbers.buildings?.["building.storage"]?.protectedFraction) || .25,
  }], now);
  const configuredNpcCount = Number(numbers.world?.population?.localNpcCities);
  const npcCount = Math.max(0, Math.min(world.config.maxPlayers - 1,
    Math.floor(Number.isFinite(configuredNpcCount) ? configuredNpcCount : 47)));
  const npcs = Array.from({ length: npcCount }, (_, offset) => npcInput(offset + 1, world, numbers));
  world = spawnPlayers(world, npcs, now);
  const playerCount = Object.keys(world.players).length;
  const population = numbers.world?.population ?? {};
  const resources = Math.ceil(Math.max(Number(population.minimumResourceFields) || 0,
    playerCount * (Number(population.resourceFieldsPerPlayer) || 0)));
  const monsters = Math.ceil(Math.max(Number(population.minimumMonsters) || 0,
    playerCount * (Number(population.monstersPerPlayer) || 0)));
  world = populateWorld(world, resources, monsters, now, numbers);
  const player = world.players[playerId];
  player.marchCapacity = Math.max(0, Math.floor(maxTroops(game)
    * (Number(numbers.global?.march?.capacityFractionOfMaxTroops) || 1)));
  const session: LocalWorldSession = {
    version: 1, address, playerId, world, syncedGame: snapshotWorldGame(game), createdAt: now, migratedLegacyAt: 0,
  };
  return { session, game, changed: true };
}

function applyExternalGameDelta(session: LocalWorldSession, game: GameState): void {
  const player = session.world.players[session.playerId];
  if (!player) throw new Error("Local World player is missing.");
  const current = snapshotWorldGame(game);
  TROOP_ORDER.forEach((arm) => {
    for (let tier = 1; tier <= 10; tier += 1) {
      const key = String(tier);
      const delta = current.troops[arm][key] - (session.syncedGame.troops[arm][key] ?? 0);
      player.troops[arm][key] = Math.max(0, (player.troops[arm][key] ?? 0) + delta);
    }
  });
  RES_ORDER.forEach((resource) => {
    const delta = current.resources[resource] - session.syncedGame.resources[resource];
    player.resources[resource] = Math.max(0, player.resources[resource] + delta);
  });
  player.wounded = Math.max(0, player.wounded + current.wounded - session.syncedGame.wounded);
}

function updatePlayerMetadata(session: LocalWorldSession, game: GameState, numbers: any): void {
  const player = session.world.players[session.playerId];
  const city = session.world.entities[player.cityId];
  if (city.kind !== "city") throw new Error("Local World city is missing.");
  city.townhallLevel = game.buildings.keep.lvl;
  city.wallLevel = Math.max(1, game.buildings.wall.lvl);
  city.hospitalLevel = Math.max(1, game.buildings.hospital.lvl);
  city.storageLevel = Math.max(1, game.buildings.storage.lvl);
  city.might = might(game);
  city.garrison = clone(player.troops);
  city.resources = clone(player.resources);
  player.marchSlots = Math.max(1, Math.floor(Number(numbers.global?.march?.marchQueueSlots) || 1));
  player.marchCapacity = Math.max(0, Math.floor(maxTroops(game)
    * (Number(numbers.global?.march?.capacityFractionOfMaxTroops) || 1)));
}

export function applyWorldPlayerToGame(session: LocalWorldSession, sourceGame: GameState): GameState {
  const game = clone(sourceGame);
  const player = session.world.players[session.playerId];
  game.troops = manifest(player.troops);
  const cap = capacity(game);
  RES_ORDER.forEach((resource) => { game.res[resource] = Math.min(cap, Math.max(0, Math.floor(player.resources[resource]))); });
  game.wounded = Math.max(0, Math.floor(player.wounded));
  return game;
}

function reconcile(session: LocalWorldSession, sourceGame: GameState, now: number, numbers: any): LocalWorldResult {
  let game = project(sourceGame, now);
  const before = JSON.stringify(session.world);
  session.world = advanceHeadlessWorld(session.world, now, numbers);
  applyExternalGameDelta(session, game);
  game = applyWorldPlayerToGame(session, game);
  updatePlayerMetadata(session, game, numbers);
  session.syncedGame = snapshotWorldGame(game);
  return { session, game, changed: before !== JSON.stringify(session.world) };
}

export function dispatchLocalWorldMarch(
  sourceSession: LocalWorldSession,
  sourceGame: GameState,
  input: Omit<DispatchMarchInput, "playerId">,
  now = Date.now(),
  numbers: any,
): LocalWorldResult {
  const prepared = reconcile(clone(sourceSession), sourceGame, now, numbers);
  const result = dispatchMarch(prepared.session.world, { ...input, playerId: prepared.session.playerId }, now, numbers);
  if (!result.ok) return { ...prepared, error: "error" in result ? result.error : "dispatch_failed" };
  prepared.session.world = result.world;
  prepared.game = applyWorldPlayerToGame(prepared.session, prepared.game);
  updatePlayerMetadata(prepared.session, prepared.game, numbers);
  prepared.session.syncedGame = snapshotWorldGame(prepared.game);
  return { ...prepared, changed: true };
}

export function advanceLocalWorldSession(
  sourceSession: LocalWorldSession,
  sourceGame: GameState,
  now = Date.now(),
  numbers: any,
): LocalWorldResult {
  return reconcile(clone(sourceSession), sourceGame, now, numbers);
}

export function finishLocalWorldMarches(
  sourceSession: LocalWorldSession,
  sourceGame: GameState,
  now = Date.now(),
  numbers: any,
): LocalWorldResult {
  const session = clone(sourceSession);
  for (let pass = 0; pass < 3; pass += 1) {
    Object.values(session.world.marches).forEach((march) => {
      if (march.state === "outbound") { march.dispatchedAt = now; march.arriveAt = now; }
      if (march.state === "gathering") march.workUntil = now;
      if (march.state === "returning") march.returnAt = now;
    });
    session.world.scheduledEvents.forEach((event) => {
      if (["march_arrival", "gather_complete", "march_return"].includes(event.type)) event.at = now;
    });
    session.world = advanceHeadlessWorld(session.world, now, numbers);
  }
  let game = applyWorldPlayerToGame(session, project(sourceGame, now));
  updatePlayerMetadata(session, game, numbers);
  session.syncedGame = snapshotWorldGame(game);
  return { session, game, changed: true };
}

export function loadLocalWorldSession(address: string): LocalWorldSession | null {
  try {
    const raw = localStorage.getItem(KEY(address));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.version === 1 && parsed?.world?.version === 2 ? parsed as LocalWorldSession : null;
  } catch { return null; }
}

export function saveLocalWorldSession(session: LocalWorldSession): void {
  try { localStorage.setItem(KEY(session.address), JSON.stringify(session)); } catch {}
}

function settleLegacyWorld(address: string, sourceGame: GameState, now: number): { game: GameState; migrated: boolean } {
  const legacy = loadLegacyWorld(address);
  if (!legacy) return { game: sourceGame, migrated: false };
  const forced = clone(legacy);
  forced.marches.forEach((march) => { if (!march.resolved) march.returnAt = now; });
  const settled = projectLegacyWorld(forced, sourceGame, now);
  clearLegacyWorld(address);
  return { game: settled.game, migrated: true };
}

export function openLocalWorldSession(address: string, sourceGame: GameState, now = Date.now(), numbers: any): LocalWorldResult {
  const stored = loadLocalWorldSession(address);
  if (stored) return reconcile(stored, sourceGame, now, numbers);
  const legacy = settleLegacyWorld(address, project(sourceGame, now), now);
  const created = createLocalWorldSession(address, legacy.game, now, numbers);
  if (legacy.migrated) created.session.migratedLegacyAt = now;
  saveLocalWorldSession(created.session);
  return created;
}

export function clearLocalWorldSession(address: string): void {
  try { localStorage.removeItem(KEY(address)); } catch {}
  clearLegacyWorld(address);
}

export function localWorldTargetName(world: HeadlessWorld, entityId: string): string {
  const entity = world.entities[entityId];
  if (!entity) return "Unknown target";
  if (entity.kind === "resource") return `${entity.resource.toUpperCase()} FIELD · L${entity.level}`;
  if (entity.kind === "monster") return `WASTELAND CREW · L${entity.level}`;
  if (entity.kind === "city") return entity.ownerId.startsWith("npc.") ? `OUTPOST ${entity.ownerId.slice(4)}` : "PLAYER CITY";
  return entity.name;
}
