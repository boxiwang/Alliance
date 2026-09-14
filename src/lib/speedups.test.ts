import { describe, expect, it } from "vitest";
import { initGame } from "./gamestore";
import { activeSpeedupTargets, applySpeedup, speedupCompatible } from "./speedups";

describe("server-ledger speedup effects", () => {
  it("reduces only the selected timer and completes through normal projection", () => {
    const now = 1_800_000_000_000;
    const game = initGame("0xtest");
    game.buildings.bank = { lvl: 1, finishAt: now + 240_000, durationSec: 240 };
    game.buildings.oilwell = { lvl: 1, finishAt: now + 600_000, durationSec: 600 };
    const result = applySpeedup(game, { kind: "construction", key: "bank" }, 300, now);
    expect(result.secondsApplied).toBe(240);
    expect(result.state.buildings.bank.lvl).toBe(2);
    expect(result.state.buildings.bank.finishAt).toBe(0);
    expect(result.state.buildings.oilwell.finishAt).toBe(now + 600_000);
  });

  it("lists every live queue and enforces specialist compatibility", () => {
    const game = initGame("0xtest");
    game.training.army.finishAt = Date.now() + 10_000;
    game.researchQueue = { tech: "x", targetLevel: 1, durationSec: 10, finishAt: Date.now() + 10_000 };
    const targets = activeSpeedupTargets(game);
    expect(targets.map((target) => target.kind)).toEqual(["training", "research"]);
    expect(speedupCompatible("universal", targets[0])).toBe(true);
    expect(speedupCompatible("research", targets[0])).toBe(false);
  });
});
