import { describe, expect, it } from "vitest";
import { autoSpeedupCount, autoSpeedupPick, type OwnedSpeedup } from "./speedup-pick";

const bag = (overrides: Partial<Record<string, number>> = {}): OwnedSpeedup[] => [
  { id: "u.1m", seconds: 60, universal: true, owned: overrides["u.1m"] ?? 20 },
  { id: "u.5m", seconds: 300, universal: true, owned: overrides["u.5m"] ?? 20 },
  { id: "u.1h", seconds: 3600, universal: true, owned: overrides["u.1h"] ?? 2 },
  { id: "c.5m", seconds: 300, universal: false, owned: overrides["c.5m"] ?? 0 },
];

describe("speedup auto-pick", () => {
  it("picks the largest speedup that fits the time left (1h05m -> one 1h)", () => {
    expect(autoSpeedupPick(bag(), 65 * 60)).toEqual({ id: "u.1h", quantity: 1 });
  });

  it("switching to 5m fills the time left without going over (1h05m -> 13)", () => {
    expect(autoSpeedupCount({ seconds: 300, owned: 20 }, 65 * 60)).toBe(13);
    expect(autoSpeedupCount({ seconds: 300, owned: 5 }, 65 * 60)).toBe(5);
  });

  it("steps down after each use (1h06m: 1h, then 5m, then 1m)", () => {
    let left = 66 * 60;
    const picks: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      const pick = autoSpeedupPick(bag(), left)!;
      picks.push(`${pick.id}x${pick.quantity}`);
      left -= ({ "u.1m": 60, "u.5m": 300, "u.1h": 3600 } as Record<string, number>)[pick.id] * pick.quantity;
    }
    expect(picks).toEqual(["u.1hx1", "u.5mx1", "u.1mx1"]);
    expect(left).toBe(0);
  });

  it("prefers a queue-specific speedup over a Universal of the same size", () => {
    expect(autoSpeedupPick(bag({ "u.1h": 0, "c.5m": 3 }), 12 * 60)).toEqual({ id: "c.5m", quantity: 2 });
  });

  it("uses the smallest owned speedup when every one is longer than the time left", () => {
    expect(autoSpeedupPick(bag({ "u.1m": 0 }), 30)).toEqual({ id: "u.5m", quantity: 1 });
  });

  it("has nothing to pick with no items or no time left", () => {
    expect(autoSpeedupPick(bag({ "u.1m": 0, "u.5m": 0, "u.1h": 0 }), 600)).toBeNull();
    expect(autoSpeedupPick(bag(), 0)).toBeNull();
  });
});
