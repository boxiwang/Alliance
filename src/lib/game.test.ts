import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUILDING_ORDER,
  GameState,
  missingTownhallPrerequisites,
  might,
  mightBreakdown,
  maxTroopsForType,
  project,
  promotionBatchCost,
  promotionQueueSize,
  startPromote,
  startResearch,
  startTrain,
  startUpgrade,
  totalTroops,
  trainQueueSize,
  troopStats,
} from "./game";
import { initGame, migrateGame } from "./gamestore";

describe("solo game progression", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));
  });

  it("enforces Townhall prerequisites in game logic", () => {
    const game = richGame();
    game.buildings.keep.lvl = 2;

    const blocked = startUpgrade(game, "keep");
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe("Warehouse Lv.2 required");
    expect(missingTownhallPrerequisites(game, 3).map((item) => item.key)).toEqual(["storage", "bank"]);

    game.buildings.storage.lvl = 2;
    game.buildings.bank.lvl = 2;
    expect(startUpgrade(game, "keep").ok).toBe(true);
  });

  it("unlocks troop tiers from the matching training building, not Townhall", () => {
    const game = richGame();
    game.buildings.keep.lvl = 30;
    const locked = startTrain(game, "army", 2, 10);
    expect(locked.ok).toBe(false);
    expect(locked.reason).toBe("T2 requires Army Camp Lv.4");

    game.buildings.armyCamp.lvl = 4;
    const training = startTrain(game, "army", 2, 10);
    expect(training.ok).toBe(true);
    expect(training.state.training.army.tier).toBe(2);

    const finished = project(training.state, training.state.training.army.finishAt);
    expect(finished.troops.army["2"]).toBe(10);
    expect(totalTroops(finished)).toBe(10);
    expect(might(finished)).toBeGreaterThan(might(game));
  });

  it("migrates old numeric troop saves to T1 without losing progress", () => {
    const old = initGame("0xold") as any;
    old.troops = { army: 17, navy: 4, air: 2 };
    delete old.buildings.armyCamp;
    delete old.buildings.navalBase;
    delete old.buildings.airfield;
    delete old.training;
    old.buildings.barracks = { lvl: 7, finishAt: 0 };
    old.train = { type: "navy", qty: 3, per: 9, finishAt: 12345 };
    old.wounded = 6;
    delete old.woundedTroops;
    delete old.healing;

    const migrated = migrateGame(old, "0xold");
    expect(migrated.troops.army["1"]).toBe(17);
    expect(migrated.troops.navy["1"]).toBe(4);
    expect(migrated.troops.air["1"]).toBe(2);
    expect(migrated.buildings.armyCamp.lvl).toBe(7);
    expect(migrated.buildings.navalBase.lvl).toBe(7);
    expect(migrated.buildings.airfield.lvl).toBe(7);
    expect(migrated.training.navy.tier).toBe(1);
    expect(migrated.training.navy.qty).toBe(3);
    expect(migrated.woundedTroops.army["1"]).toBe(6);
    expect(migrated.wounded).toBe(6);
    expect(totalTroops(migrated)).toBe(23);
  });

  it("runs Army and Navy training in independent queues", () => {
    const game = richGame();
    game.buildings.navalBase.lvl = 1;

    const army = startTrain(game, "army", 1, 5);
    expect(army.ok).toBe(true);
    const navy = startTrain(army.state, "navy", 1, 5);
    expect(navy.ok).toBe(true);
    expect(navy.state.training.army.finishAt).toBeGreaterThan(Date.now());
    expect(navy.state.training.navy.finishAt).toBeGreaterThan(Date.now());
  });

  it("hard-locks an operating building against upgrades in both directions", () => {
    const game = richGame();
    game.buildings.keep.lvl = 30;
    game.buildings.armyCamp.lvl = 4;
    game.buildings.academy.lvl = 4;

    const training = startTrain(game, "army", 2, 5);
    expect(training.ok).toBe(true);
    expect(startUpgrade(training.state, "armyCamp").reason).toContain("Finish current training");

    const upgradingCamp = structuredClone(game);
    upgradingCamp.buildings.armyCamp.finishAt = Date.now() + 60_000;
    expect(startTrain(upgradingCamp, "army", 2, 5).reason).toBe("Army Camp is upgrading");

    const research = startResearch(game, "research.development.rapidConstruction.1");
    expect(research.ok).toBe(true);
    expect(startUpgrade(research.state, "academy").reason).toContain("Finish current research");

    const upgradingAcademy = structuredClone(game);
    upgradingAcademy.buildings.academy.finishAt = Date.now() + 60_000;
    expect(startResearch(upgradingAcademy, "research.development.rapidConstruction.1").reason).toBe("Research Institute is upgrading");
  });

  it("promotes existing troops for the Kingshot-style cost/time difference", () => {
    const game = richGame();
    game.buildings.keep.lvl = 30;
    game.buildings.armyCamp.lvl = 30;
    game.buildings.storage.lvl = 30;
    game.res = { cash: 1_000_000, oil: 1_000_000, power: 1_000_000 };
    game.troops.army["9"] = 100;
    const beforeMight = might(game);
    const fullT10Cost = troopStats("army", 10)!.cost;
    const difference = promotionBatchCost("army", 9, 10, 10);

    expect(difference.cash).toBe(((fullT10Cost.cash ?? 0) - (troopStats("army", 9)!.cost.cash ?? 0)) * 10);
    expect(promotionQueueSize(game, "army", 9, 10)).toBeGreaterThan(209);

    const promoted = startPromote(game, "army", 9, 10, 10);
    expect(promoted.ok).toBe(true);
    expect(promoted.state.training.army.mode).toBe("promote");
    expect(promoted.state.troops.army["9"]).toBe(90);
    expect(might(promoted.state)).toBeLessThan(beforeMight);

    const finished = project(promoted.state, promoted.state.training.army.finishAt);
    expect(finished.troops.army["9"]).toBe(90);
    expect(finished.troops.army["10"]).toBe(10);
    expect(might(finished) - beforeMight).toBe(10 * 1000 * (troopStats("army", 10)!.power - troopStats("army", 9)!.power));
  });

  it("uses the Kingshot barracks unlock and batch-capacity ladder", () => {
    const game = richGame();
    game.buildings.armyCamp.lvl = 1;
    expect(trainQueueSize(game, "army")).toBe(17);
    game.buildings.armyCamp.lvl = 30;
    expect(trainQueueSize(game, "army")).toBe(209);
    expect(Array.from({ length: 10 }, (_, index) => troopStats("army", index + 1)!.unlockAtTrainingBuilding)).toEqual([1, 4, 7, 11, 13, 16, 19, 22, 26, 30]);
  });

  it("exposes all ten configured troop tiers", () => {
    for (let tier = 1; tier <= 10; tier += 1) {
      expect(troopStats("army", tier)?.tier).toBe(tier);
    }
  });

  it("targets a troop-heavy Might mix for a mature city", () => {
    const game = richGame();
    BUILDING_ORDER.forEach((key) => {
      if (key !== "milestone") game.buildings[key].lvl = 30;
    });
    for (const type of ["army", "navy", "air"] as const) {
      game.troops[type]["10"] = Math.round(maxTroopsForType(game, type) * 0.6);
    }

    const breakdown = mightBreakdown(game);
    const infrastructureShare = breakdown.infrastructure / breakdown.total;
    expect(infrastructureShare).toBeGreaterThanOrEqual(0.2);
    expect(infrastructureShare).toBeLessThanOrEqual(0.3);
  });
});

function richGame(): GameState {
  const game = initGame("0xtest");
  game.lastTick = Date.now();
  game.res = { cash: 5000, oil: 5000, power: 5000 };
  BUILDING_ORDER.forEach((key) => { game.buildings[key].finishAt = 0; });
  return game;
}
