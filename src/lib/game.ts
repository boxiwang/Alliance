// Solo-mode game logic — PURE functions, keyed by bible Keys, driven by docs/numbers.json.
// Render / persistence / identity are swappable around this. Times in seconds, prod per hour.
import { getN } from "./numbers";
import {
  ResearchQueue, beginResearch, finishResearchQueue,
  researchMight, researchModifiers,
} from "./research";
const N: any = getN(); // effective numbers (admin override or defaults), read at load

export type ResKey = "cash" | "oil" | "power";
export type TroopKey = "army" | "navy" | "air";
export type TroopRoster = Record<TroopKey, Record<string, number>>;
export type BKey =
  | "keep" | "bank" | "oilwell" | "powerplant" | "storage" | "armyCamp" | "navalBase" | "airfield"
  | "hospital" | "embassy" | "wall" | "academy" | "watchtower" | "milestone";

export interface BuildingState {
  lvl: number; // 0 = not built yet
  finishAt: number; // epoch ms of in-progress upgrade, 0 = idle
  durationSec?: number; // snapshotted when an upgrade starts, after speed bonuses
}
export interface TrainState {
  mode: "train" | "promote";
  sourceTier: number; // 0 for new troops; populated when existing troops are promoted
  tier: number;
  qty: number;
  per: number; // seconds per troop
  finishAt: number;
}
export interface HealState {
  troops: TroopRoster;
  qty: number;
  durationSec: number;
  finishAt: number;
}
export interface GameState {
  address: string;
  buildings: Record<BKey, BuildingState>;
  res: Record<ResKey, number>;
  troops: TroopRoster;
  wounded: number;
  woundedTroops: TroopRoster;
  healing: HealState;
  training: Record<TroopKey, TrainState>;
  research: Record<string, number>;
  researchQueue: ResearchQueue;
  lastTick: number;
}

// Display meta (labels are neutral placeholders — themed names come from the bible later).
export const BUILDINGS: Record<BKey, { label: string; emoji: string; produces?: ResKey; trains?: TroopKey; blurb: string; upgradable: boolean }> = {
  keep:       { label: "Townhall",            emoji: "🏰", blurb: "Gates everything, unlocks buildings. Shield lifts at L10.", upgradable: true },
  bank:       { label: "Bank",                emoji: "🏦", produces: "cash",  blurb: "Produces Cash over time.", upgradable: true },
  oilwell:    { label: "Oil Well",            emoji: "🛢️", produces: "oil",   blurb: "Produces Oil over time.", upgradable: true },
  powerplant: { label: "Power Plant",         emoji: "⚡", produces: "power", blurb: "Produces Power over time.", upgradable: true },
  storage:    { label: "Warehouse",           emoji: "📦", blurb: "Raises resource capacity + raid protection.", upgradable: true },
  armyCamp:   { label: "Army Camp",           emoji: "🪖", trains: "army", blurb: "Trains Army units. Its level unlocks higher Army tiers.", upgradable: true },
  navalBase:  { label: "Naval Base",          emoji: "⚓", trains: "navy", blurb: "Trains Navy units. Its level unlocks higher Navy tiers.", upgradable: true },
  airfield:   { label: "Airfield",            emoji: "✈️", trains: "air", blurb: "Trains Air units. Its level unlocks higher Air tiers.", upgradable: true },
  hospital:   { label: "Hospital",            emoji: "⛑️", blurb: "Heals wounded troops.", upgradable: true },
  embassy:    { label: "Embassy",             emoji: "🏛️", blurb: "Receives allied reinforcement troops (capacity). Coming soon.", upgradable: true },
  wall:       { label: "Wall",                emoji: "🧱", blurb: "Adds defense against raids.", upgradable: true },
  academy:    { label: "Research Institute",  emoji: "🔬", blurb: "Runs Development, Economy and Battle research. Its level unlocks new technology.", upgradable: true },
  watchtower: { label: "Watchtower",          emoji: "🗼", blurb: "Issues solo (PvE) tasks/quests. Coming soon.", upgradable: true },
  milestone:  { label: "Monument",            emoji: "🗽", blurb: "Server-wide progress — coming soon.", upgradable: false },
};
export const RES: Record<ResKey, { label: string; emoji: string }> = {
  cash:  { label: "Cash",  emoji: "💵" },
  oil:   { label: "Oil",   emoji: "🛢️" },
  power: { label: "Power", emoji: "⚡" },
};
export const TROOPS_META: Record<TroopKey, { label: string; emoji: string }> = {
  army: { label: "Army", emoji: "🪖" },
  navy: { label: "Navy", emoji: "⚓" },
  air:  { label: "Air",  emoji: "✈️" },
};
export const BUILDING_ORDER: BKey[] = [
  "keep", "bank", "oilwell", "powerplant", "storage", "armyCamp", "navalBase", "airfield",
  "hospital", "embassy", "wall", "academy", "watchtower", "milestone",
];
export const TROOP_ORDER: TroopKey[] = ["army", "navy", "air"];
export const RES_ORDER: ResKey[] = ["cash", "oil", "power"];
export const TRAINING_BUILDING: Record<TroopKey, BKey> = {
  army: "armyCamp",
  navy: "navalBase",
  air: "airfield",
};
const TRAINING_TYPE_BY_BUILDING: Partial<Record<BKey, TroopKey>> = {
  armyCamp: "army",
  navalBase: "navy",
  airfield: "air",
};

