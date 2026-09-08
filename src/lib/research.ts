// Academy research helpers. Data is fully explicit in docs/numbers.json; this file only
// evaluates gates, queues and completed passive effects.
import { getN } from "./numbers";

const N: any = getN();
const RESOURCE_KEYS = ["cash", "oil", "power"] as const;

export type ResearchBranch = "development" | "economy" | "battle";
export type ResearchLevels = Record<string, number>;

// Every playable effect is registered here with exactly one of the three tree
// categories. Validation uses this registry so a new data row cannot silently
// create an account bonus that no gameplay system understands.
export const RESEARCH_EFFECT_BRANCH = {
  constructionSpeedBonus: "development",
  researchSpeedBonus: "development",
  trainingCapacityBonus: "development",
  trainingSpeedBonus: "development",
  healingSpeedBonus: "development",
  hospitalCapacityBonus: "development",
  marchQueueBonus: "development",
  cashProductionBonus: "economy",
  cashGatherSpeedBonus: "economy",
  oilProductionBonus: "economy",
  oilGatherSpeedBonus: "economy",
  powerProductionBonus: "economy",
  powerGatherSpeedBonus: "economy",
  troopAttackBonus: "battle",
  troopDefenseBonus: "battle",
  troopHealthBonus: "battle",
  troopLethalityBonus: "battle",
  armyAttackBonus: "battle",
  armyDefenseBonus: "battle",
  armyHealthBonus: "battle",
  armyLethalityBonus: "battle",
  navyAttackBonus: "battle",
  navyDefenseBonus: "battle",
  navyHealthBonus: "battle",
  navyLethalityBonus: "battle",
  airAttackBonus: "battle",
  airDefenseBonus: "battle",
  airHealthBonus: "battle",
  airLethalityBonus: "battle",
  marchCapacityBonus: "battle",
} as const satisfies Record<string, ResearchBranch>;

export type ResearchEffectKey = keyof typeof RESEARCH_EFFECT_BRANCH;

export interface ResearchQueue {
  tech: string;
  targetLevel: number;
  durationSec: number;
  finishAt: number;
}

export interface ResearchEffect {
  key: string;
  value: number;
  unit: "percent" | "flat";
}

interface ResearchStateLike {
  buildings: { academy: { lvl: number; finishAt?: number } };
  res: Record<(typeof RESOURCE_KEYS)[number], number>;
  research: ResearchLevels;
  researchQueue: ResearchQueue;
}

export const EMPTY_RESEARCH_QUEUE: ResearchQueue = {
  tech: "",
  targetLevel: 0,
  durationSec: 0,
  finishAt: 0,
};

export function researchConfig(): any { return N.research; }

export function researchTech(key: string): any | null {
  return N.research?.techs?.[key] ?? null;
}

export function researchTechs(branch?: ResearchBranch): any[] {
  const familyOrder = [
    "rapidConstruction", "systemsOptimization", "mobilizationCapacity", "drillEfficiency", "emergencyTreatment", "medicalExpansion", "commandTactics",
    "cashOutput", "cashGathering", "oilOutput", "oilGathering", "powerOutput", "powerGathering",
    "weaponsPrep", "assaultTechniques", "defensiveTraining", "survivalTechniques",
    "armyAttack", "armyLethality", "armyDefense", "armyHealth",
    "navyAttack", "navyLethality", "navyDefense", "navyHealth",
    "airAttack", "airLethality", "airDefense", "airHealth", "regimentalExpansion",
  ];
  return Object.values(N.research?.techs ?? {})
    .filter((tech: any) => !branch || tech.branch === branch)
    .sort((left: any, right: any) => {
      const leftAcademy = researchLevelRow(left.key, 1)?.academyLevel ?? 1;
      const rightAcademy = researchLevelRow(right.key, 1)?.academyLevel ?? 1;
      return leftAcademy - rightAcademy || familyOrder.indexOf(left.family) - familyOrder.indexOf(right.family);
    });
}

/**
 * Places every technology after all of its prerequisites. The UI consumes
 * these layers to draw the tree directly from numbers.json, so changing a
 * prerequisite changes the visible route without a second hand-authored map.
 */
export function researchTreeLayers(branch: ResearchBranch): any[][] {
  const technologies = researchTechs(branch);
  const byKey = new Map(technologies.map((tech) => [tech.key, tech]));
  const depths = new Map<string, number>();

  function depthOf(tech: any, visiting = new Set<string>()): number {
    const cached = depths.get(tech.key);
    if (cached !== undefined) return cached;
    if (visiting.has(tech.key)) throw new Error(`Research prerequisite cycle at ${tech.key}`);
    const path = new Set(visiting);
    path.add(tech.key);
    const prerequisiteDepths = (tech.requirements ?? [])
      .map((requirement: any) => byKey.get(requirement.tech))
      .filter(Boolean)
      .map((prerequisite: any) => depthOf(prerequisite, path));
    const depth = prerequisiteDepths.length ? Math.max(...prerequisiteDepths) + 1 : 0;
    depths.set(tech.key, depth);
    return depth;
  }

  const layers: any[][] = [];
  technologies.forEach((tech) => { (layers[depthOf(tech)] ||= []).push(tech); });
  return layers;
}

