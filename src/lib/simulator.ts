export interface SimulationOptions {
  targetLevel: number;
  sessionsPerDay: number;
  queueUptime: number;
}

export interface SimulationMilestone {
  level: number;
  hours: number;
}

export interface SimulationResult {
  targetLevel: number;
  totalHours: number;
  totalDays: number;
  constructionHours: number;
  idleResourceHours: number;
  queueUtilization: number;
  milestones: SimulationMilestone[];
  deadlock?: string;
}

type RunningJob = { key: string; target: number; finishAt: number; duration: number };
type Candidate = { key: string; target: number; priority: number };

const RESOURCE_KEYS = ["res.cash", "res.oil", "res.power"];
const PRODUCER_BY_RESOURCE: Record<string, string> = {
  "res.cash": "building.bank",
  "res.oil": "building.oilwell",
  "res.power": "building.powerplant",
};

function row(numbers: any, key: string, level: number): any {
  return numbers.buildings?.[key]?.levels?.[String(level)] ?? null;
}

function prerequisites(numbers: any, targetLevel: number): string[] {
  return numbers.townhallPrerequisites?.perLevel?.[String(targetLevel)] ?? [];
}

function capacity(numbers: any, levels: Record<string, number>): number {
  const level = Math.max(1, levels["building.storage"] ?? 0);
  return row(numbers, "building.storage", level)?.capacityPerResource ?? 5000;
}

function rates(numbers: any, levels: Record<string, number>, collectionEfficiency: number): Record<string, number> {
  const result: Record<string, number> = {};
  for (const resource of RESOURCE_KEYS) {
    const producer = PRODUCER_BY_RESOURCE[resource];
    const level = levels[producer] ?? 0;
    result[resource] = level > 0
      ? (row(numbers, producer, level)?.productionPerHour ?? 0) * collectionEfficiency
      : 0;
  }
  return result;
}

function cost(numbers: any, candidate: Candidate): Record<string, number> {
  return row(numbers, candidate.key, candidate.target)?.cost ?? {};
}

function canAfford(resources: Record<string, number>, jobCost: Record<string, number>): boolean {
  return RESOURCE_KEYS.every((resource) => (resources[resource] ?? 0) + 1e-6 >= (jobCost[resource] ?? 0));
}

function nextCandidates(
  numbers: any,
  levels: Record<string, number>,
  running: RunningJob[],
  targetLevel: number,
): Candidate[] {
  const keepKey = "building.keep";
  const keepLevel = levels[keepKey] ?? 1;
  const busy = new Set(running.map((job) => job.key));
  const candidates: Candidate[] = [];

  if (!busy.has(keepKey) && keepLevel < targetLevel) {
    const next = keepLevel + 1;
    const ready = prerequisites(numbers, next).every((key) => (levels[key] ?? 0) >= next - 1);
    if (ready) candidates.push({ key: keepKey, target: next, priority: -1000 });
  }

  const seen = new Set<string>();
  // Only look one Townhall beyond the immediate target. This keeps the model
  // from spending scarce early resources on distant late-game prerequisites.
  for (let future = keepLevel + 1; future <= Math.min(targetLevel, keepLevel + 2); future += 1) {
    for (const key of prerequisites(numbers, future)) {
      if (busy.has(key) || seen.has(key)) continue;
      const configured = numbers.buildings?.[key];
      if (!configured) continue;
      const current = levels[key] ?? 0;
      const desired = Math.min(keepLevel, future - 1);
      const next = current + 1;
      if (current >= desired || next > (configured.maxLevel ?? 30)) continue;
      if (keepLevel < (configured.unlockAtKeep ?? 1)) continue;
      candidates.push({ key, target: next, priority: future * 10 + current });
      seen.add(key);
    }
  }

  return candidates.sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
}

