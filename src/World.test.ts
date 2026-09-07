import { describe, expect, it } from "vitest";
import { clusterWorldSignals, recommendedGatherForce } from "./World";
import type { MonsterEntity, ResourceEntity } from "./lib/world-engine";

describe("World strategic signal clusters", () => {
  it("groups nearby signals by kind without merging resources and hostiles", () => {
    const resource = (id: string, x: number, y: number): ResourceEntity => ({
      id, kind: "resource", position: { x, y }, zone: 1, spawnedAt: 0, revision: 0,
      state: "available", resource: "cash", level: 1, amount: 100, capacity: 100,
      occupiedByMarchId: null, respawnAt: 0,
    });
    const monster: MonsterEntity = {
      id: "m1", kind: "monster", position: { x: 12, y: 10 }, zone: 1, spawnedAt: 0, revision: 0,
      state: "alive", level: 1, dominantArm: "army", power: 100, reward: {},
      engagedByMarchId: null, respawnAt: 0,
    };

    const clusters = clusterWorldSignals([resource("r1", 8, 8), resource("r2", 14, 12), monster], 44);

    expect(clusters).toHaveLength(2);
    expect(clusters.find((cluster) => cluster.kind === "resource")?.count).toBe(2);
    expect(clusters.find((cluster) => cluster.kind === "monster")?.count).toBe(1);
  });
});

describe("World gather recommendation", () => {
  it("fills the requested crew without exceeding available troops", () => {
    const force = recommendedGatherForce({
      army: { "1": 400 }, navy: { "2": 300 }, air: { "3": 500 },
    } as any, 1000);
    const total = Object.values(force).flatMap((tiers) => Object.values(tiers)).reduce((sum, qty) => sum + qty, 0);
    expect(total).toBe(1000);
    expect(force.air["3"]).toBe(500);
  });
});
