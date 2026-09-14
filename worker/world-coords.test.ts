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

  it("spawns on the outer ring at a random angle, never on an occupied slot", () => {
    const slots = outerRingSlots();
    const outerRadius = WORLD_COORD_LIMITS.outerSpawnRadius;
    const near = (coord: { x: number; y: number }) => Math.hypot(coord.x - WORLD_COORD_LIMITS.center, coord.y - WORLD_COORD_LIMITS.center);
    // Deterministic rand stubs pick different slots on the SAME outer ring.
    const low = assignOuterRingCoord([], () => 0);
    const high = assignOuterRingCoord([], () => 0.999);
    expect(near(low)).toBeCloseTo(outerRadius, 0);
    expect(near(high)).toBeCloseTo(outerRadius, 0);
    expect(low).not.toEqual(high); // random angle, not always slot[0]
    // Never returns an occupied slot.
    const takenAll = slots.slice(0, 50);
    const next = assignOuterRingCoord(takenAll, () => 0);
    expect(takenAll.some((c) => c.x === next.x && c.y === next.y)).toBe(false);
  });
});
