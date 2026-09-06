import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORLD_ENGINE_CONFIG, HeadlessWorld, Point, ResourceEntity,
  advanceHeadlessWorld, advanceTargetLifecycle, breachCity, buildSpatialIndex, defeatMonster, depleteResource,
  dispatchMarch, distance, emptyCommanderSnapshot, energyAt, initHeadlessWorld, occupyResource,
  populateWorld, queryNearby, recallMarch, spawnPlayer, spawnPlayers, worldCenter,
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
    positions.forEach((point) => expect(distance(point, worldCenter(world.config))).toBeGreaterThan(world.config.circleReserveRadius));
    expect(minPairDistance(positions)).toBeGreaterThan(11);
  });

  it("allocates early cities more sparsely than a nearly full State", () => {
    const base = initHeadlessWorld("state-sparse", 1000);
    const early = base.spawnAnchors.slice(0, 100);
    const dense = base.spawnAnchors.slice(0, 1000);
    expect(minPairDistance(early)).toBeGreaterThan(minPairDistance(dense) * 2);
  });

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
  });

  it("lets the first arriving gather march claim a node and returns the loser with a report", () => {
    let world = populateWorld(initHeadlessWorld("state-race", 1000), 1, 0, 1000);
    world = spawnPlayers(world, [
      { id: "near", troops: { army: { "1": 100 }, navy: {}, air: {} } },
      { id: "far", troops: { army: { "1": 100 }, navy: {}, air: {} } },
    ], 1000);
    const node = firstEntity(world, "resource");
    // Make ordering explicit; the state machine, not object insertion order, decides the winner.
    (world.entities[world.players.near.cityId] as any).position = { x: node.position.x + 1, y: node.position.y };
    (world.entities[world.players.far.cityId] as any).position = { x: node.position.x + 8, y: node.position.y };
    const near = dispatchMarch(world, {
      playerId: "near", targetId: node.id, action: "gather",
      force: { army: { "1": 100 }, navy: {}, air: {} }, idempotencyKey: "near-gather",
    }, 2000);
    expect(near.ok).toBe(true);
    if (!near.ok) return;
    const far = dispatchMarch(near.world, {
      playerId: "far", targetId: node.id, action: "gather",
      force: { army: { "1": 100 }, navy: {}, air: {} }, idempotencyKey: "far-gather",
    }, 2000);
    expect(far.ok).toBe(true);
    if (!far.ok) return;
    world = advanceHeadlessWorld(far.world, far.march.arriveAt);
    expect(world.marches[near.march.id].state).toBe("gathering");
    expect(world.marches[far.march.id].outcome).toBe("target_unavailable");
    expect(world.marches[far.march.id].reportIds.length).toBeGreaterThan(0);
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
      id: "gatherer", troops: { army: { "1": 100 }, navy: {}, air: {} },
    }, 1000);
    const node = firstEntity(world, "resource");
    const sent = dispatchMarch(world, {
      playerId: "gatherer", targetId: node.id, action: "gather",
      force: { army: { "1": 100 }, navy: {}, air: {} }, idempotencyKey: "recall-1",
    }, 2000);
    expect(sent.ok).toBe(true);
    if (!sent.ok) return;
    expect(sent.world.players.gatherer.troops.army["1"]).toBe(0);
    world = recallMarch(sent.world, sent.march.id, "gatherer", 3000);
    world = advanceHeadlessWorld(world, world.marches[sent.march.id].returnAt);
    expect(world.players.gatherer.troops.army["1"]).toBe(100);
    expect(world.marches[sent.march.id].state).toBe("completed");
  });
});
