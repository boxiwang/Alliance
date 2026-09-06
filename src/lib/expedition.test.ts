import { describe, expect, it } from "vitest";
import defaults from "../../docs/numbers.json";
import {
  carryCapacity,
  counterMultiplier,
  Force,
  isShielded,
  marchTimeSec,
  MonsterTarget,
  NodeTarget,
  resolveCombat,
  resolveGather,
  RivalTarget,
} from "./expedition";

const N: any = defaults;

function force(overrides: Partial<Force["troops"]> = {}): Force {
  return {
    troops: {
      army: {},
      navy: {},
      air: {},
      ...overrides,
    } as Force["troops"],
  };
}

describe("expedition — march & carry", () => {
  it("march time = distance x base travel seconds per tile", () => {
    expect(marchTimeSec(5, N)).toBe(5 * N.global.march.baseTravelSecondsPerTile);
    expect(marchTimeSec(0, N)).toBe(0);
  });

  it("automatically applies the account-wide march speed bonus", () => {
    const tuned = structuredClone(N);
    tuned.global.accountModifiers.marchSpeedBonus = 0.25;
    expect(marchTimeSec(5, tuned)).toBeCloseTo(marchTimeSec(5, N) / 1.25);
  });

  it("carry capacity = sum of troop load across arms/tiers", () => {
    const armyT1Load = N.troops["troop.army"].tiers["1"].load;
    const navyT1Load = N.troops["troop.navy"].tiers["1"].load;
    const f = force({ army: { "1": 10 }, navy: { "1": 5 } });
    const expected = 10 * armyT1Load + 5 * navyT1Load + (N.gatherNodes.heroCarryBonus ?? 0);
    expect(carryCapacity(f, N)).toBe(expected);
  });

  it("adds hero carry bonus hooks (default 0) on top of troop load", () => {
    const armyT1Load = N.troops["troop.army"].tiers["1"].load;
    const f: Force = { troops: { army: { "1": 4 }, navy: {}, air: {} }, heroCarry: 50 };
    expect(carryCapacity(f, N)).toBe(4 * armyT1Load + 50 + (N.gatherNodes.heroCarryBonus ?? 0));
  });

  it("automatically applies the account-wide load bonus", () => {
    const tuned = structuredClone(N);
    tuned.global.accountModifiers.loadBonus = 0.5;
    expect(carryCapacity(force({ army: { "1": 10 } }), tuned)).toBeCloseTo(carryCapacity(force({ army: { "1": 10 } }), N) * 1.5);
  });
});

describe("expedition — counter matrix", () => {
  it("air beats army for +10% attack", () => {
    expect(counterMultiplier("air", "army", N)).toBeCloseTo(1 + N.global.combat.counterBonusAtk);
  });
  it("army beats navy for +10% attack", () => {
    expect(counterMultiplier("army", "navy", N)).toBeCloseTo(1 + N.global.combat.counterBonusAtk);
  });
  it("navy beats air for +10% attack", () => {
    expect(counterMultiplier("navy", "air", N)).toBeCloseTo(1 + N.global.combat.counterBonusAtk);
  });
  it("gives no bonus for every non-countering matchup", () => {
    expect(counterMultiplier("army", "air", N)).toBe(1);
    expect(counterMultiplier("navy", "army", N)).toBe(1);
    expect(counterMultiplier("air", "navy", N)).toBe(1);
    expect(counterMultiplier("army", "army", N)).toBe(1);
  });
  it("gives no bonus against an undefined dominant arm (e.g. a monster)", () => {
    expect(counterMultiplier("air", undefined, N)).toBe(1);
  });
});

describe("expedition — gathering", () => {
  const node: NodeTarget = { kind: "node", level: 1, resource: "cash", remaining: 500 };
  const rate = N.gatherNodes.levels["1"].gatherRatePerHour;

  it("hauls min(carry, remaining)", () => {
    const small = resolveGather(node, 100, N);
    expect(small.hauled).toBe(100);
    expect(small.remainingAfter).toBe(400);

    const big = resolveGather(node, 10000, N);
    expect(big.hauled).toBe(500);
    expect(big.remainingAfter).toBe(0);
  });

  it("trip time scales inversely with gather rate", () => {
    const lvl1 = resolveGather({ ...node, level: 1 }, 100, N);
    const lvl10 = resolveGather({ ...node, level: 10, remaining: 100000 }, 100, N);
    const rate10 = N.gatherNodes.levels["10"].gatherRatePerHour;
    expect(lvl1.tripTimeSec).toBeCloseTo((100 / (rate * 1)) * 3600);
    expect(lvl10.tripTimeSec).toBeCloseTo((100 / (rate10 * 1)) * 3600);
    expect(lvl10.tripTimeSec).toBeLessThan(lvl1.tripTimeSec);
  });

  it("automatically applies the account-wide gather speed bonus", () => {
    const tuned = structuredClone(N);
    tuned.global.accountModifiers.gatherSpeedBonus = 0.5;
    const noBonus = resolveGather(node, 100, N);
    const withBonus = resolveGather(node, 100, tuned);
    expect(withBonus.tripTimeSec).toBeCloseTo(noBonus.tripTimeSec / 1.5);
  });

  it("uses hauled amount, not unused load, to time a depleted node", () => {
    const result = resolveGather(node, 10000, N);
    expect(result.tripTimeSec).toBeCloseTo((node.remaining / rate) * 3600);
  });
});

