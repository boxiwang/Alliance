import { describe, expect, it } from "vitest";
import { assignOuterRingCoord, outerRingSlots, WORLD_COORD_LIMITS } from "./world-coords";

describe("shared-world outer-ring coordinates", () => {
  it("fills the outer ring before stepping inward", () => {
    const slots = outerRingSlots();
    const firstRadius = Math.hypot(slots[0].x - WORLD_COORD_LIMITS.center, slots[0].y - WORLD_COORD_LIMITS.center);
    const firstInner = slots.findIndex((coord) => Math.hypot(coord.x - WORLD_COORD_LIMITS.center, coord.y - WORLD_COORD_LIMITS.center) < firstRadius - 1);
    expect(firstRadius).toBeCloseTo(WORLD_COORD_LIMITS.outerSpawnRadius, 1);
    expect(firstInner).toBeGreaterThan(80);
  });

  it("has enough unique, non-central slots for a full State", () => {
    const slots = outerRingSlots();
    expect(slots.length).toBeGreaterThanOrEqual(1024);
    expect(new Set(slots.map((coord) => `${coord.x},${coord.y}`)).size).toBe(slots.length);
    for (const coord of slots) {
      expect(Math.hypot(coord.x - WORLD_COORD_LIMITS.center, coord.y - WORLD_COORD_LIMITS.center)).toBeGreaterThan(WORLD_COORD_LIMITS.reserveRadius);
    }
  });

  it("returns the first free stable slot", () => {
    const slots = outerRingSlots();
    expect(assignOuterRingCoord([])).toEqual(slots[0]);
    expect(assignOuterRingCoord(slots.slice(0, 3))).toEqual(slots[3]);
  });
});
