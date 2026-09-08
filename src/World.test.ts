import { describe, expect, it } from "vitest";
import defaults from "../docs/numbers.json";
import { WORLD_MAX_ZOOM, clusterWorldSignals, gatherCarryWithAccount, marchMapProgress, recommendedGatherForce, resourceOccupationDisposition, worldMarkerScale } from "./World";
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

  it("includes the player's researched load bonus in the estimated haul", () => {
    const troops = { army: { "1": 10 }, navy: {}, air: {} } as any;
    const base = gatherCarryWithAccount(troops, {}, defaults);
    expect(gatherCarryWithAccount(troops, { loadBonus: .5 }, defaults)).toBeCloseTo(base * 1.5);
  });
});

describe("World resource occupation display", () => {
  const resource = (state: ResourceEntity["state"], marchId: string | null): ResourceEntity => ({
    id: "r1", kind: "resource", position: { x: 8, y: 8 }, zone: 1, spawnedAt: 0, revision: 0,
    state, resource: "cash", level: 4, amount: 100, capacity: 100,
    occupiedByMarchId: marchId, respawnAt: 0,
  });
  const players = {
    me: { id: "me", allianceId: "meme-a" },
    ally: { id: "ally", allianceId: "meme-a" },
    rival: { id: "rival", allianceId: "meme-b" },
  };

  it("separates neutral, own, allied and rival harvest fleets", () => {
    expect(resourceOccupationDisposition(resource("available", null), {}, players, "me", "meme-a")).toBe("neutral");
    expect(resourceOccupationDisposition(resource("occupied", "m1"), { m1: { playerId: "me" } }, players, "me", "meme-a")).toBe("self");
    expect(resourceOccupationDisposition(resource("occupied", "m2"), { m2: { playerId: "ally" } }, players, "me", "meme-a")).toBe("ally");
    expect(resourceOccupationDisposition(resource("occupied", "m3"), { m3: { playerId: "rival" } }, players, "me", "meme-a")).toBe("enemy");
  });
});

describe("World march rendering", () => {
  it("renders an outbound recall from its actual turnaround point", () => {
    const recalled = {
      state: "returning", outcome: "recalled", dispatchedAt: 0, arriveAt: 100,
      workUntil: 0, returnStartedAt: 20, returnAt: 40,
    } as any;
    expect(marchMapProgress(recalled, 20)).toBeCloseTo(.2);
    expect(marchMapProgress(recalled, 30)).toBeCloseTo(.1);
    expect(marchMapProgress(recalled, 40)).toBe(0);
  });

  it("allows deep tactical zoom while growing markers only modestly", () => {
    expect(WORLD_MAX_ZOOM).toBe(16);
    expect(worldMarkerScale(3) * 3).toBeCloseTo(1);
    expect(worldMarkerScale(16) * 16).toBeCloseTo(2);
  });
});