function emptyTrainingQueue(tier = 1): TrainState {
  return { mode: "train", sourceTier: 0, tier, qty: 0, per: 0, finishAt: 0 };
}

export function emptyTroopRoster(): TroopRoster {
  const roster = { army: {}, navy: {}, air: {} } as TroopRoster;
  TROOP_ORDER.forEach((type) => {
    for (let tier = 1; tier <= 10; tier += 1) roster[type][String(tier)] = 0;
  });
  return roster;
}

export function troopRosterCount(roster: TroopRoster | undefined): number {
  if (!roster) return 0;
  return TROOP_ORDER.reduce((total, type) => total
    + Object.values(roster[type] ?? {}).reduce((sum, qty) => sum + Math.max(0, Number(qty) || 0), 0), 0);
}

function emptyHealingQueue(): HealState {
  return { troops: emptyTroopRoster(), qty: 0, durationSec: 0, finishAt: 0 };
}

function selectWounded(roster: TroopRoster, requested: number): TroopRoster {
  const selected = emptyTroopRoster();
  let remaining = Math.max(0, Math.floor(requested));
  // Restore valuable high tiers first; the cost/time model is tier-neutral.
  for (let tier = 10; tier >= 1 && remaining > 0; tier -= 1) {
    TROOP_ORDER.forEach((type) => {
      const available = Math.max(0, roster[type]?.[String(tier)] ?? 0);
      const amount = Math.min(remaining, available);
      selected[type][String(tier)] = amount;
      remaining -= amount;
    });
  }
  return selected;
}

export function buildingOperationBlockReason(s: GameState, building: BKey): string | null {
  if (building === "academy" && s.researchQueue.finishAt > 0) return "Finish current research before upgrading Research Institute";
  const trainingType = TRAINING_TYPE_BY_BUILDING[building];
  if (trainingType && s.training[trainingType].finishAt > 0) return `Finish current training before upgrading ${BUILDINGS[building].label}`;
  if (building === "hospital" && s.healing.finishAt > 0) return "Finish current healing before upgrading Hospital";
  return null;
}

const nb = (k: BKey): any => (N as any).buildings["building." + k];
const nt = (t: TroopKey): any => (N as any).troops["troop." + t];
const RESKEY_OF: Record<ResKey, string> = { cash: "res.cash", oil: "res.oil", power: "res.power" };

export function buildingLevelRow(k: BKey, level: number): any {
  return nb(k)?.levels?.[String(level)] ?? null;
}

export function troopTierRow(t: TroopKey, tier: number): any {
  return nt(t)?.tiers?.[String(tier)] ?? null;
}

export interface TroopStats {
  arm: string;
  tier: number;
  unlockAtTrainingBuilding: number;
  cost: Partial<Record<ResKey, number>>;
  trainTimeSec: number;
  attack: number;
  defense: number;
  power: number;
  load: number;
}