function waitToAfford(
  resources: Record<string, number>,
  production: Record<string, number>,
  jobCost: Record<string, number>,
  cap: number,
): number {
  let hours = 0;
  for (const resource of RESOURCE_KEYS) {
    const needed = jobCost[resource] ?? 0;
    if (needed > cap) return Number.POSITIVE_INFINITY;
    const deficit = Math.max(0, needed - (resources[resource] ?? 0));
    if (deficit < 1e-6) continue;
    if (deficit === 0) continue;
    const rate = production[resource] ?? 0;
    if (rate <= 0) return Number.POSITIVE_INFINITY;
    hours = Math.max(hours, deficit / rate);
  }
  return hours;
}

export function simulateProgression(numbers: any, options: SimulationOptions): SimulationResult {
  const slots = Math.max(1, numbers.global?.buildQueueSlots ?? 2);
  const capHours = Math.max(0, numbers.global?.offline?.collectorCapHours ?? 12);
  const collectionEfficiency = Math.min(1, Math.max(0, options.sessionsPerDay * capHours / 24));
  const queueUptime = Math.min(1, Math.max(0.05, options.queueUptime));
  const levels: Record<string, number> = {};
  const prebuilt = new Set(numbers.startingLayout?.prebuilt ?? []);
  for (const key of Object.keys(numbers.buildings ?? {})) {
    levels[key] = key === "building.keep" || prebuilt.has(key) ? 1 : 0;
  }
  const resources: Record<string, number> = {};
  for (const resource of RESOURCE_KEYS) resources[resource] = numbers.startingLayout?.startingResources?.[resource] ?? 0;

  let now = 0;
  let constructionHours = 0;
  let idleResourceHours = 0;
  let running: RunningJob[] = [];
  let deadlock: string | undefined;
  const milestones: SimulationMilestone[] = [{ level: 1, hours: 0 }];

  const advance = (next: number, resourceIdle: boolean) => {
    const delta = Math.max(0, next - now);
    const production = rates(numbers, levels, collectionEfficiency);
    const cap = capacity(numbers, levels);
    for (const resource of RESOURCE_KEYS) {
      resources[resource] = Math.min(cap, (resources[resource] ?? 0) + production[resource] * delta);
    }
    if (resourceIdle) idleResourceHours += delta;
    now = next;
    const completed = running.filter((job) => job.finishAt <= now + 1e-9);
    running = running.filter((job) => job.finishAt > now + 1e-9);
    for (const job of completed) {
      levels[job.key] = job.target;
      if (job.key === "building.keep") milestones.push({ level: job.target, hours: now });
    }
  };

  let iterations = 0;
  for (; iterations < 100000 && (levels["building.keep"] ?? 1) < options.targetLevel; iterations += 1) {
    while (running.length < slots) {
      const candidates = nextCandidates(numbers, levels, running, options.targetLevel);
      if (candidates.length === 0) break;
      const affordable = candidates.find((candidate) => canAfford(resources, cost(numbers, candidate)));
      if (!affordable) break;
      const jobCost = cost(numbers, affordable);
      for (const resource of RESOURCE_KEYS) resources[resource] -= jobCost[resource] ?? 0;
      const baseDuration = (row(numbers, affordable.key, affordable.target)?.timeSec ?? 0) / 3600;
      const duration = baseDuration / queueUptime;
      constructionHours += baseDuration;
      running.push({ key: affordable.key, target: affordable.target, finishAt: now + duration, duration });
      if (duration === 0) {
        advance(now, false);
      }
    }

    if ((levels["building.keep"] ?? 1) >= options.targetLevel) break;
    const candidates = running.length < slots
      ? nextCandidates(numbers, levels, running, options.targetLevel)
      : [];
    const nextFinish = running.length > 0 ? Math.min(...running.map((job) => job.finishAt)) : Number.POSITIVE_INFINITY;
    const production = rates(numbers, levels, collectionEfficiency);
    const cap = capacity(numbers, levels);
    let resourceReady = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
      resourceReady = Math.min(resourceReady, waitToAfford(resources, production, cost(numbers, candidate), cap));
    }
    if (Number.isFinite(resourceReady)) resourceReady += now;

    const nextEvent = Math.min(nextFinish, resourceReady);
    if (!Number.isFinite(nextEvent)) {
      deadlock = candidates.length > 0
        ? `A required upgrade costs more than storage or has no producing resource at Townhall Lv.${levels["building.keep"]}.`
        : `No valid upgrade path found at Townhall Lv.${levels["building.keep"]}.`;
      break;
    }
    const resourceIdle = running.length === 0 && resourceReady <= nextFinish;
    advance(nextEvent, resourceIdle);
  }

  if (!deadlock && (levels["building.keep"] ?? 1) < options.targetLevel && iterations >= 100000) {
    deadlock = `Simulation iteration limit reached at Townhall Lv.${levels["building.keep"]}.`;
  }

  const totalHours = now;
  return {
    targetLevel: options.targetLevel,
    totalHours,
    totalDays: totalHours / 24,
    constructionHours,
    idleResourceHours,
    queueUtilization: totalHours > 0 ? constructionHours / (slots * totalHours) : 0,
    milestones,
    deadlock,
  };
}

