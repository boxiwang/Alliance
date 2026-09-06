// Outdoor expedition engine — PURE functions, no UI/render, no persistence.
// Bible §22 (sys.expedition, added v0.8): send troops to a world target → march time by
// distance → resolve (scout / gather / combat) → return. Tasks 2+3 = exploration/combat +
// gathering. Keyed to docs/numbers.json → global.combat / global.march / global.shield /
// world / gatherNodes / troops.*.tiers / buildings.building.wall|hospital|storage.
//
// Follows simulator.ts's style: every exported function takes a `numbers: any` parameter
// (default = the live getN()) so tests/UI can inject a fixture or an admin-tuned override.
import { getN } from "./numbers";
import { TroopKey, TROOP_ORDER, troopTierRow, buildingLevelRow } from "./game";

export type TargetKind = "monster" | "node" | "rival";
export type ResKey = "cash" | "oil" | "power";

/** A world target holding troops behind a Townhall — the async-PvP "other player" case. */
export interface RivalTarget {
  kind: "rival";
  keepLevel: number;
  wallLevel: number;
  hospitalLevel: number;
  troops: Record<TroopKey, Record<string, number>>; // arm -> tier -> count, mirrors GameState.troops
  resources?: Partial<Record<ResKey, number>>;
  storageLevel?: number; // building.storage level backing resources' protection
  protectedFraction?: number; // override for building.storage.protectedFraction, if provided
  hasAttacked?: boolean; // this rival has made an offensive move already (their own shield is down)
}

/** A leveled outdoor resource node (map.gather_node, numbers.json → gatherNodes). */
export interface NodeTarget {
  kind: "node";
  level: number; // 1-10, gatherNodes.levels key
  resource: ResKey; // a node yields ONE resource
  remaining: number; // resource units left before the node is depleted
}

/** A PvE target — no troops of its own, just a flat defense/power number and a reward. */
export interface MonsterTarget {
  kind: "monster";
  level: number;
  power: number; // stands in for DP in resolveCombat
  reward: Partial<Record<ResKey, number>>;
}

export type Target = RivalTarget | NodeTarget | MonsterTarget;

/** The troops (+ future hero hooks) a player sends out on an expedition. */
export interface Force {
  troops: Record<TroopKey, Record<string, number>>; // arm -> tier -> count
  heroCarry?: number; // hook for task 4, default 0
  heroAttackBonus?: number; // hook for task 4, default 0 — added flat onto AP once heroes exist
}

export interface ScoutReport {
  kind: TargetKind;
  level?: number;
  garrison?: number; // total troop count (rival) or flat power (monster)
  supply?: number; // remaining node supply
  estimatedLoot: number;
}

export interface CombatResult {
  win: boolean;
  ap: number;
  dp: number;
  winRatio: number;
  loot: number;
  attackerLosses: { wounded: number; dead: number };
  defenderLosses: { wounded: number; dead: number };
}

export interface GatherResult {
  hauled: number;
  tripTimeSec: number;
  remainingAfter: number;
}

function sumTroopCounts(troops: Record<TroopKey, Record<string, number>> | undefined): number {
  if (!troops) return 0;
  return TROOP_ORDER.reduce((sum, arm) => sum + Object.values(troops[arm] ?? {}).reduce((s, n) => s + (n || 0), 0), 0);
}

// --- march -------------------------------------------------------------

export function marchTimeSec(distanceTiles: number, numbers: any = getN()): number {
  return distanceTiles * numbers.global.march.baseTravelSecondsPerTile;
}

// --- carry / world helpers ----------------------------------------------

export function carryCapacity(force: Force, numbers: any = getN()): number {
  let load = 0;
  TROOP_ORDER.forEach((arm) => {
    const tiers = force.troops?.[arm] ?? {};
    for (const [tierText, count] of Object.entries(tiers)) {
      const row = troopTierRow(arm, Number(tierText));
      load += (count || 0) * (row?.load ?? 0);
    }
  });
  return load + (force.heroCarry ?? 0) + (numbers.gatherNodes?.heroCarryBonus ?? 0);
}

/** Concentric world: ring 10 = outer edge, ring 1 = center. Node/monster level ~= (rings+1-ring). */
export function nodeLevelForRing(ring: number, numbers: any = getN()): number {
  return (numbers.world.rings + 1) - ring;
}

export function gatherNodeLevelRow(level: number, numbers: any = getN()): any {
  return numbers.gatherNodes?.levels?.[String(level)] ?? null;
}