export const buildQueueSlots = (N as any).global.buildQueueSlots as number;
export const collectorCapHours = (N as any).global.offline.collectorCapHours as number;
export const resourceDisplayMultiplier = (N as any).global.display?.resourceMultiplier ?? 1;
export const troopDisplayMultiplier = (N as any).global.display?.troopMultiplier ?? 1;
export function displayResource(value: number): number { return value * resourceDisplayMultiplier; }
export function displayTroops(value: number): number { return value * troopDisplayMultiplier; }
export function troopStats(type: TroopKey, tier: number): TroopStats | null {
  const configured = troopTierRow(type, tier);
  if (!configured) return null;
  const troopCost: Partial<Record<ResKey, number>> = {};
  RES_ORDER.forEach((resource) => {
    const value = configured.cost?.[RESKEY_OF[resource]];
    if (value != null) troopCost[resource] = value;
  });
  return {
    arm: nt(type).arm,
    tier,
    unlockAtTrainingBuilding: configured.unlockAtTrainingBuilding,
    cost: troopCost,
    trainTimeSec: configured.trainTimeSec,
    attack: configured.attack,
    defense: configured.defense,
    power: configured.power,
    load: configured.load,
  };
}

export function unlockedTroopTiers(s: GameState, type: TroopKey): number[] {
  const buildingLevel = s.buildings[TRAINING_BUILDING[type]].lvl;
  return Object.keys(nt(type)?.tiers ?? {})
    .map(Number)
    .filter((tier) => (troopStats(type, tier)?.unlockAtTrainingBuilding ?? Number.POSITIVE_INFINITY) <= buildingLevel)
    .sort((a, b) => a - b);
}

export function highestUnlockedTroopTier(s: GameState, type: TroopKey): number {
  const tiers = unlockedTroopTiers(s, type);
  return tiers[tiers.length - 1] ?? 1;
}

export function isUpgradable(k: BKey): boolean { return BUILDINGS[k].upgradable; }
export function unlockAtKeep(k: BKey): number { return nb(k).unlockAtKeep; }
export function maxLevel(k: BKey): number { return nb(k).maxLevel ?? ((N as any).global.buildingMaxLevel as number); }
export function isUnlocked(s: GameState, k: BKey): boolean { return s.buildings.keep.lvl >= unlockAtKeep(k); }
export function capForLevel(s: GameState, k: BKey): number {
  // building level is capped by keep level (keep itself uncapped up to maxLevel)
  return k === "keep" ? maxLevel(k) : Math.min(maxLevel(k), s.buildings.keep.lvl);
}

export function upgradeCost(k: BKey, targetLvl: number): Partial<Record<ResKey, number>> {
  const c = buildingLevelRow(k, targetLvl)?.cost || {};
  const out: Partial<Record<ResKey, number>> = {};
  RES_ORDER.forEach((r) => { if (c[RESKEY_OF[r]] != null) out[r] = c[RESKEY_OF[r]]; });
  return out;
}
export function upgradeTimeSec(k: BKey, targetLvl: number): number {
  return buildingLevelRow(k, targetLvl)?.timeSec ?? 0;
}
export function effectiveUpgradeTimeSec(s: GameState, k: BKey, targetLvl: number): number {
  const bonus = Math.max(0, researchModifiers(s).constructionSpeedBonus ?? 0);
  return Math.max(1, Math.ceil(upgradeTimeSec(k, targetLvl) / (1 + bonus)));
}
export function capacity(s: GameState): number {
  const st = s.buildings.storage;
  const configured = buildingLevelRow("storage", Math.max(1, st.lvl))?.capacityPerResource;
  return configured ?? 5000; // L1-equivalent cap even before a Warehouse exists
}
export function prodPerHour(s: GameState): Record<ResKey, number> {
  const out: Record<ResKey, number> = { cash: 0, oil: 0, power: 0 };
  const modifiers = researchModifiers(s);
  (["bank", "oilwell", "powerplant"] as BKey[]).forEach((k) => {
    const b = s.buildings[k];
    if (b.lvl >= 1) {
      const r = BUILDINGS[k].produces!;
      const base = buildingLevelRow(k, b.lvl)?.productionPerHour ?? 0;
      out[r] += base * (1 + Math.max(0, modifiers[`${r}ProductionBonus`] ?? 0));
    }
  });
  return out;
}
export function maxTroops(s: GameState): number {
  return TROOP_ORDER.reduce((sum, type) => sum + maxTroopsForType(s, type), 0);
}
export function maxTroopsForType(s: GameState, type: TroopKey): number {
  const key = TRAINING_BUILDING[type];
  const b = s.buildings[key];
  if (b.lvl < 1) return 0;
  return buildingLevelRow(key, b.lvl)?.troopCapacity ?? 0;
}
export function totalTroops(s: GameState): number {
  return TROOP_ORDER.reduce((sum, type) =>
    sum + Object.values(s.troops[type] ?? {}).reduce((typeSum, qty) => typeSum + (qty || 0), 0), 0);
}
export function troopCountByType(s: GameState, type: TroopKey): number {
  return Object.values(s.troops[type] ?? {}).reduce((sum, qty) => sum + (qty || 0), 0);
}
export function trainQueueSize(s: GameState, type: TroopKey): number {
  const key = TRAINING_BUILDING[type];
  const b = s.buildings[key];
  const base = b.lvl < 1 ? 0 : buildingLevelRow(key, b.lvl)?.trainQueueSize ?? 0;
  return Math.max(0, Math.floor(base + (researchModifiers(s).trainingCapacityBonus ?? 0)));
}
export function trainSpeedMult(s: GameState, type: TroopKey): number {
  const key = TRAINING_BUILDING[type];
  const b = s.buildings[key];
  const base = buildingLevelRow(key, Math.max(1, b.lvl))?.trainSpeedMult ?? 1;
  return base * (1 + Math.max(0, researchModifiers(s).trainingSpeedBonus ?? 0));
}

