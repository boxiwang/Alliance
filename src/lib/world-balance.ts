// Deterministic, UI-free balance scenarios for the Personal World.
// This is diagnostic only: it reads numbers.json-shaped data and never mutates game state.
import type { TroopKey } from "./game";
import { TROOP_ORDER } from "./game";
import { carryCapacity, resolveCombat, resolveGather, type Force, type RivalTarget } from "./expedition";
import { worldEngineConfig, type ResourceWallet, type TroopManifest } from "./world-engine";

export interface WorldBalanceIssue {
  severity: "error" | "warning";
  code: string;
  message: string;
}

export interface WorldStageScenario {
  monsterLevel: number;
  expectedTownhall: number;
  troopTier: number;
  referenceTroops: number;
  monsterPower: number;
  weakWinRatio: number;
  standardWinRatio: number;
  strongWinRatio: number;
  standardCasualtyFraction: number;
  standardWounded: number;
  standardDead: number;
  rewardTotal: number;
  nodeSupply: number;
  referenceCarry: number;
  gatherHours: number;
}

export interface PvpStageScenario {
  townhall: number;
  troopTier: number;
  troopsPerSide: number;
  attackerWinRatio: number;
  attackerWins: boolean;
  attackerCasualtyFraction: number;
  defenderCasualtyFraction: number;
  wallDefense: number;
}

export interface WorldBalanceReport {
  stages: WorldStageScenario[];
  pvp: PvpStageScenario[];
  economy: {
    typicalDistanceTiles: number;
    typicalRoundTripSeconds: number;
    regeneratedMonsterAttacksPerDay: number;
    initialMonsterAttacksAtFullEnergy: number;
    populationAt50: { resources: number; monsters: number };
    populationAt500: { resources: number; monsters: number };
    populationAt1000: { resources: number; monsters: number };
  };
  issues: WorldBalanceIssue[];
}

function buildingRow(numbers: any, key: string, level: number): any {
  return numbers.buildings?.[key]?.levels?.[String(level)] ?? {};
}

function troopRow(numbers: any, arm: TroopKey, tier: number): any {
  return numbers.troops?.[`troop.${arm}`]?.tiers?.[String(tier)] ?? {};
}

function bestTier(numbers: any, trainingBuildingLevel: number): number {
  let result = 1;
  for (let tier = 1; tier <= 10; tier += 1) {
    const unlock = Number(troopRow(numbers, "army", tier).unlockAtTrainingBuilding) || Number.POSITIVE_INFINITY;
    if (unlock <= trainingBuildingLevel) result = tier;
  }
  return result;
}

function totalCapacity(numbers: any, level: number): number {
  return ["building.armyCamp", "building.navalBase", "building.airfield"]
    .reduce((sum, key) => sum + (Number(buildingRow(numbers, key, level).troopCapacity) || 0), 0);
}

function mixedForce(total: number, tier: number): Force {
  const base = Math.floor(total / TROOP_ORDER.length);
  let remainder = Math.max(0, Math.floor(total) - base * TROOP_ORDER.length);
  const troops = { army: {}, navy: {}, air: {} } as TroopManifest;
  TROOP_ORDER.forEach((arm) => {
    troops[arm][String(tier)] = base + (remainder-- > 0 ? 1 : 0);
  });
  return { troops };
}

function resourceTotal(resources: Partial<ResourceWallet>): number {
  return (Object.values(resources) as number[]).reduce((sum, amount) => sum + (Number(amount) || 0), 0);
}

function pveNumbers(numbers: any): any {
  const output = structuredClone(numbers);
  const scaling = Number(numbers.world?.monsters?.casualtyScaling);
  const wounded = Number(numbers.world?.monsters?.woundedRatio);
  if (Number.isFinite(scaling) && scaling >= 0) output.global.combat.casualtyScaling = scaling;
  if (Number.isFinite(wounded) && wounded >= 0) output.global.combat.woundedRatio = wounded;
  return output;
}

