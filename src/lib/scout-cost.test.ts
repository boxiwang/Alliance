import { describe, expect, it } from "vitest";
import defaults from "../../docs/numbers.json";
import { prodPerHour } from "./game";
import { initGame } from "./gamestore";
import { scoutOilCost } from "./scout-cost";

describe("scout oil cost", () => {
  const n = structuredClone(defaults) as any;
  const game = initGame("0xscout");
  const perHour = prodPerHour(game).oil;

  it("costs 4 minutes of Oil production nearby, one more minute per 150 tiles", () => {
    expect(scoutOilCost(game, 0, n)).toBe(Math.max(30, Math.ceil(perHour * 4 / 60)));
    expect(scoutOilCost(game, 300, n)).toBe(Math.max(30, Math.ceil(perHour * 6 / 60)));
  });

  it("caps at 12 minutes of production however far the target is", () => {
    expect(scoutOilCost(game, 5000, n)).toBe(Math.max(30, Math.ceil(perHour * 12 / 60)));
  });

  it("never drops below the minimum, even with no Oil production", () => {
    const idle = initGame("0xidle");
    idle.buildings.oilwell.lvl = 0;
    expect(scoutOilCost(idle, 40, n)).toBe(30);
  });

  it("stays a small share of hourly Oil output at a typical distance", () => {
    expect(scoutOilCost(game, 40, n) / Math.max(1, perHour)).toBeLessThan(0.1);
  });
});
