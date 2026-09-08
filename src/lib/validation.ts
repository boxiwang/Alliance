import { simulateProgression } from "./simulator";
import { simulateWorldBalance } from "./world-balance";
import { RESEARCH_EFFECT_BRANCH } from "./research";

export type ValidationSeverity = "error" | "warning";

export interface ValidationIssue {
  severity: ValidationSeverity;
  path: string;
  message: string;
}

const RESOURCE_KEYS = ["res.cash", "res.oil", "res.power"];
const PRODUCERS = ["building.bank", "building.oilwell", "building.powerplant"];
const TRAINING_BUILDINGS: Record<string, string> = {
  "troop.army": "building.armyCamp",
  "troop.navy": "building.navalBase",
  "troop.air": "building.airfield",
};
const TRAINING_BUILDING_KEYS = new Set(Object.values(TRAINING_BUILDINGS));

function finiteNonNegative(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function levelRow(numbers: any, building: string, level: number): any {
  return numbers.buildings?.[building]?.levels?.[String(level)];
}

export function validateNumbers(numbers: any): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const push = (severity: ValidationSeverity, path: string, message: string) => issues.push({ severity, path, message });
  const maxLevel = numbers.global?.buildingMaxLevel;

  if (!Number.isInteger(maxLevel) || maxLevel < 2) push("error", "global.buildingMaxLevel", "Must be an integer of at least 2.");
  if (!Number.isInteger(numbers.global?.buildQueueSlots) || numbers.global.buildQueueSlots < 1) push("error", "global.buildQueueSlots", "At least one build slot is required.");
  if (!finiteNonNegative(numbers.global?.offline?.collectorCapHours)) push("error", "global.offline.collectorCapHours", "Collector cap must be non-negative.");
  if (!finiteNonNegative(numbers.global?.display?.resourceMultiplier) || numbers.global.display.resourceMultiplier <= 0) push("error", "global.display.resourceMultiplier", "Resource display multiplier must be greater than zero.");
  if (!finiteNonNegative(numbers.global?.display?.troopMultiplier) || numbers.global.display.troopMultiplier <= 0) push("error", "global.display.troopMultiplier", "Troop display multiplier must be greater than zero.");

  for (const [key, building] of Object.entries(numbers.buildings ?? {}) as [string, any][]) {
    if (building.upgradable === false) continue;
    if (!Number.isInteger(building.unlockAtKeep) || building.unlockAtKeep < 1 || building.unlockAtKeep > maxLevel) {
      push("error", `${key}.unlockAtKeep`, "Unlock level must be within the Townhall range.");
    }
    if (TRAINING_BUILDING_KEYS.has(key) && (!Number.isInteger(building.promotionUnlockLevel) || building.promotionUnlockLevel < 1 || building.promotionUnlockLevel > (building.maxLevel ?? maxLevel))) {
      push("error", `${key}.promotionUnlockLevel`, "Promotion unlock must be within the training building's level range.");
    }
    for (let level = 1; level <= (building.maxLevel ?? maxLevel); level += 1) {
      const row = building.levels?.[String(level)];
      const path = `buildings.${key}.levels.${level}`;
      if (!row) {
        push("error", path, "Missing explicit level row.");
        continue;
      }
      if (!finiteNonNegative(row.timeSec)) push("error", `${path}.timeSec`, "Upgrade time must be a non-negative finite number.");
      if (!finiteNonNegative(row.might) || row.might <= 0) push("error", `${path}.might`, "Cumulative building Might must be greater than zero.");
      for (const resource of RESOURCE_KEYS) {
        const value = row.cost?.[resource];
        if (value != null && !finiteNonNegative(value)) push("error", `${path}.cost.${resource}`, "Cost must be a non-negative finite number.");
      }
      if (PRODUCERS.includes(key) && (!finiteNonNegative(row.productionPerHour) || row.productionPerHour <= 0)) {
        push("error", `${path}.productionPerHour`, "Producer output must be greater than zero.");
      }
      if (TRAINING_BUILDING_KEYS.has(key)) {
        if (!Number.isInteger(row.trainQueueSize) || row.trainQueueSize < 1) push("error", `${path}.trainQueueSize`, "Training batch capacity must be a positive integer.");
        if (!finiteNonNegative(row.trainSpeedMult) || row.trainSpeedMult <= 0) push("error", `${path}.trainSpeedMult`, "Training speed multiplier must be greater than zero.");
      }
    }
  }

  for (const [key, troop] of Object.entries(numbers.troops ?? {}) as [string, any][]) {
    const trainingBuilding = numbers.buildings?.[TRAINING_BUILDINGS[key]];
    if (!trainingBuilding) push("error", `troops.${key}`, "Missing the troop arm's training building.");
    let previousUnlock = 0;
    for (let tier = 1; tier <= 10; tier += 1) {
      const row = troop.tiers?.[String(tier)];
      const path = `troops.${key}.tiers.${tier}`;
      if (!row) {
        push("error", path, "Missing troop tier.");
        continue;
      }
      if (!Number.isInteger(row.unlockAtTrainingBuilding) || row.unlockAtTrainingBuilding < previousUnlock || row.unlockAtTrainingBuilding > (trainingBuilding?.maxLevel ?? maxLevel)) {
        push("error", `${path}.unlockAtTrainingBuilding`, "Unlocks must be ascending and within the training building's level range.");
      }
      previousUnlock = row.unlockAtTrainingBuilding;
      for (const field of ["trainTimeSec", "attack", "defense", "power", "load"]) {
        if (!finiteNonNegative(row[field]) || row[field] <= 0) push("error", `${path}.${field}`, `${field} must be greater than zero.`);
      }
      for (const resource of RESOURCE_KEYS) {
        const value = row.cost?.[resource];
        if (value != null && !finiteNonNegative(value)) push("error", `${path}.cost.${resource}`, "Cost must be a non-negative finite number.");
      }
    }
  }

  const research = numbers.research;
  if (!research || !research.techs || !research.branches) {
    push("error", "research", "Missing Academy research configuration.");
  } else {
    if (!Number.isInteger(research.queueSlots) || research.queueSlots !== 1) {
      push("error", "research.queueSlots", "The MVP uses exactly one Academy research queue.");
    }
    for (const [techKey, tech] of Object.entries(research.techs) as [string, any][]) {
      const path = `research.techs.${techKey}`;
      if (tech.key !== techKey) push("error", `${path}.key`, "Technology key must match its table key.");
      if (!research.branches[tech.branch]) push("error", `${path}.branch`, "Technology points to an unknown branch.");
      if (!Number.isInteger(tech.maxLevel) || tech.maxLevel < 1) push("error", `${path}.maxLevel`, "Maximum level must be a positive integer.");
      let previousAcademy = 0;
      let previousEffect = -1;
      let effectKey = "";
      for (let level = 1; level <= tech.maxLevel; level += 1) {
        const row = tech.levels?.[String(level)];
        const levelPath = `${path}.levels.${level}`;
        if (!row) {
          push("error", levelPath, "Missing explicit research level row.");
          continue;
        }
        if (row.category !== tech.branch) push("error", `${levelPath}.category`, "Every research level must explicitly match its Development, Economy or Battle category.");
        if (!Number.isInteger(row.academyLevel) || row.academyLevel < previousAcademy || row.academyLevel < 1 || row.academyLevel > maxLevel) {
          push("error", `${levelPath}.academyLevel`, "Academy gates must be ascending and within levels 1–30.");
        }
        previousAcademy = row.academyLevel;
        if (!finiteNonNegative(row.timeSec) || row.timeSec <= 0) push("error", `${levelPath}.timeSec`, "Research time must be greater than zero.");
        if (!finiteNonNegative(row.might) || row.might <= 0) push("error", `${levelPath}.might`, "Research Might must be greater than zero.");
        for (const resource of RESOURCE_KEYS) {
          if (!finiteNonNegative(row.cost?.[resource])) push("error", `${levelPath}.cost.${resource}`, "Every research level needs a non-negative resource cost.");
        }
        if (!row.effect?.key || !["percent", "flat"].includes(row.effect?.unit)) push("error", `${levelPath}.effect`, "Research effect needs a key and percent/flat unit.");
        const registeredBranch = RESEARCH_EFFECT_BRANCH[row.effect?.key as keyof typeof RESEARCH_EFFECT_BRANCH];
        if (!registeredBranch) push("error", `${levelPath}.effect.key`, "Research effect is not registered to a live account system.");
        else if (registeredBranch !== tech.branch) push("error", `${levelPath}.effect.key`, `This effect belongs to the ${registeredBranch} category.`);
        if (effectKey && row.effect?.key !== effectKey) push("error", `${levelPath}.effect.key`, "All levels of one technology must improve the same effect.");
        effectKey = row.effect?.key;
        if (!finiteNonNegative(row.effect?.value) || row.effect.value < previousEffect) push("error", `${levelPath}.effect.value`, "Research effects must be non-negative and cumulative.");
        previousEffect = row.effect?.value;
      }
      for (const requirement of tech.requirements ?? []) {
        const required = research.techs[requirement.tech];
        if (!required) push("error", `${path}.requirements`, `Missing prerequisite ${requirement.tech}.`);
        else if (!Number.isInteger(requirement.level) || requirement.level < 1 || requirement.level > required.maxLevel) push("error", `${path}.requirements`, `Invalid prerequisite level for ${requirement.tech}.`);
        if (requirement.tech === techKey) push("error", `${path}.requirements`, "Technology cannot require itself.");
      }
    }
    for (const [branchKey, branch] of Object.entries(research.branches) as [string, any][]) {
      const rows = Object.values(research.techs).filter((tech: any) => tech.branch === branchKey) as any[];
      const levels = rows.reduce((sum, tech) => sum + tech.maxLevel, 0);
      if (branch.totals?.technologies !== rows.length || branch.totals?.levels !== levels) {
        push("error", `research.branches.${branchKey}.totals`, "Cached branch totals do not match the explicit technology rows.");
      }
    }
  }

  const worldState = numbers.world?.state ?? {};
  for (const field of ["width", "height", "maxPlayers", "spawnGrid", "circleReserveRadius", "spatialCellSize", "cityFootprint"]) {
    if (!finiteNonNegative(worldState[field]) || worldState[field] <= 0) {
      push("error", `world.state.${field}`, `${field} must be greater than zero.`);
    }
  }
  if (!Number.isInteger(worldState.maxPlayers)) push("error", "world.state.maxPlayers", "Maximum players must be an integer.");
  if (!Number.isInteger(worldState.spawnGrid)) push("error", "world.state.spawnGrid", "Spawn grid must be an integer.");
  if (worldState.maxPlayers > worldState.spawnGrid * worldState.spawnGrid) {
    push("error", "world.state.maxPlayers", "Spawn grid has fewer cells than the maximum player count.");
  }
  if (worldState.circleReserveRadius * 2 >= Math.min(worldState.width, worldState.height)) {
    push("error", "world.state.circleReserveRadius", "Circle reserve must fit inside the map.");
  }
  for (const field of ["resourceRespawnSec", "monsterRespawnSec", "burnDurationSec"]) {
    if (!finiteNonNegative(numbers.world?.lifecycle?.[field]) || numbers.world.lifecycle[field] <= 0) {
      push("error", `world.lifecycle.${field}`, `${field} must be greater than zero.`);
    }
  }
  for (let level = 1; level <= 30; level += 1) {
    const monster = numbers.world?.monsters?.levels?.[String(level)];
    if (!monster) push("error", `world.monsters.levels.${level}`, "Missing explicit monster level row.");
    else {
      if (!finiteNonNegative(monster.power) || monster.power <= 0) push("error", `world.monsters.levels.${level}.power`, "Monster power must be greater than zero.");
      if (!Number.isInteger(monster.expectedTownhall) || monster.expectedTownhall < 1 || monster.expectedTownhall > maxLevel) push("error", `world.monsters.levels.${level}.expectedTownhall`, "Expected Townhall must be inside the progression range.");
      if (!["army", "navy", "air"].includes(monster.dominantArm)) push("error", `world.monsters.levels.${level}.dominantArm`, "Dominant arm must be army, navy or air.");
    }
  }
  for (let level = 1; level <= 10; level += 1) {
    const node = numbers.gatherNodes?.levels?.[String(level)];
    if (!node) push("error", `gatherNodes.levels.${level}`, "Missing explicit gathering level row.");
    else {
      if (!finiteNonNegative(node.totalSupply) || node.totalSupply <= 0) push("error", `gatherNodes.levels.${level}.totalSupply`, "Node supply must be greater than zero.");
      if (!finiteNonNegative(node.gatherRatePerHour) || node.gatherRatePerHour <= 0) push("error", `gatherNodes.levels.${level}.gatherRatePerHour`, "Gathering rate must be greater than zero.");
    }
  }
  if (!finiteNonNegative(numbers.gatherNodes?.retireBelowFraction) || numbers.gatherNodes.retireBelowFraction > 1) {
    push("error", "gatherNodes.retireBelowFraction", "Retirement fraction must be between 0 and 1.");
  }

  const perLevel = numbers.townhallPrerequisites?.perLevel ?? {};
  const bands = numbers.townhallPrerequisites?.bands ?? [];
  for (let target = 2; target <= maxLevel; target += 1) {
    const path = `townhallPrerequisites.perLevel.${target}`;
    const required = perLevel[String(target)];
    if (!Array.isArray(required)) {
      push("error", path, "Missing prerequisite list.");
      continue;
    }
    const band = bands.find((entry: any) => target >= entry.fromLevel && target <= entry.toLevel);
    if (band && required.length !== band.count) push("error", path, `Expected ${band.count} prerequisites for this band, found ${required.length}.`);
    if (new Set(required).size !== required.length) push("error", path, "Contains duplicate buildings.");
    for (const key of required) {
      const building = numbers.buildings?.[key];
      if (!building || building.upgradable === false) {
        push("error", path, `${key} is not an upgradable building.`);
      } else if (building.unlockAtKeep > target - 1) {
        push("error", path, `${key} unlocks too late to reach required Lv.${target - 1}.`);
      }
    }
  }

  for (let level = 2; level <= maxLevel; level += 1) {
    const previousStorage = Math.max(1, level - 1);
    const previousCapacity = levelRow(numbers, "building.storage", previousStorage)?.capacityPerResource ?? 0;
    const storageCost = levelRow(numbers, "building.storage", level)?.cost ?? {};
    for (const resource of RESOURCE_KEYS) {
      if ((storageCost[resource] ?? 0) > previousCapacity) {
        push("error", `buildings.building.storage.levels.${level}.cost.${resource}`, `Exceeds the previous Warehouse capacity (${previousCapacity}).`);
      }
    }
  }

  for (let target = 2; target <= maxLevel; target += 1) {
    const availableCapacity = levelRow(numbers, "building.storage", Math.max(1, target - 1))?.capacityPerResource ?? 0;
    const keepCost = levelRow(numbers, "building.keep", target)?.cost ?? {};
    for (const resource of RESOURCE_KEYS) {
      if ((keepCost[resource] ?? 0) > availableCapacity) {
        push("error", `buildings.building.keep.levels.${target}.cost.${resource}`, `Exceeds the required Warehouse capacity (${availableCapacity}).`);
      }
    }
  }

  const options = { sessionsPerDay: 3, queueUptime: 0.85 };
  const level10 = simulateProgression(numbers, { ...options, targetLevel: 10 });
  const level30 = simulateProgression(numbers, { ...options, targetLevel: 30 });
  if (level10.deadlock) push("error", "simulation.TH10", level10.deadlock);
  else if (level10.totalDays < 2 || level10.totalDays > 3.1) push("warning", "simulation.TH10", `Default profile reaches TH10 in ${level10.totalDays.toFixed(1)}d; target is 2–3d.`);
  if (level30.deadlock) push("error", "simulation.TH30", level30.deadlock);
  else if (level30.totalDays < 120 || level30.totalDays > 150) push("warning", "simulation.TH30", `Default profile reaches TH30 in ${level30.totalDays.toFixed(0)}d; target is 120–150d.`);

  if (!issues.some((issue) => issue.severity === "error" && (issue.path.startsWith("world.") || issue.path.startsWith("gatherNodes.")))) {
    simulateWorldBalance(numbers).issues.forEach((issue) => push(issue.severity, `worldBalance.${issue.code}`, issue.message));
  }

  return issues;
}