function recommendedPopulation(numbers: any, players: number): { resources: number; monsters: number } {
  const population = numbers.world?.population ?? {};
  return {
    resources: Math.ceil(Math.max(Number(population.minimumResourceFields) || 0,
      players * (Number(population.resourceFieldsPerPlayer) || 0))),
    monsters: Math.ceil(Math.max(Number(population.minimumMonsters) || 0,
      players * (Number(population.monstersPerPlayer) || 0))),
  };
}

export function simulateWorldBalance(numbers: any): WorldBalanceReport {
  const targets = numbers.world?.balanceTargets ?? {};
  const fill = Number(targets.referenceArmyFill) || .6;
  const stages: WorldStageScenario[] = [];
  const issues: WorldBalanceIssue[] = [];
  const tunedPve = pveNumbers(numbers);

  for (let level = 1; level <= 10; level += 1) {
    const monster = numbers.world?.monsters?.levels?.[String(level)] ?? {};
    const expectedTownhall = Number(monster.expectedTownhall) || level;
    const tier = bestTier(numbers, expectedTownhall);
    const referenceTroops = Math.max(1, Math.floor(totalCapacity(numbers, expectedTownhall) * fill));
    const hospitalCapacity = Number(buildingRow(numbers, "building.hospital", expectedTownhall).woundedCapacity) || 0;
    const target = {
      kind: "monster" as const,
      level,
      power: Number(monster.power) || 0,
      dominantArm: monster.dominantArm as TroopKey | undefined,
      reward: {
        cash: Number(monster.reward?.["res.cash"]) || 0,
        oil: Number(monster.reward?.["res.oil"]) || 0,
        power: Number(monster.reward?.["res.power"]) || 0,
      },
    };
    const fight = (scale: number) => resolveCombat(mixedForce(Math.max(1, referenceTroops * scale), tier), target, tunedPve, hospitalCapacity);
    const weak = fight(.75);
    const standard = fight(1);
    const strong = fight(1.25);
    const force = mixedForce(referenceTroops, tier);
    const carry = carryCapacity(force, numbers);
    const node = numbers.gatherNodes?.levels?.[String(level)] ?? {};
    const gather = resolveGather({
      kind: "node", level, resource: "cash", remaining: Number(node.totalSupply) || 0,
    }, carry, numbers);
    const casualties = standard.attackerLosses.wounded + standard.attackerLosses.dead;
    const scenario: WorldStageScenario = {
      monsterLevel: level,
      expectedTownhall,
      troopTier: tier,
      referenceTroops,
      monsterPower: target.power,
      weakWinRatio: weak.winRatio,
      standardWinRatio: standard.winRatio,
      strongWinRatio: strong.winRatio,
      standardCasualtyFraction: casualties / referenceTroops,
      standardWounded: standard.attackerLosses.wounded,
      standardDead: standard.attackerLosses.dead,
      rewardTotal: resourceTotal(target.reward),
      nodeSupply: Number(node.totalSupply) || 0,
      referenceCarry: carry,
      gatherHours: gather.tripTimeSec / 3600,
    };
    stages.push(scenario);

    const minWin = Number(targets.standardPveWinRatioMin) || .55;
    const maxWin = Number(targets.standardPveWinRatioMax) || .68;
    if (scenario.standardWinRatio < minWin || scenario.standardWinRatio > maxWin) {
      issues.push({ severity: "warning", code: `pve.level${level}.winRatio`, message: `L${level} standard force win ratio ${(scenario.standardWinRatio * 100).toFixed(1)}% is outside ${(minWin * 100).toFixed(0)}–${(maxWin * 100).toFixed(0)}%.` });
    }
    if (scenario.weakWinRatio >= .5) {
      issues.push({ severity: "warning", code: `pve.level${level}.weakForce`, message: `L${level} 75% reference force still wins (${(scenario.weakWinRatio * 100).toFixed(1)}%); weak preparation should fail.` });
    }
    if (scenario.strongWinRatio <= .5) {
      issues.push({ severity: "warning", code: `pve.level${level}.strongForce`, message: `L${level} 125% reference force still loses (${(scenario.strongWinRatio * 100).toFixed(1)}%); over-preparation should win.` });
    }
    const maxCasualties = Number(targets.winningPveCasualtyFractionMax) || .02;
    if (standard.win && scenario.standardCasualtyFraction > maxCasualties) {
      issues.push({ severity: "warning", code: `pve.level${level}.casualties`, message: `L${level} winning force loses ${(scenario.standardCasualtyFraction * 100).toFixed(2)}%; target ≤ ${(maxCasualties * 100).toFixed(2)}%.` });
    }
    const minGather = Number(targets.fullNodeGatherHoursMin) || 2;
    const maxGather = Number(targets.fullNodeGatherHoursMax) || 6;
    if (!Number.isFinite(scenario.gatherHours) || scenario.gatherHours < minGather || scenario.gatherHours > maxGather) {
      issues.push({ severity: "warning", code: `gather.level${level}.hours`, message: `L${level} reference gather occupies a march for ${scenario.gatherHours.toFixed(1)}h; target ${minGather}–${maxGather}h.` });
    }
    const rewardRatio = scenario.rewardTotal / Math.max(1, scenario.nodeSupply);
    const minRewardRatio = Number(targets.monsterRewardToNodeSupplyMin) || .1;
    const maxRewardRatio = Number(targets.monsterRewardToNodeSupplyMax) || .3;
    if (rewardRatio < minRewardRatio || rewardRatio > maxRewardRatio) {
      issues.push({ severity: "warning", code: `pve.level${level}.reward`, message: `L${level} resource reward is ${(rewardRatio * 100).toFixed(1)}% of its node supply; target ${(minRewardRatio * 100).toFixed(0)}–${(maxRewardRatio * 100).toFixed(0)}%.` });
    }
  }

  const pvp: PvpStageScenario[] = [5, 10, 15, 20, 25, 30].map((townhall) => {
    const tier = bestTier(numbers, townhall);
    const troopsPerSide = Math.max(1, Math.floor(totalCapacity(numbers, townhall) * fill));
    const force = mixedForce(troopsPerSide, tier);
    const defender: RivalTarget = {
      kind: "rival", keepLevel: townhall, wallLevel: townhall, hospitalLevel: townhall,
      storageLevel: townhall, troops: structuredClone(force.troops), resources: {},
    };
    const hospital = Number(buildingRow(numbers, "building.hospital", townhall).woundedCapacity) || 0;
    const result = resolveCombat(force, defender, numbers, hospital);
    return {
      townhall, troopTier: tier, troopsPerSide, attackerWinRatio: result.winRatio,
      attackerWins: result.win,
      attackerCasualtyFraction: (result.attackerLosses.wounded + result.attackerLosses.dead) / troopsPerSide,
      defenderCasualtyFraction: (result.defenderLosses.wounded + result.defenderLosses.dead) / troopsPerSide,
      wallDefense: Number(buildingRow(numbers, "building.wall", townhall).defenseValue) || 0,
    };
  });
  const minPvpRatio = Number(targets.equalPvpAttackerWinRatioMin) || .45;
  const maxPvpRatio = Number(targets.equalPvpAttackerWinRatioMax) || .5;
  pvp.forEach((scenario) => {
    if (scenario.attackerWinRatio < minPvpRatio || scenario.attackerWinRatio > maxPvpRatio) {
      issues.push({ severity: "warning", code: `pvp.th${scenario.townhall}.equal`, message: `TH${scenario.townhall} equal-progression attacker ratio ${(scenario.attackerWinRatio * 100).toFixed(1)}% is outside ${(minPvpRatio * 100).toFixed(0)}–${(maxPvpRatio * 100).toFixed(0)}%.` });
    }
  });

  const config = worldEngineConfig(numbers);
  const typicalDistance = Number(targets.typicalDistanceTiles) || 20;
  const typicalRoundTripSeconds = typicalDistance * config.travelSecondsPerTile * 2;
  const regeneratedMonsterAttacksPerDay = config.energyRegenSec > 0 && config.monsterEnergyCost > 0
    ? 86400 / (config.energyRegenSec * config.monsterEnergyCost)
    : Number.POSITIVE_INFINITY;
  const initialMonsterAttacksAtFullEnergy = config.monsterEnergyCost > 0
    ? Math.floor(config.energyCap / config.monsterEnergyCost)
    : Number.POSITIVE_INFINITY;
  const minRoundTrip = Number(targets.roundTripSecondsMin) || 120;
  const maxRoundTrip = Number(targets.roundTripSecondsMax) || 600;
  if (typicalRoundTripSeconds < minRoundTrip || typicalRoundTripSeconds > maxRoundTrip) {
    issues.push({ severity: "warning", code: "march.typicalRoundTrip", message: `Typical round trip is ${typicalRoundTripSeconds.toFixed(0)}s; target ${minRoundTrip}–${maxRoundTrip}s.` });
  }
  const minDaily = Number(targets.dailyEnergyAttacksMin) || 8;
  const maxDaily = Number(targets.dailyEnergyAttacksMax) || 30;
  if (regeneratedMonsterAttacksPerDay < minDaily || regeneratedMonsterAttacksPerDay > maxDaily) {
    issues.push({ severity: "warning", code: "energy.attacksPerDay", message: `Energy regenerates ${regeneratedMonsterAttacksPerDay.toFixed(1)} monster attacks/day; target ${minDaily}–${maxDaily}.` });
  }

  return {
    stages,
    pvp,
    economy: {
      typicalDistanceTiles: typicalDistance,
      typicalRoundTripSeconds,
      regeneratedMonsterAttacksPerDay,
      initialMonsterAttacksAtFullEnergy,
      populationAt50: recommendedPopulation(numbers, 50),
      populationAt500: recommendedPopulation(numbers, 500),
      populationAt1000: recommendedPopulation(numbers, 1000),
    },
    issues,
  };
}

