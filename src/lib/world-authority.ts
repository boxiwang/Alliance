// Pure server-side bridge between an authoritative GameState and the headless
// World engine. This file must stay free of DOM, localStorage and network APIs.
import type { GameState } from "./game";
import {
  RES_ORDER, TROOP_ORDER, accountResearchModifiers, maxTroops, might,
  project, troopRosterCount, worldMarchSlots,
} from "./game";
import type {
  DispatchMarchInput, HeadlessWorld, MarchAction, Point, TroopManifest, WarpRequest,
} from "./world-engine";
import {
  advanceHeadlessWorld, dispatchMarch, isMutatingInPlace, recallMarch, relocateCity, removeSimulatedCities, scanForRogue, simulatedCityCount,
} from "./world-engine";

export interface WorldAuthoritySnapshot {
  troops: TroopManifest;
  woundedTroops: TroopManifest;
  resources: { cash: number; oil: number; power: number };
  wounded: number;
}

export interface WorldAuthoritySession {
  version: number;
  address: string;
  playerId: string;
  world: HeadlessWorld;
  syncedGame: WorldAuthoritySnapshot;
  createdAt: number;
  migratedLegacyAt: number;
}

export type WorldAuthorityCommand =
  | { type: "world.advance"; args: Record<string, never> }
  | { type: "world.dispatch"; args: { targetId: string; action: MarchAction; force?: Partial<TroopManifest>; dispatchKey: string } }
  | { type: "world.recall"; args: { marchId: string } }
  | { type: "world.scan"; args: { requestedLevel: number } }
  | { type: "world.warp"; args: WarpRequest };

export interface WorldAuthorityResult {
  session: WorldAuthoritySession;
  game: GameState;
  ok: boolean;
  reason?: string;
  changed: boolean;
  targetId?: string | null;
  spawned?: boolean;
  position?: Point;
}

function clone<T>(value: T): T { return structuredClone(value); }

function manifest(source: GameState["troops"]): TroopManifest {
  const troops: TroopManifest = { army: {}, navy: {}, air: {} };
  TROOP_ORDER.forEach((arm) => {
    for (let tier = 1; tier <= 10; tier += 1) {
      troops[arm][String(tier)] = Math.max(0, Math.floor(source[arm]?.[String(tier)] ?? 0));
    }
  });
  return troops;
}

export function snapshotAuthorityGame(game: GameState): WorldAuthoritySnapshot {
  return {
    troops: manifest(game.troops),
    woundedTroops: manifest(game.woundedTroops),
    resources: { cash: game.res.cash, oil: game.res.oil, power: game.res.power },
    wounded: Math.max(0, game.wounded),
  };
}

export function isWorldAuthoritySession(value: unknown, playerId?: string): value is WorldAuthoritySession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<WorldAuthoritySession>;
  return session.world?.version === 2
    && typeof session.playerId === "string"
    && (!playerId || session.playerId.toLowerCase() === playerId.toLowerCase())
    && !!session.world.players?.[session.playerId]
    && !!session.syncedGame;
}

function applyExternalGameDelta(session: WorldAuthoritySession, game: GameState): void {
  const player = session.world.players[session.playerId];
  if (!player) throw new Error("world_player_missing");
  const current = snapshotAuthorityGame(game);
  TROOP_ORDER.forEach((arm) => {
    for (let tier = 1; tier <= 10; tier += 1) {
      const key = String(tier);
      player.troops[arm][key] = Math.max(0, (player.troops[arm][key] ?? 0)
        + current.troops[arm][key] - (session.syncedGame.troops[arm][key] ?? 0));
      player.woundedTroops[arm][key] = Math.max(0, (player.woundedTroops[arm][key] ?? 0)
        + current.woundedTroops[arm][key] - (session.syncedGame.woundedTroops[arm][key] ?? 0));
    }
  });
  RES_ORDER.forEach((resource) => {
    player.resources[resource] = Math.max(0, player.resources[resource]
      + current.resources[resource] - session.syncedGame.resources[resource]);
  });
  player.wounded = troopRosterCount(player.woundedTroops);
}

function applyWorldPlayerToGame(session: WorldAuthoritySession, source: GameState): GameState {
  const game = clone(source);
  const player = session.world.players[session.playerId];
  game.troops = manifest(player.troops);
  game.woundedTroops = manifest(player.woundedTroops);
  RES_ORDER.forEach((resource) => {
    game.res[resource] = Math.max(0, Math.floor(player.resources[resource]));
  });
  game.wounded = troopRosterCount(game.woundedTroops);
  return game;
}

function updateMetadata(session: WorldAuthoritySession, game: GameState, numbers: any): void {
  const player = session.world.players[session.playerId];
  const city = session.world.entities[player.cityId];
  if (!city || city.kind !== "city") throw new Error("world_city_missing");
  city.townhallLevel = game.buildings.keep.lvl;
  city.wallLevel = Math.max(1, game.buildings.wall.lvl);
  city.hospitalLevel = Math.max(1, game.buildings.hospital.lvl);
  city.storageLevel = Math.max(1, game.buildings.storage.lvl);
  city.might = might(game);
  city.garrison = clone(player.troops);
  city.resources = clone(player.resources);
  player.accountModifiers = {
    marchSpeedBonus: 0, gatherSpeedBonus: 0, troopAttackBonus: 0,
    troopDefenseBonus: 0, loadBonus: 0, marchCapacityBonus: 0,
    ...accountResearchModifiers(game),
  };
  player.marchSlots = worldMarchSlots(game, numbers);
  player.marchCapacity = Math.max(0, Math.floor(maxTroops(game)
    * (Number(numbers.global?.march?.capacityFractionOfMaxTroops) || 1)));
}

