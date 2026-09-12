import { describe, expect, it } from "vitest";
import {
  WORLD_VISUAL_BEACON_BUDGET, WORLD_VISUAL_BUDGET, createWorldVisualStress,
  planWorldVisuals, planWorldVisualTiers, worldVisualBodyRadius, type WorldVisualCity,
} from "./WorldVisualLayer";

describe("Star Map high-value visual planner", () => {
  it("caps a 50,000-civilization stress field at the per-LOD GPU budget", () => {
    const stress = createWorldVisualStress(50_000, 512, 512);
    const bounds = { minX: 0, minY: 0, maxX: 512, maxY: 512 };
    expect(planWorldVisuals(stress, bounds, 1)).toHaveLength(WORLD_VISUAL_BUDGET.strategic);
    expect(planWorldVisuals(stress, bounds, 1.8)).toHaveLength(WORLD_VISUAL_BUDGET.field);
    expect(planWorldVisuals(stress, bounds, 16)).toHaveLength(WORLD_VISUAL_BUDGET.tactical);
  });

  it("never budgets away the local or selected civilization", () => {
    const stress = createWorldVisualStress(10_000, 512, 512);
    const own = { ...stress[9_999], id: "own", own: true };
    const selected = { ...stress[9_998], id: "selected", selected: true };
    const planned = planWorldVisuals(stress.concat(own, selected), { minX: 0, minY: 0, maxX: 512, maxY: 512 }, 16);
    expect(planned.some((city) => city.id === "own")).toBe(true);
    expect(planned.some((city) => city.id === "selected")).toBe(true);
    expect(planned.length).toBe(WORLD_VISUAL_BUDGET.tactical);
  });

  it("keeps real civilizations ahead of synthetic probes in a stress run", () => {
    const probes = createWorldVisualStress(50_000, 512, 512);
    const real: WorldVisualCity[] = probes.slice(0, 48).map((city, index) => ({ ...city, id: `real-${index}`, probe: false }));
    const plan = planWorldVisualTiers(real.concat(probes), { minX: 0, minY: 0, maxX: 512, maxY: 512 }, 1.8);
    expect(real.every((city) => plan.detailed.some((rendered) => rendered.id === city.id))).toBe(true);
    expect(plan.detailed).toHaveLength(WORLD_VISUAL_BUDGET.field);
  });

  it("leaves over-budget real players visible as low-cost field beacons", () => {
    const real: WorldVisualCity[] = createWorldVisualStress(1_000, 512, 512).map((city) => ({ ...city, probe: false }));
    const plan = planWorldVisualTiers(real, { minX: 0, minY: 0, maxX: 512, maxY: 512 }, 1.8);
    expect(plan.detailed).toHaveLength(WORLD_VISUAL_BUDGET.field);
    expect(plan.beacons).toHaveLength(WORLD_VISUAL_BEACON_BUDGET);
    expect(plan.visibleCount).toBe(1_000);
  });

  it("keeps rival cosmetics legible without letting the home body dominate", () => {
    expect(worldVisualBodyRadius(1.8, false)).toBeGreaterThanOrEqual(11);
    expect(worldVisualBodyRadius(16, false)).toBeGreaterThanOrEqual(18);
    expect(worldVisualBodyRadius(16, true) / worldVisualBodyRadius(16, false)).toBeLessThan(1.3);
  });

  it("keeps render probes outside game authority and clamps pathological requests", () => {
    expect(createWorldVisualStress(-10, 512, 512)).toHaveLength(0);
    const stress = createWorldVisualStress(80_000, 512, 512);
    expect(stress).toHaveLength(50_000);
    expect(stress.every((city) => city.probe)).toBe(true);
  });
});
