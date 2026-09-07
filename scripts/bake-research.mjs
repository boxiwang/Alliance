import fs from "node:fs";

const path = new URL("../docs/numbers.json", import.meta.url);
const numbers = JSON.parse(fs.readFileSync(path, "utf8"));

const roman = ["I", "II", "III", "IV", "V", "VI", "VII"];
const resources = ["cash", "oil", "power"];
const troopArms = ["army", "navy", "air"];
const techs = {};

const branchMeta = {
  development: {
    label: "Development",
    description: "Compound the whole account: build, research, train and recover faster.",
    icon: "⚙️",
  },
  economy: {
    label: "Economy",
    description: "Specialize city output and World gathering for Cash, Oil and Power.",
    icon: "📈",
  },
  battle: {
    label: "Battle",
    description: "Grow universal combat power, march size and Army / Navy / Air specializations.",
    icon: "🎯",
  },
};

const stageCost = {
  development: [600, 4_000, 25_000, 100_000, 400_000, 1_200_000, 3_000_000],
  economy: [500, 3_500, 22_000, 90_000, 350_000, 1_100_000],
  battle: [1_000, 8_000, 50_000, 250_000, 1_000_000, 3_000_000],
};
const stageHours = {
  development: [1 / 6, 1, 4, 12, 36, 72, 120],
  economy: [1 / 6, 1, 4, 12, 36, 120],
  battle: [0.5, 3, 12, 36, 96, 240],
};
const stageMight = {
  development: [50_000, 200_000, 800_000, 3_000_000, 10_000_000, 30_000_000, 60_000_000],
  economy: [40_000, 180_000, 700_000, 2_500_000, 8_000_000, 25_000_000],
  battle: [50_000, 300_000, 2_000_000, 8_000_000, 25_000_000, 60_000_000],
};

function shares(maxLevel) {
  const weights = Array.from({ length: maxLevel }, (_, index) => Math.pow(index + 1, 1.45));
  const total = weights.reduce((sum, value) => sum + value, 0);
  return weights.map((value) => value / total);
}

function cumulativeEffect(cap, level, maxLevel, unit) {
  if (unit === "flat") return Math.max(1, Math.round(cap * level / maxLevel));
  return Number((cap * level / maxLevel).toFixed(5));
}

function makeCost(branch, stage, levelShare, familyBias = 1) {
  const total = stageCost[branch][stage - 1] * familyBias;
  return {
    "res.cash": Math.max(1, Math.round(total * levelShare * 0.5)),
    "res.oil": Math.max(1, Math.round(total * levelShare * 0.28)),
    "res.power": Math.max(1, Math.round(total * levelShare * 0.22)),
  };
}

function addTech({
  branch, family, stage, name, description, effectKey, effectCap, unit = "percent",
  maxLevel = 3, academyStart, requirements = [], familyBias = 1,
}) {
  const key = `research.${branch}.${family}.${stage}`;
  const levelShares = shares(maxLevel);
  let cumulativeTime = 0;
  const levels = {};
  for (let level = 1; level <= maxLevel; level += 1) {
    const share = levelShares[level - 1];
    const timeSec = Math.max(1, Math.round(stageHours[branch][stage - 1] * 3600 * share * familyBias));
    cumulativeTime += timeSec;
    const requiredAcademy = Math.min(30, academyStart + level - 1);
    levels[String(level)] = {
      category: branch,
      academyLevel: requiredAcademy,
      cost: makeCost(branch, stage, share, familyBias),
      timeSec,
      might: Math.max(1, Math.round(stageMight[branch][stage - 1] * level / maxLevel * familyBias)),
      effect: {
        key: effectKey,
        value: cumulativeEffect(effectCap, level, maxLevel, unit),
        unit,
      },
    };
  }
  techs[key] = {
    key,
    branch,
    family,
    stage,
    name: `${name} ${roman[stage - 1]}`,
    description,
    maxLevel,
    requirements,
    levels,
  };
  return key;
}