// Bounded history, kept per player so one busy player never evicts another's reports
// in the shared world (docs/SHARED-ECOLOGY.md).
function compactSession(session: WorldAuthoritySession): void {
  const world = session.world;
  if (world.feed.length > 200) world.feed.splice(0, world.feed.length - 200);
  const keptReports = new Set<string>();
  Object.values(world.players).forEach((player) => {
    player.reportIds = player.reportIds.filter((id) => world.reports[id]).slice(-120);
    player.reportIds.forEach((id) => keptReports.add(id));
  });
  Object.keys(world.reports).forEach((id) => { if (!keptReports.has(id)) delete world.reports[id]; });
  const finished = Object.values(world.marches)
    .filter((march) => ["completed", "failed", "recalled"].includes(march.state))
    .sort((a, b) => b.completedAt - a.completedAt);
  const keptPerPlayer = new Map<string, number>();
  const completed = finished.filter((march) => {
    const kept = keptPerPlayer.get(march.playerId) || 0;
    keptPerPlayer.set(march.playerId, kept + 1);
    return kept >= 40;
  });
  world.scheduledEvents = world.scheduledEvents.filter((event) => !event.processedAt);
  const removedMarches = new Set(completed.map((march) => march.id));
  removedMarches.forEach((id) => { delete world.marches[id]; });
  Object.entries(world.dispatchKeys).forEach(([key, marchId]) => {
    if (removedMarches.has(marchId)) delete world.dispatchKeys[key];
  });
}

function reconcile(sourceSession: WorldAuthoritySession, sourceGame: GameState, now: number, numbers: any): WorldAuthorityResult {
  // In-place (shared world): mutate the session directly; change detection is skipped.
  const inPlace = isMutatingInPlace();
  const session = inPlace ? sourceSession : clone(sourceSession);
  let game = project(sourceGame, now);
  const before = inPlace ? "" : JSON.stringify(session.world);
  if (!simulatedCityCount(numbers)) session.world = removeSimulatedCities(session.world, now, numbers);
  session.world = advanceHeadlessWorld(session.world, now, numbers);
  applyExternalGameDelta(session, game);
  game = applyWorldPlayerToGame(session, game);
  updateMetadata(session, game, numbers);
  session.syncedGame = snapshotAuthorityGame(game);
  compactSession(session);
  return { session, game, ok: true, changed: inPlace || before !== JSON.stringify(session.world) };
}

export function applyWorldAuthorityCommand(
  sourceSession: WorldAuthoritySession,
  sourceGame: GameState,
  command: WorldAuthorityCommand,
  now: number,
  numbers: any,
): WorldAuthorityResult {
  const prepared = reconcile(sourceSession, sourceGame, now, numbers);
  if (command.type === "world.advance") return prepared;
  if (command.type === "world.dispatch") {
    const input: DispatchMarchInput = {
      playerId: prepared.session.playerId,
      targetId: command.args.targetId,
      action: command.args.action,
      force: command.args.force,
      idempotencyKey: command.args.dispatchKey,
    };
    const dispatched = dispatchMarch(prepared.session.world, input, now, numbers);
    if (!dispatched.ok) return { ...prepared, ok: false, reason: "error" in dispatched ? dispatched.error : "dispatch_failed" };
    prepared.session.world = dispatched.world;
  } else if (command.type === "world.recall") {
    const before = JSON.stringify(prepared.session.world.marches[command.args.marchId]);
    prepared.session.world = recallMarch(prepared.session.world, command.args.marchId, prepared.session.playerId, now, numbers);
    if (before === JSON.stringify(prepared.session.world.marches[command.args.marchId])) {
      return { ...prepared, ok: false, reason: "march_not_recallable" };
    }
  } else if (command.type === "world.warp") {
    const warp = relocateCity(prepared.session.world, prepared.session.playerId, command.args, now, numbers);
    if (warp.error) return { ...prepared, ok: false, reason: warp.error };
    prepared.session.world = warp.world;
    prepared.position = warp.position;
  } else {
    const scan = scanForRogue(prepared.session.world, prepared.session.playerId, command.args.requestedLevel, now, numbers);
    prepared.session.world = scan.world;
    if (scan.error) return { ...prepared, ok: false, reason: scan.error, targetId: scan.targetId, spawned: scan.spawned };
    prepared.targetId = scan.targetId;
    prepared.spawned = scan.spawned;
  }
  prepared.game = applyWorldPlayerToGame(prepared.session, prepared.game);
  updateMetadata(prepared.session, prepared.game, numbers);
  prepared.session.syncedGame = snapshotAuthorityGame(prepared.game);
  compactSession(prepared.session);
  prepared.changed = true;
  return prepared;
}