export function hospitalCapacity(s: GameState): number {
  const level = s.buildings.hospital.lvl;
  const base = level < 1 ? 0 : buildingLevelRow("hospital", level)?.woundedCapacity ?? 0;
  return Math.max(0, Math.floor(base + (researchModifiers(s).hospitalCapacityBonus ?? 0)));
}

export function healingSpeedMult(s: GameState): number {
  return 1 + Math.max(0, researchModifiers(s).healingSpeedBonus ?? 0);
}

export function healingDurationSec(s: GameState, qty: number): number {
  const base = Math.max(0, Number(nb("hospital")?.healTimePerTroopSec) || 0);
  return Math.max(1, Math.ceil(base * Math.max(0, qty) / healingSpeedMult(s)));
}

export function healingBatchCost(qty: number): Partial<Record<ResKey, number>> {
  const configured = nb("hospital")?.healCostPerTroop ?? {};
  const result: Partial<Record<ResKey, number>> = {};
  RES_ORDER.forEach((resource) => {
    const amount = Math.max(0, Number(configured[RESKEY_OF[resource]]) || 0) * Math.max(0, qty);
    if (amount > 0) result[resource] = amount;
  });
  return result;
}

export function promotionUnlocked(s: GameState, type: TroopKey): boolean {
  const buildingKey = TRAINING_BUILDING[type];
  return s.buildings[buildingKey].lvl >= (nb(buildingKey)?.promotionUnlockLevel ?? 13);
}

export function promotionUnlockLevel(type: TroopKey): number {
  return nb(TRAINING_BUILDING[type])?.promotionUnlockLevel ?? 13;
}

// Kingshot-style promotion charges only the target-minus-source difference.
// Might continues to use our existing troop power values, so a completed
// promotion naturally adds only the target-minus-source Might delta.
export function promotionBatchCost(type: TroopKey, sourceTier: number, targetTier: number, qty: number): Partial<Record<ResKey, number>> {
  const source = troopStats(type, sourceTier);
  const target = troopStats(type, targetTier);
  const out: Partial<Record<ResKey, number>> = {};
  if (!source || !target || targetTier <= sourceTier) return out;
  RES_ORDER.forEach((resource) => {
    const difference = Math.max(0, (target.cost[resource] ?? 0) - (source.cost[resource] ?? 0));
    if (difference > 0) out[resource] = difference * Math.max(0, qty);
  });
  return out;
}

export function promotionTimePerTroop(s: GameState, type: TroopKey, sourceTier: number, targetTier: number): number {
  const source = troopStats(type, sourceTier);
  const target = troopStats(type, targetTier);
  if (!source || !target || targetTier <= sourceTier) return 0;
  return Math.max(1, target.trainTimeSec - source.trainTimeSec) / trainSpeedMult(s, type);
}

