import { describe, expect, it } from "vitest";
import { DORMANT_AFTER_MS, VIEW_MAX_SPAN, assignOuterRingCoord, clampViewRect, dormantCandidates, outerRingSlots, WORLD_COORD_LIMITS } from "./world-coords";

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

describe("dormant map cleanup", () => {
  const now = 100 * DORMANT_AFTER_MS;
  const stale = now - DORMANT_AFTER_MS;
  it("releases only offline, two-week-stale cities at Core 5 or below", () => {
    const players = [
      { id: "small-stale", lastSeen: stale, keepLevel: 5 },
      { id: "no-presence", lastSeen: stale },
      { id: "big-stale", lastSeen: stale, keepLevel: 6 },
      { id: "small-recent", lastSeen: stale + 1, keepLevel: 2 },
      { id: "small-online", lastSeen: stale, keepLevel: 1 },
    ];
    expect(dormantCandidates(players, new Set(["small-online"]), now).map((player) => player.id)).toEqual(["small-stale", "no-presence"]);
  });
});

describe("map view rect (location privacy)", () => {
  it("normalizes, rejects junk and caps the span around the centre", () => {
    expect(clampViewRect({ x0: 50, y0: 40, x1: 10, y1: 20 })).toEqual({ x0: 10, y0: 20, x1: 50, y1: 40 });
    expect(clampViewRect({ x0: 0, y0: 0, x1: "a", y1: 5 })).toBeNull();
    expect(clampViewRect(null)).toBeNull();
    const wide = clampViewRect({ x0: 0, y0: 100, x1: 512, y1: 120 })!;
    expect(wide.x1 - wide.x0).toBe(VIEW_MAX_SPAN);
    expect((wide.x0 + wide.x1) / 2).toBe(256);
    expect(wide.y1 - wide.y0).toBe(20);
  });
});