const developmentStarts = [1, 5, 10, 15, 20, 25, 30];
const developmentFamilies = [
  ["rapidConstruction", "Rapid Construction", "Reduces building upgrade time.", "constructionSpeedBonus", [0.015, 0.02, 0.03, 0.04, 0.05, 0.06, 0.065], "percent"],
  ["systemsOptimization", "Systems Optimization", "Reduces future research time.", "researchSpeedBonus", [0.015, 0.02, 0.03, 0.04, 0.05, 0.06, 0.065], "percent"],
  ["mobilizationCapacity", "Mobilization Capacity", "Increases the maximum size of one training batch.", "trainingCapacityBonus", [7, 15, 23, 30, 37, 46, 46], "flat"],
  ["drillEfficiency", "Drill Efficiency", "Reduces Army, Navy and Air training time.", "trainingSpeedBonus", [0.03, 0.04, 0.06, 0.08, 0.1, 0.12, 0.14], "percent"],
  ["emergencyTreatment", "Emergency Treatment", "Reduces healing time for wounded troops.", "healingSpeedBonus", [0.05, 0.08, 0.12, 0.18, 0.25, 0.35, 0.45], "percent"],
  ["medicalExpansion", "Medical Expansion", "Increases Hospital wounded capacity.", "hospitalCapacityBonus", [100, 500, 3_000, 20_000, 100_000, 300_000, 600_000], "flat"],
];

for (let stage = 1; stage <= 7; stage += 1) {
  const previous = (family) => stage === 1 ? [] : [{ tech: `research.development.${family}.${stage - 1}`, level: 3 }];
  const root = addTech({
    branch: "development", family: "rapidConstruction", stage, name: "Rapid Construction",
    description: developmentFamilies[0][2], effectKey: developmentFamilies[0][3], effectCap: developmentFamilies[0][4][stage - 1],
    academyStart: developmentStarts[stage - 1], requirements: previous("rapidConstruction"),
  });
  const keys = { rapidConstruction: root };
  for (const [family, name, description, effectKey, caps, unit] of developmentFamilies.slice(1)) {
    const requirements = previous(family);
    if (["systemsOptimization", "mobilizationCapacity"].includes(family)) requirements.push({ tech: root, level: 1 });
    if (family === "drillEfficiency") requirements.push({ tech: `research.development.mobilizationCapacity.${stage}`, level: 1 });
    if (family === "emergencyTreatment") requirements.push({ tech: `research.development.systemsOptimization.${stage}`, level: 1 });
    if (family === "medicalExpansion") requirements.push({ tech: `research.development.emergencyTreatment.${stage}`, level: 1 });
    keys[family] = addTech({
      branch: "development", family, stage, name, description, effectKey, effectCap: caps[stage - 1], unit,
      academyStart: developmentStarts[stage - 1], requirements,
    });
  }
}

for (const [index, stage] of [2, 4, 6].entries()) {
  addTech({
    branch: "development", family: "commandTactics", stage: index + 1,
    name: "Command Tactics", description: "Unlocks one additional simultaneous World march.",
    effectKey: "marchQueueBonus", effectCap: 1, unit: "flat", maxLevel: 1,
    academyStart: [9, 19, 29][index], familyBias: 1.5,
    requirements: [
      { tech: `research.development.drillEfficiency.${stage}`, level: 3 },
      { tech: `research.development.medicalExpansion.${stage}`, level: 3 },
    ],
  });
}

const economyStarts = [1, 6, 11, 16, 21, 26];
const economyCaps = {
  output: [0.05, 0.07, 0.09, 0.12, 0.15, 0.18],
  gathering: [0.08, 0.12, 0.18, 0.25, 0.35, 0.5],
};
const resourceNames = { cash: "Cash", oil: "Oil", power: "Power" };
for (let stage = 1; stage <= 6; stage += 1) {
  for (const resource of resources) {
    const previousOutput = stage === 1 ? [] : [{ tech: `research.economy.${resource}Output.${stage - 1}`, level: 3 }];
    const output = addTech({
      branch: "economy", family: `${resource}Output`, stage,
      name: `${resourceNames[resource]} Output`, description: `Increases ${resourceNames[resource]} production inside the city.`,
      effectKey: `${resource}ProductionBonus`, effectCap: economyCaps.output[stage - 1], academyStart: economyStarts[stage - 1],
      requirements: previousOutput,
    });
    const requirements = [{ tech: output, level: 1 }];
    if (stage > 1) requirements.push({ tech: `research.economy.${resource}Gathering.${stage - 1}`, level: 3 });
    addTech({
      branch: "economy", family: `${resource}Gathering`, stage,
      name: `${resourceNames[resource]} Gathering`, description: `Increases ${resourceNames[resource]} gathering speed on the World map.`,
      effectKey: `${resource}GatherSpeedBonus`, effectCap: economyCaps.gathering[stage - 1], academyStart: economyStarts[stage - 1],
      requirements,
    });
  }
}

