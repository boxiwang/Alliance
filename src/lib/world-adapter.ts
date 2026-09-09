// Browser-local bridge between the existing city GameState and the headless World authority.
// Temporary by design: a server adapter can replace persistence without changing World.tsx actions.
import type { GameState, TroopKey } from "./game";
import {
  RES_ORDER, TROOP_ORDER, accountResearchModifiers, capacity, maxTroops, might, project, worldMarchSlots,
  emptyTroopRoster, troopRosterCount,
} from "./game";
import type { DispatchMarchInput, HeadlessWorld, ResourceWallet, SpawnPlayerInput, TroopManifest } from "./world-engine";
import {
  advanceHeadlessWorld, dispatchMarch, initHeadlessWorld, migrateWorldToCircularBoundary, populateWorld, recallMarch, redistributeWorldTargets, scanForRogue, spawnPlayers,
  worldEngineConfig, zoneForPoint,
} from "./world-engine";
import { clearWorld as clearLegacyWorld, loadWorld as loadLegacyWorld, projectWorld as projectLegacyWorld } from "./world";

export interface WorldGameSnapshot {
  troops: TroopManifest;
  woundedTroops: TroopManifest;
  resources: ResourceWallet;
  wounded: number;
}

export interface LocalWorldSession {
  version: 6;
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

function playerResearchModifiers(game: GameState): any {
  return {
    marchSpeedBonus: 0,
    gatherSpeedBonus: 0,
    troopAttackBonus: 0,
    troopDefenseBonus: 0,
    loadBonus: 0,
    marchCapacityBonus: 0,
    ...accountResearchModifiers(game),
  };
}

export function snapshotWorldGame(game: GameState): WorldGameSnapshot {
  return {
    troops: manifest(game.troops),
    woundedTroops: manifest(game.woundedTroops),
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
  // Local stand-ins model real accounts at many progression stages. Their city
  // level is identity data, not the level of nearby geography.
  const townhall = 1 + ((index * 7 + zone * 5) % 30);
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

function retuneLocalNpcs(world: HeadlessWorld, numbers: any): void {
  const activeTargets = new Set(Object.values(world.marches)
    .filter((march) => !["completed", "failed"].includes(march.state))
    .map((march) => march.targetId));
  Object.values(world.players).filter((player) => player.id.startsWith("npc.")).forEach((player) => {
    if (activeTargets.has(player.cityId)) return;
    const input = npcInput(player.spawnIndex, world, numbers);
    const city = world.entities[player.cityId];
    if (!city || city.kind !== "city") return;
    const troops = manifest(input.troops as GameState["troops"]);
    const resources = {
      cash: Math.max(0, input.resources?.cash ?? 0), oil: Math.max(0, input.resources?.oil ?? 0), power: Math.max(0, input.resources?.power ?? 0),
    };
    player.troops = troops; player.woundedTroops = emptyTroopRoster(); player.wounded = 0; player.dead = 0; player.resources = resources;
    city.townhallLevel = input.townhallLevel ?? 1;
    city.wallLevel = input.wallLevel ?? city.townhallLevel;
    city.hospitalLevel = input.hospitalLevel ?? city.townhallLevel;
    city.storageLevel = input.storageLevel ?? city.townhallLevel;
    city.might = input.might ?? 0; city.garrison = structuredClone(troops); city.resources = structuredClone(resources);
    city.revision += 1;
  });
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
    might: might(game), troops: game.troops, woundedTroops: game.woundedTroops, resources: game.res,
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
  const resourceCap = Math.max(0, Math.floor(Number(population.resourceCap) || resources));
  const monsterCap = Math.max(0, Math.floor(Number(population.monsterCap) || monsters));
  world = populateWorld(world, Math.min(resources, resourceCap), Math.min(monsters, monsterCap), now, numbers);
  const player = world.players[playerId];
  player.accountModifiers = playerResearchModifiers(game);
  player.marchSlots = worldMarchSlots(game, numbers);
  // Store the base capacity; dispatch applies the account modifier snapshot.
  player.marchCapacity = Math.max(0, Math.floor(maxTroops(game)
    * (Number(numbers.global?.march?.capacityFractionOfMaxTroops) || 1)));
  const session: LocalWorldSession = {
    version: 6, address, playerId, world, syncedGame: snapshotWorldGame(game), createdAt: now, migratedLegacyAt: 0,
  };
  return { session, game, changed: true };
}

function applyExternalGameDelta(session: LocalWorldSession, game: GameState): void {
  const player = session.world.players[session.playerId];
  if (!player) throw new Error("Local World player is missing.");
  if (!player.woundedTroops) {
    player.woundedTroops = emptyTroopRoster();
    player.woundedTroops.army["1"] = Math.max(0, player.wounded || 0);
  }
  const priorWounded = session.syncedGame.woundedTroops ?? (() => {
    const roster = emptyTroopRoster();
    roster.army["1"] = Math.max(0, session.syncedGame.wounded || 0);
    return roster;
  })();
  const current = snapshotWorldGame(game);
  TROOP_ORDER.forEach((arm) => {
    for (let tier = 1; tier <= 10; tier += 1) {
      const key = String(tier);
      const delta = current.troops[arm][key] - (session.syncedGame.troops[arm][key] ?? 0);
      player.troops[arm][key] = Math.max(0, (player.troops[arm][key] ?? 0) + delta);
    }
  });
  TROOP_ORDER.forEach((arm) => {
    for (let tier = 1; tier <= 10; tier += 1) {
      const key = String(tier);
      const delta = current.woundedTroops[arm][key] - (priorWounded[arm][key] ?? 0);
      player.woundedTroops[arm][key] = Math.max(0, (player.woundedTroops[arm][key] ?? 0) + delta);
    }
  });
  RES_ORDER.forEach((resource) => {
    const delta = current.resources[resource] - session.syncedGame.resources[resource];
    player.resources[resource] = Math.max(0, player.resources[resource] + delta);
  });
  player.wounded = troopRosterCount(player.woundedTroops);
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
  player.accountModifiers = playerResearchModifiers(game);
  player.marchSlots = worldMarchSlots(game, numbers);
  player.marchCapacity = Math.max(0, Math.floor(maxTroops(game)
    * (Number(numbers.global?.march?.capacityFractionOfMaxTroops) || 1)));
}

export function applyWorldPlayerToGame(session: LocalWorldSession, sourceGame: GameState): GameState {
  const game = clone(sourceGame);
  const player = session.world.players[session.playerId];
  game.troops = manifest(player.troops);
  game.woundedTroops = manifest(player.woundedTroops);
  const cap = capacity(game);
  RES_ORDER.forEach((resource) => { game.res[resource] = Math.min(cap, Math.max(0, Math.floor(player.resources[resource]))); });
  game.wounded = troopRosterCount(game.woundedTroops);
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

export function scanLocalWorldRogue(
  sourceSession: LocalWorldSession,
  sourceGame: GameState,
  requestedLevel: number,
  now = Date.now(),
  numbers: any,
): LocalWorldResult & { targetId: string | null; spawned: boolean } {
  const prepared = reconcile(clone(sourceSession), sourceGame, now, numbers);
  const result = scanForRogue(prepared.session.world, prepared.session.playerId, requestedLevel, now, numbers);
  prepared.session.world = result.world;
  updatePlayerMetadata(prepared.session, prepared.game, numbers);
  prepared.session.syncedGame = snapshotWorldGame(prepared.game);
  return {
    ...prepared,
    changed: prepared.changed || result.spawned,
    targetId: result.targetId,
    spawned: result.spawned,
    error: result.error,
  };
}

export function recallLocalWorldMarch(
  sourceSession: LocalWorldSession,
  sourceGame: GameState,
  marchId: string,
  now = Date.now(),
  numbers: any,
): LocalWorldResult {
  // Recall changes only an already-reserved World force. Do not reconcile an
  // incoming GameState snapshot here: a click can race React/localStorage by a
  // frame and make the pre-dispatch roster look like newly trained troops.
  const session = clone(sourceSession);
  const before = JSON.stringify(session.world.marches[marchId]);
  session.world = recallMarch(session.world, marchId, session.playerId, now, numbers);
  let game = applyWorldPlayerToGame(session, project(sourceGame, now));
  if (before === JSON.stringify(session.world.marches[marchId])) return { session, game, changed: false, error: "march_not_recallable" };
  updatePlayerMetadata(session, game, numbers);
  session.syncedGame = snapshotWorldGame(game);
  return { session, game, changed: true };
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
    return [1, 2, 3, 4, 5, 6].includes(parsed?.version) && parsed?.world?.version === 2 ? parsed as LocalWorldSession : null;
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
  if (stored) {
    // Config is derived from numbers.json, never authored per-world. Refresh it on load so a
    // world persisted before a new config key existed (e.g. minEntitySpacing) picks it up
    // instead of crashing on undefined during migration/respawn.
    stored.world.config = worldEngineConfig(numbers);
    Object.values(stored.world.players).forEach((player) => {
      player.deepScanCooldowns = player.deepScanCooldowns && typeof player.deepScanCooldowns === "object"
        ? player.deepScanCooldowns : {};
      player.deepScanTargetIds = player.deepScanTargetIds && typeof player.deepScanTargetIds === "object"
        ? player.deepScanTargetIds : {};
    });
    if ((stored as any).version < 5) {
      stored.world = redistributeWorldTargets(stored.world, now, numbers);
      retuneLocalNpcs(stored.world, numbers);
      (stored as any).version = 5;
    }
    if ((stored as any).version < 6) {
      stored.world = migrateWorldToCircularBoundary(stored.world, now, numbers);
      stored.version = 6;
    }
    return reconcile(stored, sourceGame, now, numbers);
  }
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
  if (entity.kind === "resource") return `${entity.resource.toUpperCase()} PLANET · L${entity.level}`;
  if (entity.kind === "monster") return `ROGUE PLANET · L${entity.level}`;
  if (entity.kind === "city") {
    if (!entity.ownerId.startsWith("npc.")) return `${entity.ownerId.slice(0, 6)}…${entity.ownerId.slice(-4)}`;
    const handles = ["LUNA.ETH", "0xMOGUL", "DEGENLILY", "SATS PILOT", "PIXEL WHALE", "BAGHOLDER", "YIELD WITCH", "MOONCAT", "GAS MAXI", "JEETSLAYER", "CHAIN GHOST", "ALPHA LEAK"];
    const index = Number(entity.ownerId.slice(4)) || 0;
    return `${handles[index % handles.length]} · ${String(index).padStart(2, "0")}`;
  }
  return entity.name;
}