export type PersonalSimulationStrategy = "growth" | "balanced" | "military";

export interface PersonalSimulationOptions extends SimulationOptions {
  strategy: PersonalSimulationStrategy;
  researchUptime: number;
  trainingUptime: number;
  fullNodeHarvestsPerDay: number;
}

type ResourceTotals = Record<string, number>;

export interface PersonalSimulationResult {
  targetLevel: number;
  reachedLevel: number;
  totalHours: number;
  totalDays: number;
  milestones: SimulationMilestone[];
  deadlock?: string;
  resources: {
    starting: ResourceTotals;
    cityProduction: ResourceTotals;
    worldGathering: ResourceTotals;
    buildingSpend: ResourceTotals;
    researchSpend: ResourceTotals;
    trainingSpend: ResourceTotals;
    overflow: ResourceTotals;
    ending: ResourceTotals;
  };
  queues: {
    builders: number;
    research: number;
    army: number;
    navy: number;
    air: number;
  };
  waiting: {
    buildersForResources: number;
    researchForResources: number;
    trainingForResources: number;
  };
  research: {
    upgrades: number;
    byBranch: Record<string, number>;
    might: number;
    modifiers: Record<string, number>;
  };
  troops: {
    army: number;
    navy: number;
    air: number;
    total: number;
    might: number;
  };
  bottleneck: string;
}

type IntegratedBuildJob = RunningJob;
type IntegratedResearchJob = { tech: string; target: number; finishAt: number };
type IntegratedTrainingJob = { arm: "army" | "navy" | "air"; tier: number; quantity: number; finishAt: number };

const ARMS = ["army", "navy", "air"] as const;
const TRAINING_BUILDING: Record<(typeof ARMS)[number], string> = {
  army: "building.armyCamp", navy: "building.navalBase", air: "building.airfield",
};
const TROOP_KEY: Record<(typeof ARMS)[number], string> = {
  army: "troop.army", navy: "troop.navy", air: "troop.air",
};

function emptyResources(): ResourceTotals {
  return { "res.cash": 0, "res.oil": 0, "res.power": 0 };
}

function integratedResearchModifiers(numbers: any, completed: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  Object.entries(completed).forEach(([techKey, rawLevel]) => {
    const effect = numbers.research?.techs?.[techKey]?.levels?.[String(rawLevel)]?.effect;
    if (effect?.key) result[effect.key] = (result[effect.key] ?? 0) + (Number(effect.value) || 0);
  });
  return result;
}