export function promotionQueueSize(s: GameState, type: TroopKey, sourceTier: number, targetTier: number): number {
  const source = troopStats(type, sourceTier);
  const target = troopStats(type, targetTier);
  if (!source || !target || targetTier <= sourceTier) return 0;
  const timeDifference = Math.max(1, target.trainTimeSec - source.trainTimeSec);
  return Math.max(0, Math.floor(trainQueueSize(s, type) * target.trainTimeSec / timeDifference));
}

export function accountResearchModifiers(s: GameState): Record<string, number> {
  return researchModifiers(s);
}

export function worldMarchSlots(s: GameState, numbers: any = N): number {
  const base = Math.max(1, Math.floor(Number(numbers.global?.march?.marchQueueSlots) || 1));
  return base + Math.max(0, Math.floor(researchModifiers(s).marchQueueBonus ?? 0));
}

export function accountMarchCapacity(s: GameState, numbers: any = N): number {
  const baseFraction = Math.max(0, Number(numbers.global?.march?.capacityFractionOfMaxTroops) || 0);
  const bonus = Math.max(0, researchModifiers(s).marchCapacityBonus ?? 0);
  return Math.max(0, Math.floor(maxTroops(s) * baseFraction * (1 + bonus)));
}

export function townhallRequirements(targetLevel: number): BKey[] {
  const configured = (N as any).townhallPrerequisites?.perLevel?.[String(targetLevel)] ?? [];
  return configured
    .map((key: string) => key.replace(/^building\./, "") as BKey)
    .filter((key: BKey) => key in BUILDINGS);
}

export function missingTownhallPrerequisites(s: GameState, targetLevel: number): { key: BKey; requiredLevel: number; currentLevel: number }[] {
  const requiredLevel = Math.max(1, targetLevel - 1);
  return townhallRequirements(targetLevel)
    .filter((key) => s.buildings[key].lvl < requiredLevel)
    .map((key) => ({ key, requiredLevel, currentLevel: s.buildings[key].lvl }));
}
export interface MightBreakdown { infrastructure: number; research: number; troops: number; total: number }
export function mightBreakdown(s: GameState): MightBreakdown {
  let infrastructure = 0;
  BUILDING_ORDER.forEach((k) => {
    if (s.buildings[k].lvl > 0) infrastructure += buildingLevelRow(k, s.buildings[k].lvl)?.might ?? 0;
  });
  let troops = 0;
  TROOP_ORDER.forEach((type) => {
    for (const [tierText, qty] of Object.entries(s.troops[type] ?? {})) {
      troops += displayTroops(qty) * (troopStats(type, Number(tierText))?.power ?? 0);
    }
  });
  infrastructure = Math.round(infrastructure);
  const research = researchMight(s);
  troops = Math.round(troops);
  return { infrastructure, research, troops, total: infrastructure + research + troops };
}
export function might(s: GameState): number {
  return mightBreakdown(s).total;
}
export function activeUpgrades(s: GameState): number {
  return BUILDING_ORDER.filter((k) => s.buildings[k].finishAt > 0).length;
}
export function canAfford(s: GameState, cost: Partial<Record<ResKey, number>>): boolean {
  return RES_ORDER.every((r) => (cost[r] ?? 0) <= s.res[r]);
}

// THE tick: advance state to `now` (production, completed upgrades, finished training). Pure.
export function project(s: GameState, now: number): GameState {
  const ns: GameState = JSON.parse(JSON.stringify(s));
  // production since lastTick (capped by storage). collectorCap limits offline overflow.
  const elapsedH = Math.max(0, Math.min((now - ns.lastTick) / 3_600_000, collectorCapHours));
  const rate = prodPerHour(ns);
  const cap = capacity(ns);
  RES_ORDER.forEach((r) => {
    ns.res[r] = Math.min(cap, Math.floor(ns.res[r] + rate[r] * elapsedH));
  });
  // completed building upgrades
  BUILDING_ORDER.forEach((k) => {
    const b = ns.buildings[k];
    if (b.finishAt > 0 && now >= b.finishAt) { b.lvl += 1; b.finishAt = 0; b.durationSec = 0; }
  });
  finishResearchQueue(ns, now);
  if (ns.healing.finishAt > 0 && now >= ns.healing.finishAt) {
    TROOP_ORDER.forEach((type) => {
      for (let tier = 1; tier <= 10; tier += 1) {
        const key = String(tier);
        const restored = Math.max(0, ns.healing.troops[type]?.[key] ?? 0);
        ns.woundedTroops[type][key] = Math.max(0, (ns.woundedTroops[type][key] ?? 0) - restored);
        ns.troops[type][key] = (ns.troops[type][key] ?? 0) + restored;
      }
    });
    ns.wounded = troopRosterCount(ns.woundedTroops);
    ns.healing = emptyHealingQueue();
  }
  // Each specialized training building owns an independent queue.
  TROOP_ORDER.forEach((type) => {
    const queue = ns.training[type];
    if (queue.finishAt > 0 && now >= queue.finishAt) {
      const tier = String(queue.tier || 1);
      ns.troops[type][tier] = (ns.troops[type][tier] || 0) + queue.qty;
      ns.training[type] = emptyTrainingQueue(queue.tier || 1);
    }
  });
  ns.lastTick = now;
  return ns;
}

