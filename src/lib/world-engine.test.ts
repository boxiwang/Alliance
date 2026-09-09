import { describe, expect, it } from "vitest";
import defaults from "../../docs/numbers.json";
import {
  DEFAULT_WORLD_ENGINE_CONFIG, HeadlessWorld, Point, ResourceEntity,
  advanceHeadlessWorld, advanceTargetLifecycle, breachCity, buildSpatialIndex, defeatMonster, depleteResource,
  dispatchMarch, distance, emptyCommanderSnapshot, energyAt, initHeadlessWorld, migrateWorldToCircularBoundary, occupyResource,
  populateWorld, queryNearby, recallMarch, redistributeWorldTargets, scanForRogue, spawnPlayer, spawnPlayers, worldCenter,
  isInsidePlayableWorld, worldDepth, worldPlayableRadius, worldResourceMaxLevel, worldRogueMaxLevel,
} from "./world-engine";

function minPairDistance(points: Point[]): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let i = 0; i < points.length; i += 1) for (let j = i + 1; j < points.length; j += 1) {
    minimum = Math.min(minimum, distance(points[i], points[j]));
  }
  return minimum;
}

function firstEntity<T extends "resource" | "monster">(world: HeadlessWorld, kind: T): Extract<HeadlessWorld["entities"][string], { kind: T }> {
  return Object.values(world.entities).find((entity): entity is Extract<HeadlessWorld["entities"][string], { kind: T }> => entity.kind === kind)!;
}