export function worldBalanceSummary(report: WorldBalanceReport): string {
  const lines = [
    "RUGLANDS Personal World — deterministic balance report",
    "",
    "PvE / gathering by monster level",
    "Lv  TH  Tier  Troops   Win%  Casualty%  Gather(h)  Reward",
    ...report.stages.map((row) => [
      String(row.monsterLevel).padStart(2), String(row.expectedTownhall).padStart(2),
      String(row.troopTier).padStart(4), String(row.referenceTroops).padStart(7),
      `${(row.standardWinRatio * 100).toFixed(1)}%`.padStart(6),
      `${(row.standardCasualtyFraction * 100).toFixed(2)}%`.padStart(9),
      row.gatherHours.toFixed(1).padStart(9), String(row.rewardTotal).padStart(7),
    ].join("  ")),
    "",
    "Equal-progression PvP",
    "TH  Tier  Troops   Attacker win%  Attacker wins  A casualty%  D casualty%",
    ...report.pvp.map((row) => [
      String(row.townhall).padStart(2), String(row.troopTier).padStart(4), String(row.troopsPerSide).padStart(7),
      `${(row.attackerWinRatio * 100).toFixed(1)}%`.padStart(13), String(row.attackerWins).padStart(13),
      `${(row.attackerCasualtyFraction * 100).toFixed(1)}%`.padStart(11),
      `${(row.defenderCasualtyFraction * 100).toFixed(1)}%`.padStart(11),
    ].join("  ")),
    "",
    `Typical 20-tile round trip: ${report.economy.typicalRoundTripSeconds.toFixed(0)}s`,
    `Energy: ${report.economy.initialMonsterAttacksAtFullEnergy} attacks from full, ${report.economy.regeneratedMonsterAttacksPerDay.toFixed(1)} regenerated/day`,
    `Population @ 50/500/1000: ${[report.economy.populationAt50, report.economy.populationAt500, report.economy.populationAt1000].map((value) => `${value.resources} fields + ${value.monsters} monsters`).join(" · ")}`,
    "",
    report.issues.length ? `Issues (${report.issues.length})` : "Issues (0)",
    ...report.issues.map((issue) => `- [${issue.severity}] ${issue.code}: ${issue.message}`),
  ];
  return lines.join("\n");
}