// --- gathering (task 3) ---------------------------------------------------

/**
 * academySpeedMult is clamped to [1, 1 + academyGatherSpeedMaxBonus] — Academy research is the
 * lever for gather speed (bible §22 / gatherNodes.note), so it can only ever help, never hurt.
 */
export function resolveGather(
  node: NodeTarget,
  carry: number,
  academySpeedMult = 1,
  numbers: any = getN(),
): GatherResult {
  const maxBonus = numbers.gatherNodes?.academyGatherSpeedMaxBonus ?? 0;
  const clampedMult = Math.min(1 + maxBonus, Math.max(1, academySpeedMult));
  const rate = gatherNodeLevelRow(node.level, numbers)?.gatherRatePerHour ?? 0;
  const hauled = Math.max(0, Math.min(carry, node.remaining));
  const tripTimeSec = rate > 0 ? (carry / (rate * clampedMult)) * 3600 : Number.POSITIVE_INFINITY;
  return {
    hauled,
    tripTimeSec,
    remainingAfter: Math.max(0, node.remaining - hauled),
  };
}

// --- scouting (task 2, action.scout — recon, no fog) -----------------------

function defenderUnprotectedTotal(defender: RivalTarget, numbers: any): number {
  if (!defender.resources) return 0;
  const protectedFraction = defender.protectedFraction ?? numbers.buildings?.["building.storage"]?.protectedFraction ?? 0;
  const storageCap = defender.storageLevel != null
    ? (buildingLevelRow("storage", defender.storageLevel)?.capacityPerResource ?? 0)
    : 0;
  const protectedPerResource = storageCap * protectedFraction;
  return Object.values(defender.resources).reduce((sum, amount) => sum + Math.max(0, (amount ?? 0) - protectedPerResource), 0);
}

export function resolveScout(target: Target, numbers: any = getN()): ScoutReport {
  if (target.kind === "rival") {
    const unprotected = defenderUnprotectedTotal(target, numbers);
    return {
      kind: "rival",
      level: target.keepLevel,
      garrison: sumTroopCounts(target.troops),
      estimatedLoot: unprotected * (numbers.global.combat.lootRate ?? 0),
    };
  }
  if (target.kind === "node") {
    return { kind: "node", level: target.level, supply: target.remaining, estimatedLoot: target.remaining };
  }
  const rewardTotal = Object.values(target.reward).reduce((sum, amount) => sum + (amount ?? 0), 0);
  return { kind: "monster", level: target.level, garrison: target.power, estimatedLoot: rewardTotal };
}

// --- combat (task 2) --------------------------------------------------------

export function counterMultiplier(attackerArm: TroopKey, defenderArm: TroopKey | undefined, numbers: any = getN()): number {
  const counter = numbers.global.combat.counter as Record<string, string>;
  if (defenderArm && counter[attackerArm] === defenderArm) return 1 + numbers.global.combat.counterBonusAtk;
  return 1;
}

export function isShielded(target: Pick<RivalTarget, "keepLevel" | "hasAttacked">, numbers: any = getN()): boolean {
  return target.keepLevel < numbers.global.shield.protectedUntilKeepLevel && !target.hasAttacked;
}

/** Arm with the most troops in a rival's garrison — stands in for "what this defense counters as". */
function dominantArm(troops: Record<TroopKey, Record<string, number>>): TroopKey | undefined {
  let best: TroopKey | undefined;
  let bestCount = 0;
  TROOP_ORDER.forEach((arm) => {
    const count = Object.values(troops[arm] ?? {}).reduce((s, n) => s + (n || 0), 0);
    if (count > bestCount) {
      bestCount = count;
      best = arm;
    }
  });
  return best;
}

function defensePower(defender: Target, numbers: any = getN()): { dp: number; dominant: TroopKey | undefined; totalTroops: number } {
  if (defender.kind === "monster") return { dp: defender.power, dominant: undefined, totalTroops: 0 };
  if (defender.kind === "node") return { dp: 0, dominant: undefined, totalTroops: 0 };
  let troopsDp = 0;
  TROOP_ORDER.forEach((arm) => {
    for (const [tierText, count] of Object.entries(defender.troops[arm] ?? {})) {
      const row = troopTierRow(arm, Number(tierText));
      troopsDp += (count || 0) * (row?.defense ?? 0);
    }
  });
  const wallDp = buildingLevelRow("wall", defender.wallLevel)?.defenseValue ?? 0;
  const keepDp = defender.keepLevel * (numbers.global.combat.keepDefenseBonusPerLevel ?? 0);
  return { dp: troopsDp + wallDp + keepDp, dominant: dominantArm(defender.troops), totalTroops: sumTroopCounts(defender.troops) };
}