export function startUpgrade(s: GameState, k: BKey): { state: GameState; ok: boolean; reason?: string } {
  const now = Date.now();
  const ns = project(s, now);
  if (!isUpgradable(k)) return { state: ns, ok: false, reason: "Not upgradable" };
  const cur = ns.buildings[k].lvl;
  const target = cur + 1;
  if (!isUnlocked(ns, k)) return { state: ns, ok: false, reason: `Unlocks at Townhall Lv.${unlockAtKeep(k)}` };
  if (ns.buildings[k].finishAt > 0) return { state: ns, ok: false, reason: "Already upgrading" };
  const operationBlock = buildingOperationBlockReason(ns, k);
  if (operationBlock) return { state: ns, ok: false, reason: operationBlock };
  if (target > capForLevel(ns, k)) return { state: ns, ok: false, reason: k === "keep" ? "Max level" : "Raise Townhall first" };
  if (k === "keep") {
    const missing = missingTownhallPrerequisites(ns, target);
    if (missing.length > 0) {
      const first = missing[0];
      return { state: ns, ok: false, reason: `${BUILDINGS[first.key].label} Lv.${first.requiredLevel} required` };
    }
  }
  if (activeUpgrades(ns) >= buildQueueSlots) return { state: ns, ok: false, reason: `Both build slots busy (${buildQueueSlots})` };
  const cost = upgradeCost(k, target);
  if (!canAfford(ns, cost)) return { state: ns, ok: false, reason: "Not enough resources" };
  RES_ORDER.forEach((r) => { ns.res[r] -= cost[r] ?? 0; });
  const durationSec = effectiveUpgradeTimeSec(ns, k, target);
  ns.buildings[k].durationSec = durationSec;
  ns.buildings[k].finishAt = now + durationSec * 1000;
  return { state: ns, ok: true };
}

export function startResearch(s: GameState, techKey: string): { state: GameState; ok: boolean; reason?: string } {
  const now = Date.now();
  const ns = project(s, now);
  return beginResearch(ns, techKey, now);
}

export function startHealing(s: GameState, requestedQty: number): { state: GameState; ok: boolean; reason?: string } {
  const now = Date.now();
  const ns = project(s, now);
  if (ns.buildings.hospital.lvl < 1) return { state: ns, ok: false, reason: "Build Hospital" };
  if (ns.buildings.hospital.finishAt > 0) return { state: ns, ok: false, reason: "Hospital is upgrading" };
  if (ns.healing.finishAt > 0) return { state: ns, ok: false, reason: "Hospital is already healing" };
  ns.wounded = troopRosterCount(ns.woundedTroops);
  const qty = Math.max(0, Math.min(Math.floor(requestedQty), ns.wounded));
  if (qty <= 0) return { state: ns, ok: false, reason: "No wounded troops to heal" };
  const cost = healingBatchCost(qty);
  if (!canAfford(ns, cost)) return { state: ns, ok: false, reason: "Not enough resources" };
  RES_ORDER.forEach((resource) => { ns.res[resource] -= cost[resource] ?? 0; });
  const durationSec = healingDurationSec(ns, qty);
  ns.healing = { troops: selectWounded(ns.woundedTroops, qty), qty, durationSec, finishAt: now + durationSec * 1000 };
  return { state: ns, ok: true };
}