describe("headless world — scale and sparse spawning", () => {
  it("spawns 1,000 unique cities outside the Circle reserve", () => {
    const base = initHeadlessWorld("state-4663", 1000);
    const inputs = Array.from({ length: 1000 }, (_, index) => ({ id: `player-${index}` }));
    const world = spawnPlayers(base, inputs, 1000);
    const cities = Object.values(world.entities).filter((entity) => entity.kind === "city");
    const positions = cities.map((city) => city.position);
    expect(cities).toHaveLength(1000);
    expect(new Set(positions.map((point) => `${point.x}:${point.y}`)).size).toBe(1000);
    positions.forEach((point) => {
      expect(distance(point, worldCenter(world.config))).toBeGreaterThan(world.config.circleReserveRadius);
      expect(isInsidePlayableWorld(point, world.config, world.config.cityFootprint + 1)).toBe(true);
    });
    expect(minPairDistance(positions)).toBeGreaterThan(11);
  });

  it("allocates early cities more sparsely than a nearly full State", () => {
    const base = initHeadlessWorld("state-sparse", 1000);
    const early = base.spawnAnchors.slice(0, 100);
    const dense = base.spawnAnchors.slice(0, 1000);
    expect(minPairDistance(early)).toBeGreaterThan(minPairDistance(dense) * 2);
  });

  it("fits the full 1,000-city ecology inside the circular Frontier", () => {
    let world = spawnPlayers(initHeadlessWorld("state-circle-capacity", 1000),
      Array.from({ length: 1000 }, (_, index) => ({ id: `capacity-${index}` })), 1000);
    world = populateWorld(world, defaults.world.population.resourceCap, defaults.world.population.monsterCap, 1000, defaults);
    const entities = Object.values(world.entities).filter((entity) => entity.kind !== "poi");
    expect(entities).toHaveLength(5200);
    expect(entities.every((entity) => isInsidePlayableWorld(entity.position, world.config,
      entity.kind === "city" ? world.config.cityFootprint + 1 : 3))).toBe(true);
  }, 30_000);

  it("supports bounded nearby queries by kind", () => {
    let world = initHeadlessWorld("state-query", 1000);
    world = spawnPlayers(world, Array.from({ length: 80 }, (_, index) => ({ id: `p-${index}` })), 1000);
    world = populateWorld(world, 150, 100, 1000);
    const city = world.entities[world.players["p-0"].cityId];
    const index = buildSpatialIndex(world);
    const nearby = queryNearby(world, city.position, 70, ["city"], index);
    expect(nearby.length).toBeGreaterThan(0);
    expect(nearby.length).toBeLessThan(80);
    expect(nearby.every((entity) => entity.kind === "city" && distance(city.position, entity.position) <= 70)).toBe(true);
  });

  it("distributes neutral targets across the map and derives level from the inward zone", () => {
    let world = initHeadlessWorld("state-radial-geography", 1000);
    world = spawnPlayers(world, Array.from({ length: 12 }, (_, index) => ({ id: `player-${index}` })), 1000);
    world = populateWorld(world, 60, 24, 1000, defaults);
    const targets = Object.values(world.entities).filter((entity) => entity.kind === "resource" || entity.kind === "monster");
    const xs = targets.map((target) => target.position.x);
    const ys = targets.map((target) => target.position.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(400);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(400);
    expect(new Set(targets.filter((entity) => entity.kind === "resource").map((entity) => entity.resource)))
      .toEqual(new Set(["cash", "oil", "power"]));
    const center = worldCenter(world.config);
    const outerRadius = worldPlayableRadius(world.config);
    const occupiedWedges = new Set(targets.map((target) => {
      const angle = Math.atan2(target.position.y - center.y, target.position.x - center.x) + Math.PI;
      return Math.floor(angle / (Math.PI * 2) * 8);
    }));
    expect(occupiedWedges.size).toBe(8);
    targets.forEach((target) => {
      expect(distance(target.position, center)).toBeLessThanOrEqual(outerRadius);
      const maxLevel = target.kind === "resource" ? worldResourceMaxLevel(defaults) : worldRogueMaxLevel(defaults);
      const radialLevel = Math.max(1, Math.min(maxLevel, 1 + Math.floor(worldDepth(target.position, world.config) * maxLevel)));
      expect(target.level).toBeGreaterThanOrEqual(1);
      expect(target.level).toBeLessThanOrEqual(maxLevel);
      expect(Math.abs(target.level - radialLevel)).toBeLessThanOrEqual(defaults.world.ecology.levelJitter);
    });
  });

  it("migrates stale halo targets and recalculates their level for the new coordinate", () => {
    let world = spawnPlayers(initHeadlessWorld("state-radial-migration", 1000), [{ id: "player" }], 1000);
    world = populateWorld(world, 12, 4, 1000, defaults);
    const target = firstEntity(world, "resource");
    const oldPosition = { ...target.position };
    target.level = 10;
    const migrated = redistributeWorldTargets(world, 2000, defaults);
    const moved = migrated.entities[target.id] as ResourceEntity;
    expect(moved.position).not.toEqual(oldPosition);
    expect(moved.level).toBe(worldResourceMaxLevel(defaults));
    expect(moved.amount).toBe(moved.capacity);
  });

  it("moves legacy square-edge entities into the circular world boundary", () => {
    let world = spawnPlayer(initHeadlessWorld("state-circle-migration", 1000), { id: "corner" }, 1000);
    world = populateWorld(world, 1, 1, 1000, defaults);
    const city = world.entities[world.players.corner.cityId];
    const resource = firstEntity(world, "resource");
    city.position = { x: 0, y: 0 };
    resource.position = { x: 512, y: 512 };
    const migrated = migrateWorldToCircularBoundary(world, 2000, defaults);
    expect(isInsidePlayableWorld(migrated.entities[city.id].position, migrated.config, migrated.config.cityFootprint + 1)).toBe(true);
    expect(isInsidePlayableWorld(migrated.entities[resource.id].position, migrated.config)).toBe(true);
  });

  it("caps Frontier I at resource L8 and Rogue L20 while keeping every rung present", () => {
    const resourceMinimum = defaults.world.ecology.resourceMaxLevel * defaults.world.population.resourceMinPerLevel;
    const rogueMinimum = defaults.world.ecology.rogueMaxLevel * defaults.world.population.rogueMinPerLevel;
    const world = populateWorld(initHeadlessWorld("frontier-one-ladder", 1000), resourceMinimum, rogueMinimum, 1000, defaults);
    const resources = Object.values(world.entities).filter((entity) => entity.kind === "resource");
    const rogues = Object.values(world.entities).filter((entity) => entity.kind === "monster");
    expect(new Set(resources.map((entity) => entity.level))).toEqual(new Set(Array.from({ length: 8 }, (_, index) => index + 1)));
    expect(new Set(rogues.map((entity) => entity.level))).toEqual(new Set(Array.from({ length: 20 }, (_, index) => index + 1)));
    expect(Math.max(...resources.map((entity) => entity.level))).toBe(8);
    expect(Math.max(...rogues.map((entity) => entity.level))).toBe(20);
  });

  it("discovers a low Rogue only after an explicit scan and reuses that signal", () => {
    let world = spawnPlayer(initHeadlessWorld("deep-scan", 1000), { id: "newcomer" }, 1000);
    expect(Object.values(world.entities).filter((entity) => entity.kind === "monster")).toHaveLength(0);
    const first = scanForRogue(world, "newcomer", 1, 2000, defaults);
    expect(first.error).toBeUndefined();
    expect(first.spawned).toBe(true);
    expect(first.targetId).not.toBeNull();
    world = first.world;
    const target = world.entities[first.targetId!];
    const city = world.entities[world.players.newcomer.cityId];
    expect(target.kind).toBe("monster");
    expect(distance(city.position, target.position)).toBeGreaterThanOrEqual(defaults.world.ecology.deepScanSpawnMinRadius);
    expect(distance(city.position, target.position)).toBeLessThanOrEqual(defaults.world.ecology.deepScanSpawnMaxRadius);
    const second = scanForRogue(world, "newcomer", 1, 2001, defaults);
    expect(second.spawned).toBe(false);
    expect(second.targetId).toBe(first.targetId);
    expect(Object.values(second.world.entities).filter((entity) => entity.kind === "monster")).toHaveLength(1);
  });

  it("keeps Deep Scan cooldowns independent for each early Rogue level", () => {
    let world = spawnPlayer(initHeadlessWorld("deep-scan-levels", 1000), { id: "climber" }, 1000);
    const levelOne = scanForRogue(world, "climber", 1, 2000, defaults);
    expect(levelOne.spawned).toBe(true);
    world = levelOne.world;
    world.players.climber.highestMonsterDefeated = 1;
    const levelTwo = scanForRogue(world, "climber", 2, 2001, defaults);
    expect(levelTwo.error).toBeUndefined();
    expect(levelTwo.spawned).toBe(true);
    expect(levelTwo.targetId).not.toBe(levelOne.targetId);
  });

  it("does not summon advanced Rogues and marks Frontier I complete after L20", () => {
    let world = spawnPlayer(initHeadlessWorld("deep-scan-cap", 1000), { id: "traveler" }, 1000);
    world.players.traveler.highestMonsterDefeated = 6;
    const advanced = scanForRogue(world, "traveler", 7, 2000, defaults);
    expect(advanced.error).toBe("rogue_unavailable");
    expect(advanced.spawned).toBe(false);
    expect(Object.values(advanced.world.entities).filter((entity) => entity.kind === "monster")).toHaveLength(0);
    world.players.traveler.highestMonsterDefeated = 20;
    expect(scanForRogue(world, "traveler", 20, 3000, defaults).error).toBe("frontier_complete");
  });

  it("advances 10,000 scheduled events deterministically in a 1,000-player State", () => {
    let world = spawnPlayers(initHeadlessWorld("state-stress", 1000),
      Array.from({ length: 1000 }, (_, index) => ({ id: `stress-${index}` })), 1000);
    world.scheduledEvents = Array.from({ length: 10000 }, (_, index) => ({
      id: `stress-event-${String(index).padStart(5, "0")}`,
      type: "resource_respawn" as const,
      at: 2000 + (index % 100),
      entityId: `missing-${index % 7}`,
      processedAt: 0,
    }));
    const first = advanceHeadlessWorld(world, 3000);
    const second = advanceHeadlessWorld(world, 3000);
    expect(first.scheduledEvents).toHaveLength(0);
    expect(second.scheduledEvents).toHaveLength(0);
    expect(first.spawnCursor).toBe(second.spawnCursor);
    expect(Object.values(first.players).map((player) => player.spawnIndex))
      .toEqual(Object.values(second.players).map((player) => player.spawnIndex));
  });
});

describe("headless world — target lifecycle", () => {
  it("locks a resource to one march, depletes it, then respawns elsewhere", () => {
    let world = populateWorld(initHeadlessWorld("state-resource", 1000), 1, 0, 1000);
    const resource = firstEntity(world, "resource");
    const oldPosition = { ...resource.position };
    const first = occupyResource(world, resource.id, "march-a", 2000);
    const second = occupyResource(first.world, resource.id, "march-b", 2001);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    world = depleteResource(first.world, resource.id, resource.amount, 3000);
    expect((world.entities[resource.id] as ResourceEntity).state).toBe("depleted");
    const respawnAt = (world.entities[resource.id] as ResourceEntity).respawnAt;
    expect(respawnAt).toBeGreaterThanOrEqual(3000 + defaults.world.lifecycle.resourceRespawnMinSec * 1000);
    expect(respawnAt).toBeLessThanOrEqual(3000 + defaults.world.lifecycle.resourceRespawnMaxSec * 1000);
    world = advanceTargetLifecycle(world, respawnAt);
    const respawned = world.entities[resource.id] as ResourceEntity;
    expect(respawned.state).toBe("available");
    expect(respawned.amount).toBe(respawned.capacity);
    expect(respawned.position).not.toEqual(oldPosition);
  });

  it("removes a defeated monster until its scheduled respawn", () => {
    let world = populateWorld(initHeadlessWorld("state-monster", 1000), 0, 1, 1000);
    const monster = firstEntity(world, "monster");
    const oldPosition = { ...monster.position };
    world = defeatMonster(world, monster.id, "hunter", 2000);
    expect(firstEntity(world, "monster").state).toBe("defeated");
    expect(firstEntity(world, "monster").respawnAt).toBeGreaterThanOrEqual(2000 + defaults.world.lifecycle.monsterRespawnMinSec * 1000);
    expect(firstEntity(world, "monster").respawnAt).toBeLessThanOrEqual(2000 + defaults.world.lifecycle.monsterRespawnMaxSec * 1000);
    world = advanceTargetLifecycle(world, firstEntity(world, "monster").respawnAt);
    expect(firstEntity(world, "monster").state).toBe("alive");
    expect(firstEntity(world, "monster").position).not.toEqual(oldPosition);
  });

  it("burns and relocates a routed city without losing permanent progression", () => {
    let world = spawnPlayer(initHeadlessWorld("state-city", 1000), {
      id: "defender", townhallLevel: 18, might: 99999, resources: { cash: 4000 },
    }, 1000);
    const cityId = world.players.defender.cityId;
    const oldPosition = { ...world.entities[cityId].position };
    world = breachCity(world, cityId, "attacker", 999999, 2000);
    expect(world.entities[cityId].kind === "city" && world.entities[cityId].state).toBe("burning");
    const recoverAt = world.entities[cityId].kind === "city" ? world.entities[cityId].wall.burningUntil : 0;
    world = advanceTargetLifecycle(world, recoverAt);
    const city = world.entities[cityId];
    expect(city.kind).toBe("city");
    if (city.kind !== "city") return;
    expect(city.state).toBe("normal");
    expect(city.position).not.toEqual(oldPosition);
    expect(city.townhallLevel).toBe(18);
    expect(city.might).toBe(99999);
    expect(city.resources.cash).toBe(4000);
    expect(city.wall.value).toBe(city.wall.max);
  });
});

describe("headless world — future system seams", () => {
  it("stores empty hero slots and resolved zero modifiers before heroes exist", () => {
    const snapshot = emptyCommanderSnapshot();
    expect(snapshot.primaryHeroId).toBeNull();
    expect(snapshot.secondaryHeroId).toBeNull();
    expect(snapshot.effects).toEqual([]);
    expect(Object.values(snapshot.modifiers).every((value) => value === 0)).toBe(true);
  });

  it("regenerates Energy lazily without scheduled polling", () => {
    let world = spawnPlayer(initHeadlessWorld("state-energy", 1000), { id: "p" }, 1000);
    world.players.p.energyStored = 40;
    world.players.p.energyUpdatedAt = 1000;
    const afterTenTicks = 1000 + DEFAULT_WORLD_ENGINE_CONFIG.energyRegenSec * 10 * 1000;
    expect(energyAt(world.players.p, afterTenTicks, world.config)).toBe(50);
    expect(energyAt(world.players.p, afterTenTicks + 999999999, world.config)).toBe(world.config.energyCap);
  });
});

describe("headless world — march authority and feedback", () => {
  const force = { army: { "10": 800 }, navy: {}, air: {} };

  it("deduplicates dispatch commands without reserving troops or Energy twice", () => {
    let world = spawnPlayer(populateWorld(initHeadlessWorld("state-idempotent", 1000), 0, 1, 1000), {
      id: "hunter", troops: force,
    }, 1000);
    const monster = firstEntity(world, "monster");
    monster.level = 1;
    const first = dispatchMarch(world, {
      playerId: "hunter", targetId: monster.id, action: "attack_monster", force,
      idempotencyKey: "hunt-1",
    }, 2000);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const afterFirstEnergy = first.world.players.hunter.energyStored;
    const afterFirstTroops = first.world.players.hunter.troops.army["10"];
    const duplicate = dispatchMarch(first.world, {
      playerId: "hunter", targetId: monster.id, action: "attack_monster", force,
      idempotencyKey: "hunt-1",
    }, 2001);
    expect(duplicate.ok && duplicate.duplicate).toBe(true);
    expect(duplicate.world.players.hunter.energyStored).toBe(afterFirstEnergy);
    expect(duplicate.world.players.hunter.troops.army["10"]).toBe(afterFirstTroops);
    expect(Object.keys(duplicate.world.marches)).toHaveLength(1);
  });

  it("reports a monster result on arrival but delivers rewards only on return", () => {
    let world = spawnPlayer(populateWorld(initHeadlessWorld("state-hunt", 1000), 0, 1, 1000), {
      id: "hunter", troops: force, resources: { cash: 7, oil: 11, power: 13 },
    }, 1000);
    const monster = firstEntity(world, "monster");
    monster.level = 1; monster.power = 1; monster.reward = { cash: 500, oil: 250 };
    const sent = dispatchMarch(world, {
      playerId: "hunter", targetId: monster.id, action: "attack_monster", force,
      idempotencyKey: "hunt-feedback",
    }, 2000);
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    world = advanceHeadlessWorld(sent.world, sent.march.arriveAt);
    const arrived = world.marches[sent.march.id];
    expect(arrived.outcome).toBe("victory");
    expect((world.entities[monster.id] as any).state).toBe("defeated");
    expect(world.players.hunter.resources.cash).toBe(7);
    expect(arrived.reportIds.some((id) => world.reports[id].stage === "arrival")).toBe(true);

    world = advanceHeadlessWorld(world, arrived.returnAt);
    expect(world.marches[arrived.id].state).toBe("completed");
    expect(world.players.hunter.resources.cash).toBe(507);
    expect(world.marches[arrived.id].reportIds.some((id) => world.reports[id].stage === "return")).toBe(true);
    const returned = Object.values(world.players.hunter.troops.army).reduce((sum, amount) => sum + amount, 0);
    expect(returned + world.players.hunter.wounded + world.players.hunter.dead).toBe(800);
    const woundedRosterTotal = Object.values(world.players.hunter.woundedTroops.army).reduce((sum, amount) => sum + amount, 0)
      + Object.values(world.players.hunter.woundedTroops.navy).reduce((sum, amount) => sum + amount, 0)
      + Object.values(world.players.hunter.woundedTroops.air).reduce((sum, amount) => sum + amount, 0);
    expect(woundedRosterTotal).toBe(world.players.hunter.wounded);
  });

  it("wounds a prepared winning fleet and turns Hospital overflow into deaths on defeat", () => {
    const prepared = { army: { "1": 40 }, navy: { "1": 40 }, air: { "1": 40 } };
    const resolveHunt = (power: number, hospitalCapacity: number, key: string) => {
      const numbers: any = structuredClone(defaults);
      numbers.buildings["building.hospital"].levels["1"].woundedCapacity = hospitalCapacity;
      let world = spawnPlayer(populateWorld(initHeadlessWorld(`state-${key}`, 1000), 0, 1, 1000, numbers), {
        id: "hunter", hospitalLevel: 1, troops: prepared,
      }, 1000);
      const monster = firstEntity(world, "monster");
      monster.level = 1; monster.power = power; monster.dominantArm = "navy";
      const sent = dispatchMarch(world, {
        playerId: "hunter", targetId: monster.id, action: "attack_monster", force: prepared,
        idempotencyKey: key,
      }, 2000, numbers);
      expect(sent.ok).toBe(true);
      if (!sent.ok) throw new Error("Hunt did not dispatch.");
      world = advanceHeadlessWorld(sent.world, sent.march.arriveAt, numbers);
      return world.marches[sent.march.id];
    };

    const win = resolveHunt(defaults.world.monsters.levels["1"].power, 100, "prepared-win");
    expect(win.outcome).toBe("victory");
    expect(win.wounded).toBeGreaterThan(0);
    expect(win.dead).toBe(0);

    const loss = resolveHunt(defaults.world.monsters.levels["1"].power * 100, 2, "hospital-overflow");
    expect(loss.outcome).toBe("defeat");
    expect(loss.wounded).toBe(2);
    expect(loss.dead).toBeGreaterThan(0);
  });

  it("lets the first arriving gather march claim a node and returns the loser with a report", () => {
    let world = populateWorld(initHeadlessWorld("state-race", 1000), 1, 0, 1000);
    world = spawnPlayers(world, [
      { id: "near", troops: { army: { "1": 84 }, navy: {}, air: {} } },
      { id: "far", troops: { army: { "1": 84 }, navy: {}, air: {} } },
    ], 1000);
    const node = firstEntity(world, "resource");
    node.level = 1; node.capacity = 1000; node.amount = 1000;
    // Make ordering explicit; the state machine, not object insertion order, decides the winner.
    (world.entities[world.players.near.cityId] as any).position = { x: node.position.x + 1, y: node.position.y };
    (world.entities[world.players.far.cityId] as any).position = { x: node.position.x + 8, y: node.position.y };
    const near = dispatchMarch(world, {
      playerId: "near", targetId: node.id, action: "gather",
      force: { army: { "1": 84 }, navy: {}, air: {} }, idempotencyKey: "near-gather",
    }, 2000);
    expect(near.ok).toBe(true);
    if (!near.ok) return;
    const far = dispatchMarch(near.world, {
      playerId: "far", targetId: node.id, action: "gather",
      force: { army: { "1": 84 }, navy: {}, air: {} }, idempotencyKey: "far-gather",
    }, 2000);
    expect(far.ok).toBe(true);
    if (!far.ok) return;
    world = advanceHeadlessWorld(far.world, far.march.arriveAt);
    expect(world.marches[near.march.id].state).toBe("gathering");
    expect(world.marches[far.march.id].outcome).toBe("target_unavailable");
    expect(world.marches[far.march.id].reportIds.length).toBeGreaterThan(0);
  });

  it("rejects only removable excess load and lets the minimum discrete fleet clear a node", () => {
    const numbers: any = structuredClone(defaults);
    let world = spawnPlayer(populateWorld(initHeadlessWorld("state-gather-crew", 1000), 1, 0, 1000, numbers), {
      id: "gatherer", troops: { army: {}, navy: {}, air: { "1": 1500 } },
    }, 1000);
    const node = firstEntity(world, "resource");
    node.level = 2; node.capacity = 2000; node.amount = 2000;
    world.players.gatherer.marchCapacity = 2000;
    const oversized = dispatchMarch(world, {
      playerId: "gatherer", targetId: node.id, action: "gather",
      force: { army: {}, navy: {}, air: { "1": 335 } }, idempotencyKey: "too-many",
    }, 2000, numbers);
    if ("error" in oversized) expect(oversized.error).toBe("resource_force_exceeds_need");
    else throw new Error("Oversized resource crew unexpectedly dispatched.");

    const exact = dispatchMarch(world, {
      playerId: "gatherer", targetId: node.id, action: "gather",
      force: { army: {}, navy: {}, air: { "1": 334 } }, idempotencyKey: "minimum-load",
    }, 2000, numbers);
    expect(exact.ok).toBe(true);
    if (!exact.ok) return;
    world = advanceHeadlessWorld(exact.world, exact.march.arriveAt, numbers);
    world = advanceHeadlessWorld(world, world.marches[exact.march.id].workUntil, numbers);
    expect((world.entities[node.id] as ResourceEntity).amount).toBe(0);
    expect((world.entities[node.id] as ResourceEntity).state).toBe("depleted");
  });

  it("retires a resource below 25% after the gathering fleet withdraws and respawns it", () => {
    const numbers: any = structuredClone(defaults);
    let world = spawnPlayer(populateWorld(initHeadlessWorld("state-resource-retire", 1000), 1, 0, 1000, numbers), {
      id: "gatherer", troops: { army: {}, navy: {}, air: { "1": 134 } },
    }, 1000);
    const node = firstEntity(world, "resource");
    node.level = 2; node.capacity = 2000; node.amount = 1000;
    world.players.gatherer.marchCapacity = 2000;
    const sent = dispatchMarch(world, {
      playerId: "gatherer", targetId: node.id, action: "gather",
      force: { army: {}, navy: {}, air: { "1": 134 } }, idempotencyKey: "retire-node",
    }, 2000, numbers);
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    world = advanceHeadlessWorld(sent.world, sent.march.arriveAt, numbers);
    world = advanceHeadlessWorld(world, world.marches[sent.march.id].workUntil, numbers);
    const retired = world.entities[node.id] as ResourceEntity;
    expect(retired.amount).toBe(196);
    expect(retired.state).toBe("depleted");
    expect(retired.respawnAt).toBeGreaterThan(0);
    world = advanceHeadlessWorld(world, retired.respawnAt, numbers);
    expect((world.entities[node.id] as ResourceEntity).state).toBe("available");
    expect((world.entities[node.id] as ResourceEntity).amount).toBe((world.entities[node.id] as ResourceEntity).capacity);
  });

  it("resolves a city attack at arrival, burns the target, and preserves permanent progression", () => {
    const raidForce = { army: {}, navy: {}, air: { "10": 1000 } };
    let world = spawnPlayers(initHeadlessWorld("state-raid", 1000), [
      { id: "attacker", townhallLevel: 10, troops: raidForce },
      {
        id: "defender", townhallLevel: 14, might: 555000, shieldDurationSec: 0,
        troops: { army: { "1": 1 }, navy: {}, air: {} }, resources: { cash: 9000, oil: 4000, power: 2000 },
      },
    ], 1000);
    const cityId = world.players.defender.cityId;
    const sent = dispatchMarch(world, {
      playerId: "attacker", targetId: cityId, action: "attack_city", force: raidForce,
      idempotencyKey: "raid-1",
    }, 2000);
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    world = advanceHeadlessWorld(sent.world, sent.march.arriveAt);
    const city = world.entities[cityId];
    expect(world.marches[sent.march.id].outcome).toBe("victory");
    expect(city.kind === "city" && city.state).toBe("burning");
    expect(city.kind === "city" && city.townhallLevel).toBe(14);
    expect(city.kind === "city" && city.might).toBe(555000);
    expect(world.marches[sent.march.id].reportIds.some((id) => world.reports[id].stage === "arrival")).toBe(true);
  });

  it("recalls an outbound march and returns all reserved troops", () => {
    let world = spawnPlayer(populateWorld(initHeadlessWorld("state-recall", 1000), 1, 0, 1000), {
      id: "gatherer", troops: { army: { "1": 1 }, navy: {}, air: {} },
    }, 1000);
    const node = firstEntity(world, "resource");
    const sent = dispatchMarch(world, {
      playerId: "gatherer", targetId: node.id, action: "gather",
      force: { army: { "1": 1 }, navy: {}, air: {} }, idempotencyKey: "recall-1",
    }, 2000);
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.world.players.gatherer.troops.army["1"]).toBe(0);
    world = recallMarch(sent.world, sent.march.id, "gatherer", 3000);
    world = advanceHeadlessWorld(world, world.marches[sent.march.id].returnAt);
    expect(world.players.gatherer.troops.army["1"]).toBe(1);
    expect(world.marches[sent.march.id].state).toBe("completed");
  });
});