const battleStarts = [1, 6, 11, 16, 21, 25];
const battleMaxLevels = [3, 3, 4, 5, 6, 6];
const commonCaps = [0.01, 0.015, 0.025, 0.04, 0.06, 0.08];
const armCaps = [0.02, 0.03, 0.05, 0.08, 0.12, 0.18];
const capacityCaps = [0.02, 0.03, 0.05, 0.08, 0.12, 0.2];
const armNames = { army: "Army", navy: "Navy", air: "Air" };

for (let stage = 1; stage <= 6; stage += 1) {
  const maxLevel = battleMaxLevels[stage - 1];
  const prior = (family) => stage === 1 ? [] : [{ tech: `research.battle.${family}.${stage - 1}`, level: battleMaxLevels[stage - 2] }];
  const attack = addTech({
    branch: "battle", family: "weaponsPrep", stage, name: "Weapons Preparation",
    description: "Increases attack for every troop arm.", effectKey: "troopAttackBonus", effectCap: commonCaps[stage - 1],
    maxLevel, academyStart: battleStarts[stage - 1], requirements: prior("weaponsPrep"),
  });
  const defense = addTech({
    branch: "battle", family: "defensiveTraining", stage, name: "Defensive Training",
    description: "Increases defense for every troop arm.", effectKey: "troopDefenseBonus", effectCap: commonCaps[stage - 1],
    maxLevel, academyStart: battleStarts[stage - 1], requirements: prior("defensiveTraining"),
  });
  const lethalityReq = prior("assaultTechniques"); lethalityReq.push({ tech: attack, level: 1 });
  const lethality = addTech({
    branch: "battle", family: "assaultTechniques", stage, name: "Assault Techniques",
    description: "Increases lethality for every troop arm.", effectKey: "troopLethalityBonus", effectCap: commonCaps[stage - 1],
    maxLevel, academyStart: battleStarts[stage - 1], requirements: lethalityReq,
  });
  const healthReq = prior("survivalTechniques"); healthReq.push({ tech: defense, level: 1 });
  const health = addTech({
    branch: "battle", family: "survivalTechniques", stage, name: "Survival Techniques",
    description: "Increases health for every troop arm.", effectKey: "troopHealthBonus", effectCap: commonCaps[stage - 1],
    maxLevel, academyStart: battleStarts[stage - 1], requirements: healthReq,
  });

  for (const arm of troopArms) {
    const attackReq = prior(`${arm}Attack`); attackReq.push({ tech: attack, level: 1 });
    const armAttack = addTech({
      branch: "battle", family: `${arm}Attack`, stage, name: `${armNames[arm]} Firepower`,
      description: `Increases ${armNames[arm]} attack.`, effectKey: `${arm}AttackBonus`, effectCap: armCaps[stage - 1],
      maxLevel, academyStart: battleStarts[stage - 1], requirements: attackReq,
    });
    const lethalityRequirements = prior(`${arm}Lethality`); lethalityRequirements.push({ tech: armAttack, level: 1 }, { tech: lethality, level: 1 });
    addTech({
      branch: "battle", family: `${arm}Lethality`, stage, name: `${armNames[arm]} Lethality`,
      description: `Increases ${armNames[arm]} lethality.`, effectKey: `${arm}LethalityBonus`, effectCap: armCaps[stage - 1],
      maxLevel, academyStart: battleStarts[stage - 1], requirements: lethalityRequirements,
    });
    const defenseReq = prior(`${arm}Defense`); defenseReq.push({ tech: defense, level: 1 });
    const armDefense = addTech({
      branch: "battle", family: `${arm}Defense`, stage, name: `${armNames[arm]} Armor`,
      description: `Increases ${armNames[arm]} defense.`, effectKey: `${arm}DefenseBonus`, effectCap: armCaps[stage - 1],
      maxLevel, academyStart: battleStarts[stage - 1], requirements: defenseReq,
    });
    const armHealthReq = prior(`${arm}Health`); armHealthReq.push({ tech: armDefense, level: 1 }, { tech: health, level: 1 });
    addTech({
      branch: "battle", family: `${arm}Health`, stage, name: `${armNames[arm]} Durability`,
      description: `Increases ${armNames[arm]} health.`, effectKey: `${arm}HealthBonus`, effectCap: armCaps[stage - 1],
      maxLevel, academyStart: battleStarts[stage - 1], requirements: armHealthReq,
    });
  }
  const marchReq = prior("regimentalExpansion");
  marchReq.push({ tech: lethality, level: 1 }, { tech: health, level: 1 });
  addTech({
    branch: "battle", family: "regimentalExpansion", stage, name: "Expedition Capacity",
    description: "Increases the number of troops that can be sent in one march.",
    effectKey: "marchCapacityBonus", effectCap: capacityCaps[stage - 1], maxLevel,
    academyStart: battleStarts[stage - 1], requirements: marchReq, familyBias: 1.25,
  });
}

