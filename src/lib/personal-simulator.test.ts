import { describe, expect, it } from "vitest";
import defaults from "../../docs/numbers.json";
import { PersonalSimulationStrategy, simulatePersonalProgression } from "./simulator";

const base = {
  targetLevel: 10,
  sessionsPerDay: 3,
  queueUptime: 0.85,
  researchUptime: 0.8,
  trainingUptime: 0.75,
  fullNodeHarvestsPerDay: 1,
};

describe("integrated personal progression simulator", () => {
  it.each<PersonalSimulationStrategy>(["growth", "balanced", "military"])(
    "reaches Townhall 10 without a deadlock using the %s strategy",
    (strategy) => {
      const result = simulatePersonalProgression(defaults, { ...base, strategy });

      expect(result.deadlock).toBeUndefined();
      expect(result.reachedLevel).toBe(10);
      expect(result.research.upgrades).toBeGreaterThan(0);
      expect(result.troops.total).toBeGreaterThan(0);
      Object.values(result.queues).forEach((utilization) => {
        expect(utilization).toBeGreaterThanOrEqual(0);
        expect(utilization).toBeLessThanOrEqual(1);
      });
    },
  );

  it("conserves each resource across all modeled sources and sinks", () => {
    const result = simulatePersonalProgression(defaults, { ...base, strategy: "balanced" });

    for (const resource of ["res.cash", "res.oil", "res.power"]) {
      const source = result.resources.starting[resource]
        + result.resources.cityProduction[resource]
        + result.resources.worldGathering[resource];
      const sink = result.resources.buildingSpend[resource]
        + result.resources.researchSpend[resource]
        + result.resources.trainingSpend[resource]
        + result.resources.overflow[resource]
        + result.resources.ending[resource];
      expect(source).toBeCloseTo(sink, 4);
    }
  });

  it("does not make a gathering-enabled plan slower than city-only progression", () => {
    const cityOnly = simulatePersonalProgression(defaults, {
      ...base,
      strategy: "balanced",
      fullNodeHarvestsPerDay: 0,
    });
    const gathering = simulatePersonalProgression(defaults, { ...base, strategy: "balanced" });

    expect(gathering.totalHours).toBeLessThanOrEqual(cityOnly.totalHours);
  });

  it("can evaluate the full TH30 progression path", () => {
    const result = simulatePersonalProgression(defaults, {
      ...base,
      targetLevel: 30,
      strategy: "balanced",
    });

    expect(result.deadlock).toBeUndefined();
    expect(result.reachedLevel).toBe(30);
    expect(result.milestones[result.milestones.length - 1]?.level).toBe(30);
  });
});