function integratedResearchCandidates(
  numbers: any,
  completed: Record<string, number>,
  academyLevel: number,
  strategy: PersonalSimulationStrategy,
): Array<{ tech: any; target: number; row: any }> {
  const branchPriority: Record<PersonalSimulationStrategy, Record<string, number>> = {
    growth: { development: 0, economy: 1, battle: 2 },
    balanced: { development: 0, economy: 0, battle: 0 },
    military: { battle: 0, development: 1, economy: 2 },
  };
  const branchCounts = { development: 0, economy: 0, battle: 0 } as Record<string, number>;
  Object.entries(completed).forEach(([key, level]) => {
    const branch = numbers.research?.techs?.[key]?.branch;
    if (branch) branchCounts[branch] = (branchCounts[branch] ?? 0) + level;
  });
  return (Object.values(numbers.research?.techs ?? {}) as any[]).flatMap((tech) => {
    const current = Math.max(0, Math.floor(completed[tech.key] ?? 0));
    const target = current + 1;
    const levelRow = tech.levels?.[String(target)];
    if (!levelRow || target > tech.maxLevel || Number(levelRow.academyLevel) > academyLevel) return [];
    const ready = (tech.requirements ?? []).every((requirement: any) =>
      (completed[requirement.tech] ?? 0) >= requirement.level);
    return ready ? [{ tech, target, row: levelRow }] : [];
  }).sort((left, right) => {
    if (strategy === "balanced") {
      const branchDifference = (branchCounts[left.tech.branch] ?? 0) - (branchCounts[right.tech.branch] ?? 0);
      if (branchDifference) return branchDifference;
    }
    return (branchPriority[strategy][left.tech.branch] ?? 9) - (branchPriority[strategy][right.tech.branch] ?? 9)
      || Number(left.row.academyLevel) - Number(right.row.academyLevel)
      || left.tech.key.localeCompare(right.tech.key);
  });
}

function highestUnlockedTier(numbers: any, arm: (typeof ARMS)[number], buildingLevel: number): number {
  let best = 0;
  Object.entries(numbers.troops?.[TROOP_KEY[arm]]?.tiers ?? {}).forEach(([tierText, value]: [string, any]) => {
    if (Number(value.unlockAtTrainingBuilding) <= buildingLevel) best = Math.max(best, Number(tierText));
  });
  return best;
}

function integratedBuildCandidates(
  numbers: any,
  levels: Record<string, number>,
  running: RunningJob[],
  targetLevel: number,
  strategy: PersonalSimulationStrategy,
): Candidate[] {
  const result = nextCandidates(numbers, levels, running, targetLevel);
  const present = new Set(result.map((candidate) => candidate.key));
  const busy = new Set(running.map((job) => job.key));
  const keepLevel = levels["building.keep"] ?? 1;
  const support = ["building.academy", ...ARMS.map((arm) => TRAINING_BUILDING[arm])];
  const preferred = strategy === "growth"
    ? ["building.academy"]
    : strategy === "military"
      ? ARMS.map((arm) => TRAINING_BUILDING[arm])
      : support;

  support.forEach((key) => {
    const configured = numbers.buildings?.[key];
    const current = levels[key] ?? 0;
    const desired = Math.min(keepLevel, Number(configured?.maxLevel) || 30);
    if (!configured || present.has(key) || busy.has(key) || current >= desired) return;
    if (keepLevel < (Number(configured.unlockAtKeep) || 1)) return;
    result.push({
      key,
      target: current + 1,
      // A ready Townhall remains first. Immediate mandatory prerequisites remain ahead of
      // support buildings, while the spare builder grows the account's research and armies.
      priority: 35 + current + (preferred.includes(key) ? 0 : 5),
    });
  });
  return result.sort((left, right) => left.priority - right.priority || left.key.localeCompare(right.key));
}

function accessibleWorldLevel(numbers: any, townhall: number): number {
  let best = 1;
  Object.entries(numbers.world?.monsters?.levels ?? {}).forEach(([levelText, value]: [string, any]) => {
    if ((Number(value.expectedTownhall) || 1) <= townhall) best = Math.max(best, Number(levelText));
  });
  return best;
}