const branchTotals = {};
for (const branch of Object.keys(branchMeta)) {
  const rows = Object.values(techs).filter((tech) => tech.branch === branch);
  branchTotals[branch] = {
    technologies: rows.length,
    levels: rows.reduce((sum, tech) => sum + tech.maxLevel, 0),
    baseTimeSec: rows.reduce((sum, tech) => sum + Object.values(tech.levels).reduce((inner, level) => inner + level.timeSec, 0), 0),
  };
}

numbers.research = {
  model: "Kingshot-inspired three-tree ladder, adapted to Cash/Oil/Power and Army/Navy/Air.",
  queueSlots: 1,
  note: "Every upgrade is explicit. A level requires the listed Academy level, the previous level of the same technology, and every listed prerequisite. Troop tiers remain gated by their training buildings, not research.",
  branches: Object.fromEntries(Object.entries(branchMeta).map(([key, value]) => [key, { ...value, totals: branchTotals[key] }])),
  techs,
};

numbers.buildings["building.academy"].researchBranches = ["development", "economy", "battle"];
numbers.buildings["building.academy"].role = "Runs one permanent-research queue across Development, Economy and Battle. Its level gates research upgrades.";

// Kingshot Barracks L1–30 training capacity/speed and T1–T10 unlock/training rows,
// adapted from four resources to Cash / Oil / Power. Combat stats and Might stay RUGLANDS-owned.
const trainingCapacity = [17, 22, 26, 30, 35, 39, 43, 48, 52, 56, 61, 65, 69, 76, 84, 92, 101, 109, 117, 126, 134, 142, 151, 159, 167, 176, 184, 192, 201, 209];
const trainingSpeedBonus = [0.003, 0.005, 0.008, 0.01, 0.013, 0.016, 0.018, 0.021, 0.024, 0.026, 0.029, 0.032, 0.034, 0.037, 0.04, 0.042, 0.045, 0.048, 0.05, 0.053, 0.056, 0.058, 0.061, 0.064, 0.067, 0.069, 0.072, 0.074, 0.077, 0.08];
const tierUnlocks = [1, 4, 7, 11, 13, 16, 19, 22, 26, 30];
const tierCosts = [
  [36, 27, 9], [58, 44, 13], [92, 69, 21], [120, 90, 26], [156, 117, 33],
  [186, 140, 40], [279, 210, 60], [558, 419, 119], [1394, 1046, 295], [2788, 2091, 590],
];
const tierTimeSec = [12, 17, 24, 32, 44, 60, 83, 113, 131, 152];
for (const buildingKey of ["building.armyCamp", "building.navalBase", "building.airfield"]) {
  const building = numbers.buildings[buildingKey];
  building.promotionUnlockLevel = 13;
  for (let level = 1; level <= 30; level += 1) {
    building.levels[String(level)].trainQueueSize = trainingCapacity[level - 1];
    building.levels[String(level)].trainSpeedMult = Number((1 + trainingSpeedBonus[level - 1]).toFixed(3));
  }
}
for (const troopKey of ["troop.army", "troop.navy", "troop.air"]) {
  const troop = numbers.troops[troopKey];
  for (let tier = 1; tier <= 10; tier += 1) {
    const row = troop.tiers[String(tier)];
    row.unlockAtTrainingBuilding = tierUnlocks[tier - 1];
    row.cost = {
      "res.cash": tierCosts[tier - 1][0],
      "res.oil": tierCosts[tier - 1][1],
      "res.power": tierCosts[tier - 1][2],
    };
    row.trainTimeSec = tierTimeSec[tier - 1];
  }
}
numbers.global.accountModifiers.note = "Base account modifiers. Completed Academy research is added per player at runtime; heroes can add another snapshot later.";
numbers.meta.version = "0.8";
numbers.meta.note = "Explicit city, troop, World and Academy tables. Academy and troop training use Kingshot-shaped gates, capacities and queue math adapted to RUGLANDS resources and combat.";

fs.writeFileSync(path, `${JSON.stringify(numbers, null, 2)}\n`);

console.log(JSON.stringify({ version: numbers.meta.version, branchTotals }, null, 2));
