import { describe, expect, it } from "vitest";
import { initGame } from "../src/lib/gamestore";
import { applyCommand } from "./commands";

describe("authoritative game commands", () => {
  it("applies build.start with the shared reducer", () => {
    const game = initGame("0x0000000000000000000000000000000000000abc");
    game.res = { cash: 5_000, oil: 5_000, power: 5_000 };
    game.buildings.keep.lvl = 2;
    const result = applyCommand(game, "build.start", { building: "bank" });
    expect(result.ok).toBe(true);
    expect(result.state.buildings.bank.finishAt).toBeGreaterThan(0);
    expect(result.state.res.cash).toBeLessThan(game.res.cash);
  });

  it("rejects unknown buildings without mutating the input", () => {
    const game = initGame("0x0000000000000000000000000000000000000abc");
    const before = JSON.stringify(game);
    const result = applyCommand(game, "build.start", { building: "wallet-drain" });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("Unknown building");
    expect(JSON.stringify(game)).toBe(before);
  });

  it("rejects unknown command types", () => {
    const game = initGame("0x0000000000000000000000000000000000000abc");
    expect(applyCommand(game, "admin.credit", {}).ok).toBe(false);
  });
});