export function troopBatchCost(type: TroopKey, tier: number, qty: number): Partial<Record<ResKey, number>> {
  const stats = troopStats(type, tier);
  const out: Partial<Record<ResKey, number>> = {};
  RES_ORDER.forEach((r) => { const c = stats?.cost[r]; if (c) out[r] = c * qty; });
  return out;
}
export function startTrain(s: GameState, type: TroopKey, tier: number, qty: number): { state: GameState; ok: boolean; reason?: string } {
  const now = Date.now();
  const ns = project(s, now);
  const buildingKey = TRAINING_BUILDING[type];
  const building = ns.buildings[buildingKey];
  if (building.lvl < 1) return { state: ns, ok: false, reason: `Build ${BUILDINGS[buildingKey].label}` };
  if (building.finishAt > 0) return { state: ns, ok: false, reason: `${BUILDINGS[buildingKey].label} is upgrading` };
  if (ns.training[type].finishAt > 0) return { state: ns, ok: false, reason: `${BUILDINGS[buildingKey].label} is already training` };
  const stats = troopStats(type, tier);
  if (!stats) return { state: ns, ok: false, reason: "Unknown troop tier" };
  if (stats.unlockAtTrainingBuilding > building.lvl) return { state: ns, ok: false, reason: `T${tier} requires ${BUILDINGS[buildingKey].label} Lv.${stats.unlockAtTrainingBuilding}` };
  const room = maxTroopsForType(ns, type) - troopCountByType(ns, type);
  qty = Math.max(0, Math.min(qty, room, trainQueueSize(ns, type)));
  if (qty <= 0) return { state: ns, ok: false, reason: `${TROOPS_META[type].label} capacity full` };
  const cost = troopBatchCost(type, tier, qty);
  if (!canAfford(ns, cost)) return { state: ns, ok: false, reason: "Not enough resources" };
  RES_ORDER.forEach((r) => { ns.res[r] -= cost[r] ?? 0; });
  const per = stats.trainTimeSec / trainSpeedMult(ns, type);
  ns.training[type] = { mode: "train", sourceTier: 0, tier, qty, per, finishAt: now + per * qty * 1000 };
  return { state: ns, ok: true };
}

export function startPromote(s: GameState, type: TroopKey, sourceTier: number, targetTier: number, qty: number): { state: GameState; ok: boolean; reason?: string } {
  const now = Date.now();
  const ns = project(s, now);
  const buildingKey = TRAINING_BUILDING[type];
  const building = ns.buildings[buildingKey];
  if (building.lvl < 1) return { state: ns, ok: false, reason: `Build ${BUILDINGS[buildingKey].label}` };
  if (building.finishAt > 0) return { state: ns, ok: false, reason: `${BUILDINGS[buildingKey].label} is upgrading` };
  if (ns.training[type].finishAt > 0) return { state: ns, ok: false, reason: `${BUILDINGS[buildingKey].label} queue is busy` };
  if (!promotionUnlocked(ns, type)) return { state: ns, ok: false, reason: `Promotion unlocks at ${BUILDINGS[buildingKey].label} Lv.${promotionUnlockLevel(type)}` };
  const source = troopStats(type, sourceTier);
  const target = troopStats(type, targetTier);
  if (!source || !target || targetTier <= sourceTier) return { state: ns, ok: false, reason: "Choose a higher target tier" };
  if (target.unlockAtTrainingBuilding > building.lvl) return { state: ns, ok: false, reason: `T${targetTier} requires ${BUILDINGS[buildingKey].label} Lv.${target.unlockAtTrainingBuilding}` };
  const available = ns.troops[type][String(sourceTier)] ?? 0;
  qty = Math.max(0, Math.min(qty, available, promotionQueueSize(ns, type, sourceTier, targetTier)));
  if (qty <= 0) return { state: ns, ok: false, reason: `No T${sourceTier} troops available to promote` };
  const cost = promotionBatchCost(type, sourceTier, targetTier, qty);
  if (!canAfford(ns, cost)) return { state: ns, ok: false, reason: "Not enough resources" };
  RES_ORDER.forEach((resource) => { ns.res[resource] -= cost[resource] ?? 0; });
  // Source units are reserved by the queue and cannot be deployed/promoted twice.
  ns.troops[type][String(sourceTier)] = available - qty;
  const per = promotionTimePerTroop(ns, type, sourceTier, targetTier);
  ns.training[type] = { mode: "promote", sourceTier, tier: targetTier, qty, per, finishAt: now + per * qty * 1000 };
  return { state: ns, ok: true };
}
