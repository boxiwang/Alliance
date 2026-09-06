import { describe, expect, it } from "vitest";
import defaults from "../../docs/numbers.json";
import { simulateWorldBalance, worldBalanceSummary } from "./world-balance";
import { worldEngineConfig } from "./world-engine";

describe("Personal World balance scenarios", () => {
  it("keeps every reference PvE and gathering stage inside its declared target band", () => {
    const report = simulateWorldBalance(defaults);
    expect(report.issues).toEqual([]);
    report.stages.forEach((stage) => {
      expect(stage.weakWinRatio).toBeLessThan(.5);
      expect(stage.standardWinRatio).toBeGreaterThanOrEqual(defaults.world.balanceTargets.standardPveWinRatioMin);
      expect(stage.standardWinRatio).toBeLessThanOrEqual(defaults.world.balanceTargets.standardPveWinRatioMax);
      expect(stage.strongWinRatio).toBeGreaterThan(.5);
      expect(stage.gatherHours).toBeGreaterThanOrEqual(defaults.world.balanceTargets.fullNodeGatherHoursMin);
      expect(stage.gatherHours).toBeLessThanOrEqual(defaults.world.balanceTargets.fullNodeGatherHoursMax);
    });
  });

  it("keeps equal-progression city attacks consistently defender-favored", () => {
    const report = simulateWorldBalance(defaults);
    report.pvp.forEach((stage) => {
      expect(stage.attackerWins).toBe(false);
      expect(stage.attackerWinRatio).toBeGreaterThanOrEqual(defaults.world.balanceTargets.equalPvpAttackerWinRatioMin);
      expect(stage.attackerWinRatio).toBeLessThanOrEqual(defaults.world.balanceTargets.equalPvpAttackerWinRatioMax);
    });
  });

  it("reads every World engine knob from the shared numbers file", () => {
    const numbers: any = structuredClone(defaults);
    numbers.world.state.width = 640;
    numbers.world.lifecycle.monsterRespawnSec = 777;
    numbers.world.energy.monsterAttackCost = 13;
    numbers.world.cityCombat.minimumWallDamageOnWin = 222;
    numbers.global.march.marchQueueSlots = 4;
    const config = worldEngineConfig(numbers);
    expect(config.width).toBe(640);
    expect(config.monsterRespawnSec).toBe(777);
    expect(config.monsterEnergyCost).toBe(13);
    expect(config.minimumWallDamageOnWin).toBe(222);
    expect(config.marchSlots).toBe(4);
  });

  it("produces an operator-readable report", () => {
    const text = worldBalanceSummary(simulateWorldBalance(defaults));
    expect(text).toContain("PvE / gathering by monster level");
    expect(text).toContain("Equal-progression PvP");
    expect(text).toContain("Issues (0)");
  });
});