/**
 * Deterministic whole-account planning model. It deliberately gives construction first claim on
 * resources, then follows the selected research/training strategy. It is a tuning instrument, not
 * a claim that real players click with perfect efficiency.
 */
export function simulatePersonalProgression(numbers: any, options: PersonalSimulationOptions): PersonalSimulationResult {
  const targetLevel = Math.max(2, Math.min(30, Math.floor(options.targetLevel)));
  const collectionEfficiency = Math.min(1, Math.max(0, options.sessionsPerDay * (Number(numbers.global?.offline?.collectorCapHours) || 12) / 24));
  const builderUptime = Math.min(1, Math.max(.05, options.queueUptime));
  const researchUptime = Math.min(1, Math.max(.05, options.researchUptime));
  const trainingUptime = Math.min(1, Math.max(.05, options.trainingUptime));
  const buildSlots = Math.max(1, Math.floor(Number(numbers.global?.buildQueueSlots) || 1));
  const levels: Record<string, number> = {};
  const prebuilt = new Set(numbers.startingLayout?.prebuilt ?? []);
  Object.keys(numbers.buildings ?? {}).forEach((key) => { levels[key] = key === "building.keep" || prebuilt.has(key) ? 1 : 0; });
  const starting = emptyResources();
  RESOURCE_KEYS.forEach((resource) => { starting[resource] = Number(numbers.startingLayout?.startingResources?.[resource]) || 0; });
  const resources = { ...starting };
  const cityProduction = emptyResources();
  const worldGathering = emptyResources();
  const buildingSpend = emptyResources();
  const researchSpend = emptyResources();
  const trainingSpend = emptyResources();
  const overflow = emptyResources();
  const completedResearch: Record<string, number> = {};
  const troops = { army: 0, navy: 0, air: 0 };
  const troopMight = { army: 0, navy: 0, air: 0 };
  let buildJobs: IntegratedBuildJob[] = [];
  let researchJob: IntegratedResearchJob | null = null;
  let trainingJobs: IntegratedTrainingJob[] = [];
  let now = 0;
  let deadlock: string | undefined;
  const milestones: SimulationMilestone[] = [{ level: 1, hours: 0 }];
  const busy = { builders: 0, research: 0, army: 0, navy: 0, air: 0 };
  const waiting = { buildersForResources: 0, researchForResources: 0, trainingForResources: 0 };

  const researchModifiers = () => integratedResearchModifiers(numbers, completedResearch);
  const cityRates = () => {
    const base = rates(numbers, levels, collectionEfficiency);
    const modifiers = researchModifiers();
    return {
      "res.cash": base["res.cash"] * (1 + (modifiers.cashProductionBonus ?? 0)),
      "res.oil": base["res.oil"] * (1 + (modifiers.oilProductionBonus ?? 0)),
      "res.power": base["res.power"] * (1 + (modifiers.powerProductionBonus ?? 0)),
    };
  };
  const worldRates = () => {
    if (troops.army + troops.navy + troops.air <= 0 || options.fullNodeHarvestsPerDay <= 0) return emptyResources();
    const level = accessibleWorldLevel(numbers, levels["building.keep"] ?? 1);
    const supply = Number(numbers.gatherNodes?.levels?.[String(level)]?.totalSupply) || 0;
    const modifiers = researchModifiers();
    const base = supply * options.fullNodeHarvestsPerDay / 3 / 24;
    return {
      "res.cash": base * (1 + (modifiers.cashGatherSpeedBonus ?? 0)),
      "res.oil": base * (1 + (modifiers.oilGatherSpeedBonus ?? 0)),
      "res.power": base * (1 + (modifiers.powerGatherSpeedBonus ?? 0)),
    };
  };
  const advance = (next: number, flags: { buildWait: boolean; researchWait: boolean; trainingWait: boolean }) => {
    const delta = Math.max(0, next - now);
    const city = cityRates(); const world = worldRates(); const cap = capacity(numbers, levels);
    RESOURCE_KEYS.forEach((resource) => {
      const cityGain = city[resource] * delta; const worldGain = world[resource] * delta;
      const offered = cityGain + worldGain; const room = Math.max(0, cap - resources[resource]);
      const accepted = Math.min(room, offered);
      resources[resource] += accepted;
      cityProduction[resource] += cityGain;
      worldGathering[resource] += worldGain;
      overflow[resource] += Math.max(0, offered - accepted);
    });
    busy.builders += buildJobs.length * delta;
    if (researchJob) busy.research += delta;
    ARMS.forEach((arm) => { if (trainingJobs.some((job) => job.arm === arm)) busy[arm] += delta; });
    if (flags.buildWait) waiting.buildersForResources += delta;
    if (flags.researchWait) waiting.researchForResources += delta;
    if (flags.trainingWait) waiting.trainingForResources += delta;
    now = next;
    const completedBuilds = buildJobs.filter((job) => job.finishAt <= now + 1e-9);
    buildJobs = buildJobs.filter((job) => job.finishAt > now + 1e-9);
    completedBuilds.forEach((job) => {
      levels[job.key] = job.target;
      if (job.key === "building.keep") milestones.push({ level: job.target, hours: now });
    });
    if (researchJob && researchJob.finishAt <= now + 1e-9) {
      completedResearch[researchJob.tech] = researchJob.target;
      researchJob = null;
    }
    const completedTraining = trainingJobs.filter((job) => job.finishAt <= now + 1e-9);
    trainingJobs = trainingJobs.filter((job) => job.finishAt > now + 1e-9);
    completedTraining.forEach((job) => {
      troops[job.arm] += job.quantity;
      const power = Number(numbers.troops?.[TROOP_KEY[job.arm]]?.tiers?.[String(job.tier)]?.power) || 0;
      troopMight[job.arm] += job.quantity * power;
    });
  };
  const spend = (costValue: Record<string, number>, bucket: ResourceTotals, multiplier = 1) => {
    RESOURCE_KEYS.forEach((resource) => {
      const amount = (Number(costValue?.[resource]) || 0) * multiplier;
      resources[resource] -= amount; bucket[resource] += amount;
    });
  };
  const affordable = (costValue: Record<string, number>, multiplier = 1, reserve?: Record<string, number>) =>
    RESOURCE_KEYS.every((resource) => resources[resource] + 1e-6 >= (Number(costValue?.[resource]) || 0) * multiplier + (Number(reserve?.[resource]) || 0));

  let iterations = 0;
  while ((levels["building.keep"] ?? 1) < targetLevel && iterations++ < 100000) {
    const modifiers = researchModifiers();
    const lockedBuildings = new Set(trainingJobs.map((job) => TRAINING_BUILDING[job.arm]));
    if (researchJob) lockedBuildings.add("building.academy");
    let buildCandidates = integratedBuildCandidates(numbers, levels, buildJobs, targetLevel, options.strategy)
      .filter((candidate) => !lockedBuildings.has(candidate.key));
    while (buildJobs.length < buildSlots) {
      const candidate = buildCandidates.find((value) => affordable(cost(numbers, value)));
      if (!candidate) break;
      const jobCost = cost(numbers, candidate); spend(jobCost, buildingSpend);
      const baseHours = (Number(row(numbers, candidate.key, candidate.target)?.timeSec) || 0) / 3600;
      const duration = baseHours / Math.max(.01, builderUptime * (1 + (modifiers.constructionSpeedBonus ?? 0)));
      buildJobs.push({ key: candidate.key, target: candidate.target, finishAt: now + Math.max(1 / 3600, duration), duration });
      buildCandidates = integratedBuildCandidates(numbers, levels, buildJobs, targetLevel, options.strategy).filter((value) => !lockedBuildings.has(value.key));
    }

    const academyUpgrading = buildJobs.some((job) => job.key === "building.academy");
    const startResearch = () => {
      if (researchJob || academyUpgrading || (levels["building.academy"] ?? 0) <= 0) return;
      const candidate = integratedResearchCandidates(numbers, completedResearch, levels["building.academy"], options.strategy)
        .find((value) => affordable(value.row.cost ?? {}));
      if (!candidate) return;
      spend(candidate.row.cost ?? {}, researchSpend);
      const duration = (Number(candidate.row.timeSec) || 0) / 3600
        / Math.max(.01, researchUptime * (1 + (modifiers.researchSpeedBonus ?? 0)));
      researchJob = { tech: candidate.tech.key, target: candidate.target, finishAt: now + Math.max(1 / 3600, duration) };
    };

    const startTraining = () => {
      ARMS.forEach((arm) => {
        if (trainingJobs.some((job) => job.arm === arm) || buildJobs.some((job) => job.key === TRAINING_BUILDING[arm])) return;
        const buildingLevel = levels[TRAINING_BUILDING[arm]] ?? 0;
        if (buildingLevel <= 0) return;
        const buildingRow = row(numbers, TRAINING_BUILDING[arm], buildingLevel) ?? {};
        const armCapacity = Number(buildingRow.troopCapacity) || 0;
        const openCapacity = Math.max(0, armCapacity - troops[arm]);
        const tier = highestUnlockedTier(numbers, arm, buildingLevel);
        if (openCapacity <= 0 || tier <= 0) return;
        const troopRow = numbers.troops?.[TROOP_KEY[arm]]?.tiers?.[String(tier)] ?? {};
        const queueSize = Math.max(1, Math.floor((Number(buildingRow.trainQueueSize) || 1) + (modifiers.trainingCapacityBonus ?? 0)));
        const quantity = Math.min(openCapacity, queueSize);
        const nextBuild = integratedBuildCandidates(numbers, levels, buildJobs, targetLevel, options.strategy)[0];
        const reserveFactor = options.strategy === "growth" ? 1 : options.strategy === "balanced" ? .5 : 0;
        const reserve = nextBuild ? Object.fromEntries(RESOURCE_KEYS.map((resource) => [resource, (Number(cost(numbers, nextBuild)?.[resource]) || 0) * reserveFactor])) : emptyResources();
        if (!affordable(troopRow.cost ?? {}, quantity, reserve)) return;
        spend(troopRow.cost ?? {}, trainingSpend, quantity);
        const speed = Math.max(.01, (Number(buildingRow.trainSpeedMult) || 1) * (1 + (modifiers.trainingSpeedBonus ?? 0)) * trainingUptime);
        const duration = (Number(troopRow.trainTimeSec) || 0) * quantity / 3600 / speed;
        trainingJobs.push({ arm, tier, quantity, finishAt: now + Math.max(1 / 3600, duration) });
      });
    };
    if (options.strategy === "military") { startTraining(); startResearch(); }
    else { startResearch(); startTraining(); }

    if ((levels["building.keep"] ?? 1) >= targetLevel) break;
    const completionTimes = [
      ...buildJobs.map((job) => job.finishAt),
      ...(researchJob ? [researchJob.finishAt] : []),
      ...trainingJobs.map((job) => job.finishAt),
    ].filter((value) => value > now + 1e-9);
    buildCandidates = integratedBuildCandidates(numbers, levels, buildJobs, targetLevel, options.strategy).filter((candidate) => !lockedBuildings.has(candidate.key));
    const researchCandidates = !researchJob && !academyUpgrading
      ? integratedResearchCandidates(numbers, completedResearch, levels["building.academy"] ?? 0, options.strategy)
      : [];
    const buildWait = buildJobs.length < buildSlots && buildCandidates.length > 0 && !buildCandidates.some((candidate) => affordable(cost(numbers, candidate)));
    const researchWait = !researchJob && researchCandidates.length > 0 && !researchCandidates.some((candidate) => affordable(candidate.row.cost ?? {}));
    const trainingWait = ARMS.some((arm) => {
      const buildingLevel = levels[TRAINING_BUILDING[arm]] ?? 0;
      return buildingLevel > 0 && !trainingJobs.some((job) => job.arm === arm)
        && troops[arm] < (Number(row(numbers, TRAINING_BUILDING[arm], buildingLevel)?.troopCapacity) || 0);
    });
    const income = cityRates(); const outdoors = worldRates(); const cap = capacity(numbers, levels);
    let resourceReady = Number.POSITIVE_INFINITY;
    const considerCost = (costValue: Record<string, number>) => {
      let wait = 0;
      for (const resource of RESOURCE_KEYS) {
        const needed = Number(costValue?.[resource]) || 0;
        if (needed > cap) return;
        const deficit = Math.max(0, needed - resources[resource]);
        const rate = income[resource] + outdoors[resource];
        if (deficit > 0 && rate <= 0) return;
        wait = Math.max(wait, rate > 0 ? deficit / rate : 0);
      }
      if (wait > 1e-9) resourceReady = Math.min(resourceReady, now + wait);
    };
    if (buildWait) buildCandidates.forEach((candidate) => considerCost(cost(numbers, candidate)));
    if (researchWait) researchCandidates.forEach((candidate) => considerCost(candidate.row.cost ?? {}));
    const nextEvent = Math.min(...completionTimes, resourceReady);
    if (!Number.isFinite(nextEvent)) {
      deadlock = `No funded build path remains at Townhall Lv.${levels["building.keep"] ?? 1}.`;
      break;
    }
    advance(nextEvent, { buildWait, researchWait, trainingWait });
  }
  if (!deadlock && iterations >= 100000) deadlock = `Integrated simulation iteration limit reached at Townhall Lv.${levels["building.keep"] ?? 1}.`;

  const finalModifiers = researchModifiers();
  const byBranch = { development: 0, economy: 0, battle: 0 } as Record<string, number>;
  let researchMight = 0;
  Object.entries(completedResearch).forEach(([key, level]) => {
    const tech = numbers.research?.techs?.[key];
    if (tech?.branch) byBranch[tech.branch] += level;
    researchMight += Number(tech?.levels?.[String(level)]?.might) || 0;
  });
  const totalHours = now;
  const queueRatio = (hours: number, slots = 1) => totalHours > 0 ? Math.min(1, hours / (totalHours * slots)) : 0;
  const deficitScores = RESOURCE_KEYS.map((resource) => ({
    resource,
    spend: buildingSpend[resource] + researchSpend[resource] + trainingSpend[resource],
    source: starting[resource] + cityProduction[resource] + worldGathering[resource],
  })).sort((left, right) => right.spend / Math.max(1, right.source) - left.spend / Math.max(1, left.source));
  return {
    targetLevel, reachedLevel: levels["building.keep"] ?? 1, totalHours, totalDays: totalHours / 24,
    milestones, deadlock,
    resources: { starting, cityProduction, worldGathering, buildingSpend, researchSpend, trainingSpend, overflow, ending: { ...resources } },
    queues: {
      builders: queueRatio(busy.builders, buildSlots), research: queueRatio(busy.research),
      army: queueRatio(busy.army), navy: queueRatio(busy.navy), air: queueRatio(busy.air),
    },
    waiting,
    research: {
      upgrades: Object.values(completedResearch).reduce((sum, level) => sum + level, 0),
      byBranch, might: researchMight, modifiers: finalModifiers,
    },
    troops: {
      ...troops, total: troops.army + troops.navy + troops.air,
      might: troopMight.army + troopMight.navy + troopMight.air,
    },
    bottleneck: deficitScores[0]?.resource.replace("res.", "") ?? "none",
  };
}
