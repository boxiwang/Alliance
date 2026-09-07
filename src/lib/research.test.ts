import { beforeEach, describe, expect, it, vi } from "vitest";
import { initGame, migrateGame } from "./gamestore";
import {
  accountMarchCapacity, effectiveUpgradeTimeSec, healingDurationSec, hospitalCapacity, might,
  prodPerHour, project, startHealing, startResearch, startUpgrade, trainQueueSize,
  trainSpeedMult, worldMarchSlots,
} from "./game";
import {
  EMPTY_RESEARCH_QUEUE, RESEARCH_EFFECT_BRANCH, researchConfig, researchLevel, researchLevelRow,
  researchDurationSec, researchModifiers, researchTechs, researchTreeLayers,
} from "./research";
import { defaultN } from "./numbers";
import { validateNumbers } from "./validation";
import { advanceLocalWorldSession, createLocalWorldSession } from "./world-adapter";
import { dispatchMarch } from "./world-engine";
import { resolveCombat, resolveGather } from "./expedition";

describe("Academy research", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-06T12:00:00Z"));
  });

  it("contains the complete Kingshot-shaped three-tree ladder", () => {
    expect(researchTechs("development")).toHaveLength(45);
    expect(researchTechs("economy")).toHaveLength(36);
    expect(researchTechs("battle")).toHaveLength(102);
    expect(Object.keys(researchConfig().techs)).toHaveLength(183);
    expect(researchConfig().branches.development.totals.levels).toBe(129);
    expect(researchConfig().branches.battle.totals.levels).toBe(459);
    expect(validateNumbers(defaultN()).filter((issue) => issue.path.startsWith("research"))).toEqual([]);
  });

  it("explicitly categorizes every one of the 696 levels and registers every effect", () => {
    const seen = new Set<string>();
    for (const tech of researchTechs()) {
      expect(["development", "economy", "battle"]).toContain(tech.branch);
      for (let level = 1; level <= tech.maxLevel; level += 1) {
        const row = researchLevelRow(tech.key, level);
        expect(row.category).toBe(tech.branch);
        expect(RESEARCH_EFFECT_BRANCH[row.effect.key as keyof typeof RESEARCH_EFFECT_BRANCH]).toBe(tech.branch);
        seen.add(row.effect.key);
      }
    }
    expect([...seen].sort()).toEqual(Object.keys(RESEARCH_EFFECT_BRANCH).sort());
  });

  it("places every prerequisite above its dependent node in all three visual trees", () => {
    for (const branch of ["development", "economy", "battle"] as const) {
      const layers = researchTreeLayers(branch);
      const depthByKey = new Map(layers.flatMap((layer, depth) => layer.map((tech) => [tech.key, depth] as const)));
      expect(depthByKey.size).toBe(researchTechs(branch).length);
      for (const tech of researchTechs(branch)) {
        for (const requirement of tech.requirements ?? []) {
          expect(depthByKey.get(requirement.tech)).toBeLessThan(depthByKey.get(tech.key)!);
        }
      }
    }
  });

  it("enforces Academy level, prerequisites, resources and one queue", () => {
    const game = initGame("0xresearch");
    game.buildings.academy.lvl = 1;
    game.res = { cash: 100_000, oil: 100_000, power: 100_000 };

    const blocked = startResearch(game, "research.development.systemsOptimization.1");
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toContain("Rapid Construction I Lv.1");

    const started = startResearch(game, "research.development.rapidConstruction.1");
    expect(started.ok).toBe(true);
    expect(started.state.researchQueue.targetLevel).toBe(1);
    expect(startResearch(started.state, "research.economy.cashOutput.1").reason).toBe("Research queue busy");

    const finished = project(started.state, started.state.researchQueue.finishAt);
    expect(researchLevel(finished, "research.development.rapidConstruction.1")).toBe(1);
    expect(finished.researchQueue).toEqual(EMPTY_RESEARCH_QUEUE);
    expect(startResearch(finished, "research.development.systemsOptimization.1").ok).toBe(true);
  });

  it("applies completed development and economy effects to live city math", () => {
    const game = initGame("0xmodifiers");
    game.buildings.bank.lvl = 1;
    const baseProduction = prodPerHour(game).cash;
    const baseQueue = trainQueueSize(game, "army");
    game.research["research.economy.cashOutput.1"] = 3;
    game.research["research.development.mobilizationCapacity.1"] = 3;

    expect(prodPerHour(game).cash).toBeCloseTo(baseProduction * 1.05);
    expect(trainQueueSize(game, "army")).toBe(baseQueue + 7);
    expect(researchModifiers(game).cashProductionBonus).toBeCloseTo(0.05);
  });

  it("turns all three Command Tactics milestones into real account march queues", () => {
    const numbers = structuredClone(defaultN());
    numbers.world.population.localNpcCities = 0;
    numbers.world.population.minimumResourceFields = 0;
    numbers.world.population.minimumMonsters = 0;
    const game = initGame("0xqueues");
    game.troops.army["1"] = 10;
    game.lastTick = Date.now();
    const base = createLocalWorldSession(game.address, game, Date.now(), numbers);
    expect(base.session.world.players[base.session.playerId].marchSlots).toBe(2);

    game.research["research.development.commandTactics.1"] = 1;
    game.research["research.development.commandTactics.2"] = 1;
    game.research["research.development.commandTactics.3"] = 1;
    expect(worldMarchSlots(game, numbers)).toBe(5);
    const updated = advanceLocalWorldSession(base.session, game, Date.now() + 1, numbers);
    expect(updated.session.world.players[updated.session.playerId].marchSlots).toBe(5);
    expect(updated.session.world.players[updated.session.playerId].accountModifiers.marchQueueBonus).toBe(3);

    const target = Object.values(updated.session.world.entities).find((entity) => entity.kind === "resource");
    expect(target).toBeDefined();
    let world = updated.session.world;
    for (let index = 0; index < 5; index += 1) {
      const result = dispatchMarch(world, {
        playerId: updated.session.playerId,
        targetId: target!.id,
        action: "gather",
        force: { army: { "1": 1 } },
        idempotencyKey: `five-queues-${index}`,
      }, Date.now(), numbers);
      expect(result.ok).toBe(true);
      world = result.world;
    }
    const sixth = dispatchMarch(world, {
      playerId: updated.session.playerId,
      targetId: target!.id,
      action: "gather",
      force: { army: { "1": 1 } },
      idempotencyKey: "sixth-queue",
    }, Date.now(), numbers);
    expect(sixth.ok).toBe(false);
    if (sixth.ok === false) expect(sixth.error).toBe("march_slots_full");
  });

  it("applies Hospital capacity and healing-speed research to recover the original troop tiers", () => {
    const game = initGame("0xhealing");
    game.buildings.keep.lvl = 30;
    game.buildings.storage.lvl = 30;
    game.buildings.hospital.lvl = 3;
    game.res = { cash: 1_000_000, oil: 1_000_000, power: 1_000_000 };
    game.woundedTroops.army["3"] = 100;
    game.wounded = 100;
    const unresearchedDuration = healingDurationSec(game, 100);
    const unresearchedCapacity = hospitalCapacity(game);
    game.research["research.development.emergencyTreatment.1"] = 3;
    game.research["research.development.medicalExpansion.1"] = 3;
    expect(healingDurationSec(game, 100)).toBeLessThan(unresearchedDuration);
    expect(hospitalCapacity(game)).toBeGreaterThan(unresearchedCapacity);

    const beforeMight = might(game);
    const started = startHealing(game, 100);
    expect(started.ok).toBe(true);
    expect(startUpgrade(started.state, "hospital").reason).toContain("Finish current healing");
    const finished = project(started.state, started.state.healing.finishAt);
    expect(finished.wounded).toBe(0);
    expect(finished.woundedTroops.army["3"]).toBe(0);
    expect(finished.troops.army["3"]).toBe(100);
    expect(might(finished)).toBeGreaterThan(beforeMight);

    const upgrading = structuredClone(game);
    upgrading.buildings.hospital.finishAt = Date.now() + 60_000;
    expect(startHealing(upgrading, 100).reason).toBe("Hospital is upgrading");
  });

  it("feeds a fully researched account into every current city, gathering and combat calculator", () => {
    const game = initGame("0xmax-research");
    game.buildings.keep.lvl = 30;
    game.buildings.storage.lvl = 30;
    game.buildings.armyCamp.lvl = 30;
    game.buildings.navalBase.lvl = 30;
    game.buildings.airfield.lvl = 30;
    game.buildings.hospital.lvl = 30;
    const base = structuredClone(game);
    for (const tech of researchTechs()) game.research[tech.key] = tech.maxLevel;
    const modifiers = researchModifiers(game);
    Object.keys(RESEARCH_EFFECT_BRANCH).forEach((key) => expect(modifiers[key]).toBeGreaterThan(0));

    expect(effectiveUpgradeTimeSec(game, "bank", 2)).toBeLessThan(effectiveUpgradeTimeSec(base, "bank", 2));
    expect(researchDurationSec(game, "research.economy.cashOutput.1", 1)).toBeLessThan(researchDurationSec(base, "research.economy.cashOutput.1", 1));
    expect(trainQueueSize(game, "army")).toBeGreaterThan(trainQueueSize(base, "army"));
    expect(trainSpeedMult(game, "army")).toBeGreaterThan(trainSpeedMult(base, "army"));
    expect(accountMarchCapacity(game)).toBeGreaterThan(accountMarchCapacity(base));

    for (const resource of ["cash", "oil", "power"] as const) {
      const untuned = structuredClone(defaultN());
      const tuned = structuredClone(defaultN());
      tuned.runtimeAccountModifiers = modifiers;
      const node = { kind: "node" as const, level: 1, resource, remaining: 1_000 };
      expect(resolveGather(node, 1_000, tuned).tripTimeSec).toBeLessThan(resolveGather(node, 1_000, untuned).tripTimeSec);
    }

    const force = { army: { "10": 100 }, navy: { "10": 100 }, air: { "10": 100 } };
    const monster = { kind: "monster" as const, level: 1, power: 10_000, reward: {} };
    const baseNumbers = structuredClone(defaultN());
    const attackNumbers = structuredClone(defaultN());
    attackNumbers.runtimeAccountModifiers = modifiers;
    expect(resolveCombat({ troops: force }, monster, attackNumbers).ap).toBeGreaterThan(resolveCombat({ troops: force }, monster, baseNumbers).ap);

    const defenderBase = { kind: "rival" as const, keepLevel: 30, wallLevel: 30, hospitalLevel: 30, troops: force };
    const defenderResearched = { ...defenderBase, accountModifiers: modifiers };
    expect(resolveCombat({ troops: force }, defenderResearched, baseNumbers).dp).toBeGreaterThan(resolveCombat({ troops: force }, defenderBase, baseNumbers).dp);
  });

  it("stores explicit cost, time, effect and Academy gates at every level", () => {
    for (const tech of researchTechs()) {
      for (let level = 1; level <= tech.maxLevel; level += 1) {
        const row = researchLevelRow(tech.key, level);
        expect(row.academyLevel).toBeGreaterThanOrEqual(1);
        expect(row.academyLevel).toBeLessThanOrEqual(30);
        expect(row.timeSec).toBeGreaterThan(0);
        expect(row.cost["res.cash"]).toBeGreaterThan(0);
        expect(row.cost["res.oil"]).toBeGreaterThan(0);
        expect(row.cost["res.power"]).toBeGreaterThan(0);
        expect(row.effect.value).toBeGreaterThan(0);
      }
    }
  });

  it("migrates old saves to an empty safe queue without losing the city", () => {
    const old = initGame("0xold-research") as any;
    delete old.research;
    delete old.researchQueue;
    old.buildings.keep.lvl = 12;
    const migrated = migrateGame(old, old.address);
    expect(migrated.buildings.keep.lvl).toBe(12);
    expect(migrated.research).toEqual({});
    expect(migrated.researchQueue).toEqual(EMPTY_RESEARCH_QUEUE);
  });
});
