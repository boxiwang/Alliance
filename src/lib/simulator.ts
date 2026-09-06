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
