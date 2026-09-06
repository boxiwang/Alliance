import { simulateProgression } from "./simulator";

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

  return issues;
}