describe("expedition — combat", () => {
  function rival(overrides: Partial<RivalTarget> = {}): RivalTarget {
    return {
      kind: "rival",
      keepLevel: 5,
      wallLevel: 1,
      hospitalLevel: 1,
      troops: { army: {}, navy: {}, air: {} },
      ...overrides,
    };
  }

  it("loot is capped by BOTH attacker carry and unprotected x lootRate", () => {
    const bigStorageLevel = 10;
    const storageCap = N.buildings["building.storage"].levels[String(bigStorageLevel)].capacityPerResource;
    const protectedFraction = N.buildings["building.storage"].protectedFraction;
    const target = rival({
      keepLevel: 0,
      wallLevel: 0,
      storageLevel: bigStorageLevel,
      resources: { cash: storageCap * 5, oil: 0, power: 0 }, // lots of unprotected cash
      troops: { army: { "1": 1 }, navy: {}, air: {} },
    });

    // Small attacker: carry is the binding constraint.
    const smallAttacker = force({ air: { "1": 1 } }); // tiny carry; air counters the lone army defender
    const smallResult = resolveCombat(smallAttacker, target, N);
    expect(smallResult.loot).toBeCloseTo(carryCapacity(smallAttacker, N));

    // Huge attacker: unprotected x lootRate becomes the binding constraint.
    const hugeAttacker = force({ army: { "10": 100000 } });
    const unprotected = Math.max(0, storageCap * 5 - storageCap * protectedFraction);
    const hugeResult = resolveCombat(hugeAttacker, target, N);
    expect(hugeResult.loot).toBeCloseTo(unprotected * N.global.combat.lootRate);
    expect(hugeResult.loot).toBeLessThan(carryCapacity(hugeAttacker, N));
  });

  it("never awards loot when the attacker loses", () => {
    const target = rival({ resources: { cash: 999999 }, troops: { army: { "10": 100000 }, navy: {}, air: {} } });
    const result = resolveCombat(force({ army: { "1": 1 } }), target, N);
    expect(result.win).toBe(false);
    expect(result.loot).toBe(0);
  });

  it("splits casualties into wounded (up to hospital cap) then dead", () => {
    // A defender with a tiny hospital and a garrison big enough to overflow it heavily.
    const hospLevel = 1;
    const hospitalCap = N.buildings["building.hospital"].levels[String(hospLevel)].woundedCapacity;
    const target = rival({
      hospitalLevel: hospLevel,
      wallLevel: 1,
      keepLevel: 1,
      troops: { army: { "1": 100000 }, navy: {}, air: {} }, // huge garrison, will lose big
    });
    const attacker = force({ air: { "10": 500000 } }); // overwhelming attacker force

    const result = resolveCombat(attacker, target, N);
    expect(result.win).toBe(true);
    expect(result.defenderLosses.wounded).toBeLessThanOrEqual(hospitalCap);
    expect(result.defenderLosses.wounded).toBe(hospitalCap);
    expect(result.defenderLosses.dead).toBeGreaterThan(0);
  });

  it("gives the attacker 0 wounded by default (no hospital while marching)", () => {
    const target = rival({ troops: { army: { "1": 500000 }, navy: {}, air: {} }, wallLevel: 1, keepLevel: 1, hospitalLevel: 1 });
    const attacker = force({ army: { "1": 10 } }); // weak attacker, will lose
    const result = resolveCombat(attacker, target, N);
    expect(result.win).toBe(false);
    expect(result.attackerLosses.wounded).toBe(0);
  });

  it("gives a defense-favored monster no counter bonus regardless of attacker arm", () => {
    const monster: MonsterTarget = { kind: "monster", level: 3, power: 10, reward: { cash: 100 } };
    const attacker = force({ air: { "1": 5 } });
    const result = resolveCombat(attacker, monster, N);
    expect(result.dp).toBe(10);
  });

  it("automatically applies the attack modifier to the dispatched account", () => {
    const tuned = structuredClone(N);
    tuned.global.accountModifiers.troopAttackBonus = 0.2;
    const monster: MonsterTarget = { kind: "monster", level: 1, power: 100, reward: {} };
    const attacker = force({ army: { "1": 10 } });
    expect(resolveCombat(attacker, monster, tuned).ap).toBeCloseTo(resolveCombat(attacker, monster, N).ap * 1.2);
  });
});

describe("expedition — shield", () => {
  it("blocks attacks below the protected keep level while the rival hasn't attacked", () => {
    expect(isShielded({ keepLevel: 5, hasAttacked: false }, N)).toBe(true);
    expect(isShielded({ keepLevel: 9, hasAttacked: false }, N)).toBe(true);
  });
  it("does not shield once the rival has attacked, even below the keep threshold", () => {
    expect(isShielded({ keepLevel: 5, hasAttacked: true }, N)).toBe(false);
  });
  it("does not shield once the rival's keep is at/above protectedUntilKeepLevel", () => {
    expect(isShielded({ keepLevel: N.global.shield.protectedUntilKeepLevel, hasAttacked: false }, N)).toBe(false);
  });
});