export function researchLevel(state: Pick<ResearchStateLike, "research">, techKey: string): number {
  return Math.max(0, Math.floor(Number(state.research?.[techKey]) || 0));
}

export function researchLevelRow(techKey: string, level: number): any | null {
  return researchTech(techKey)?.levels?.[String(level)] ?? null;
}

export function researchCost(techKey: string, level: number): Record<(typeof RESOURCE_KEYS)[number], number> {
  const source = researchLevelRow(techKey, level)?.cost ?? {};
  return {
    cash: Math.max(0, Number(source["res.cash"]) || 0),
    oil: Math.max(0, Number(source["res.oil"]) || 0),
    power: Math.max(0, Number(source["res.power"]) || 0),
  };
}

export function researchModifiers(state: Pick<ResearchStateLike, "research">): Record<string, number> {
  const modifiers: Record<string, number> = {};
  for (const [techKey, rawLevel] of Object.entries(state.research ?? {})) {
    const level = Math.max(0, Math.floor(Number(rawLevel) || 0));
    const effect = researchLevelRow(techKey, level)?.effect as ResearchEffect | undefined;
    if (!effect) continue;
    modifiers[effect.key] = (modifiers[effect.key] ?? 0) + effect.value;
  }
  return modifiers;
}

export function researchMight(state: Pick<ResearchStateLike, "research">): number {
  return Math.round(Object.entries(state.research ?? {}).reduce((sum, [techKey, rawLevel]) => {
    const level = Math.max(0, Math.floor(Number(rawLevel) || 0));
    return sum + (Number(researchLevelRow(techKey, level)?.might) || 0);
  }, 0));
}

export function researchDurationSec(state: Pick<ResearchStateLike, "research">, techKey: string, level: number): number {
  const base = Math.max(0, Number(researchLevelRow(techKey, level)?.timeSec) || 0);
  const speed = Math.max(0, researchModifiers(state).researchSpeedBonus ?? 0);
  return Math.max(1, Math.ceil(base / (1 + speed)));
}

export function missingResearchRequirements(state: Pick<ResearchStateLike, "research">, techKey: string): Array<{ tech: string; level: number }> {
  const tech = researchTech(techKey);
  if (!tech) return [];
  return (tech.requirements ?? []).filter((requirement: any) =>
    researchLevel(state, requirement.tech) < requirement.level);
}

export function researchBlockReason(state: ResearchStateLike, techKey: string): string | null {
  const tech = researchTech(techKey);
  if (!tech) return "Unknown research";
  const current = researchLevel(state, techKey);
  if (current >= tech.maxLevel) return "Research complete";
  if ((state.buildings.academy.finishAt ?? 0) > 0) return "Research Institute is upgrading";
  if (state.researchQueue?.finishAt > 0) return "Research queue busy";
  const next = current + 1;
  const row = researchLevelRow(techKey, next);
  if (!row) return "Missing research level data";
  if (state.buildings.academy.lvl < row.academyLevel) return `Research Institute Lv.${row.academyLevel} required`;
  const missing = missingResearchRequirements(state, techKey);
  if (missing.length) {
    const requirement = researchTech(missing[0].tech);
    return `${requirement?.name ?? missing[0].tech} Lv.${missing[0].level} required`;
  }
  const cost = researchCost(techKey, next);
  if (RESOURCE_KEYS.some((resource) => state.res[resource] < cost[resource])) return "Not enough resources";
  return null;
}

export function beginResearch<T extends ResearchStateLike>(state: T, techKey: string, now: number): { state: T; ok: boolean; reason?: string } {
  const next: T = structuredClone(state);
  const reason = researchBlockReason(next, techKey);
  if (reason) return { state: next, ok: false, reason };
  const targetLevel = researchLevel(next, techKey) + 1;
  const cost = researchCost(techKey, targetLevel);
  RESOURCE_KEYS.forEach((resource) => { next.res[resource] -= cost[resource]; });
  const durationSec = researchDurationSec(next, techKey, targetLevel);
  next.researchQueue = { tech: techKey, targetLevel, durationSec, finishAt: now + durationSec * 1000 };
  return { state: next, ok: true };
}

export function finishResearchQueue<T extends ResearchStateLike>(state: T, now: number): T {
  const queue = state.researchQueue ?? EMPTY_RESEARCH_QUEUE;
  if (!queue.tech || queue.finishAt <= 0 || queue.finishAt > now) return state;
  const tech = researchTech(queue.tech);
  if (tech) state.research[queue.tech] = Math.min(tech.maxLevel, Math.max(researchLevel(state, queue.tech), queue.targetLevel));
  state.researchQueue = { ...EMPTY_RESEARCH_QUEUE };
  return state;
}

export function effectLabel(effect: ResearchEffect): string {
  if (effect.unit === "percent") return `+${(effect.value * 100).toFixed(effect.value * 100 < 10 ? 1 : 0)}%`;
  return `+${Math.round(effect.value).toLocaleString()}`;
}