function lossFraction(ownPower: number, enemyPower: number, casualtyScaling: number): number {
  const total = ownPower + enemyPower;
  return total > 0 ? casualtyScaling * (enemyPower / total) : 0;
}

/**
 * `total` casualties split wounded/dead: woundedRatio of casualties go to the Hospital, capped
 * at that side's woundedCapacity — anything past the cap (and the rest of the casualties, which
 * were never headed for the Hospital) is dead. See global.combat.woundedNote.
 */
function splitCasualties(total: number, woundedRatio: number, hospitalCapacity: number): { wounded: number; dead: number } {
  const casualties = Math.round(total);
  const woundedRequested = Math.floor(casualties * woundedRatio);
  const wounded = Math.max(0, Math.min(woundedRequested, hospitalCapacity));
  return { wounded, dead: casualties - wounded };
}

/**
 * Deterministic-ish, NON-DESTRUCTIVE combat resolution (global.combat.note): this only computes
 * an outcome, it never mutates `attacker`/`defender` — the caller applies losses/loot elsewhere.
 *
 * Assumptions (mixed-arm counter, attacker wounded cap — see report):
 *  - The defender's whole garrison is treated as one "dominant arm" (the arm with the most
 *    troops); each of the attacker's arms gets counterMultiplier(arm, dominantArm) individually,
 *    so a mixed-arm attack force is not all-or-nothing on the counter bonus.
 *  - `attackerHospitalCapacity` models the attacker's own Hospital back home (0 by default,
 *    i.e. no wounded slots while marching, matching "attacker wounded cap = its own hospital if
 *    provided else 0" in the spec) — pass it explicitly once a caller wants attacker wounded.
 *  - The loser's casualty fraction is casualtyScaling * enemyPower/(own+enemy); the winner's
 *    casualty fraction is half that same value, applied to the winner's own troop count.
 */
export function resolveCombat(
  attacker: Force,
  defender: Target,
  numbers: any = getN(),
  attackerHospitalCapacity = 0,
): CombatResult {
  const { dp, dominant, totalTroops: defenderTroopTotal } = defensePower(defender, numbers);

  let ap = 0;
  TROOP_ORDER.forEach((arm) => {
    let armAttack = 0;
    for (const [tierText, count] of Object.entries(attacker.troops?.[arm] ?? {})) {
      const row = troopTierRow(arm, Number(tierText));
      armAttack += (count || 0) * (row?.attack ?? 0);
    }
    ap += armAttack * counterMultiplier(arm, dominant, numbers);
  });
  ap += attacker.heroAttackBonus ?? 0; // marchBonus = 1; hero bonus is a flat hook until task 4

  const denom = ap + dp;
  const winRatio = denom > 0 ? ap / denom : 0;
  const win = winRatio > 0.5;

  const casualtyScaling = numbers.global.combat.casualtyScaling ?? 0;
  const woundedRatio = numbers.global.combat.woundedRatio ?? 0;
  const loserLossPct = win ? lossFraction(dp, ap, casualtyScaling) : lossFraction(ap, dp, casualtyScaling);
  const winnerLossPct = 0.5 * loserLossPct;
  const attackerLossPct = win ? winnerLossPct : loserLossPct;
  const defenderLossPct = win ? loserLossPct : winnerLossPct;

  const attackerTotal = sumTroopCounts(attacker.troops);
  const attackerLosses = splitCasualties(attackerTotal * attackerLossPct, woundedRatio, attackerHospitalCapacity);

  const defenderHospitalCapacity = defender.kind === "rival"
    ? (buildingLevelRow("hospital", defender.hospitalLevel)?.woundedCapacity ?? 0)
    : 0;
  const defenderLosses = defender.kind === "rival"
    ? splitCasualties(defenderTroopTotal * defenderLossPct, woundedRatio, defenderHospitalCapacity)
    : { wounded: 0, dead: 0 };

  const unprotected = defender.kind === "rival" ? defenderUnprotectedTotal(defender, numbers) : 0;
  const loot = Math.min(carryCapacity(attacker, numbers), Math.max(0, unprotected) * (numbers.global.combat.lootRate ?? 0));

  return { win, ap, dp, winRatio, loot, attackerLosses, defenderLosses };
}
