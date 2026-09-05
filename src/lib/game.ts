// Solo-mode game logic — PURE functions, keyed by bible Keys, driven by docs/numbers.json.
// Render / persistence / identity are swappable around this. Times in seconds, prod per hour.
import { getN } from "./numbers";
const N: any = getN(); // effective numbers (admin override or defaults), read at load

export type ResKey = "cash" | "oil" | "power";
export type TroopKey = "army" | "navy" | "air";
export type BKey =
  | "keep" | "bank" | "oilwell" | "powerplant" | "storage" | "barracks"
  | "hospital" | "embassy" | "wall" | "academy" | "watchtower" | "milestone";

export interface BuildingState {
  lvl: number; // 0 = not built yet
  finishAt: number; // epoch ms of in-progress upgrade, 0 = idle
}
export interface TrainState {
  type: TroopKey;
  qty: number;
  per: number; // seconds per troop
  finishAt: number;
}
export interface GameState {
  address: string;
  buildings: Record<BKey, BuildingState>;
  res: Record<ResKey, number>;
  troops: Record<TroopKey, number>;
  wounded: number;
  train: TrainState;
  lastTick: number;
}

// Display meta (labels are neutral placeholders — themed names come from the bible later).
export const BUILDINGS: Record<BKey, { label: string; emoji: string; produces?: ResKey; trains?: boolean; blurb: string; upgradable: boolean }> = {
  keep:       { label: "Townhall",            emoji: "🏰", blurb: "Gates everything, unlocks buildings. Shield lifts at L10.", upgradable: true },
  bank:       { label: "Bank",                emoji: "🏦", produces: "cash",  blurb: "Produces Cash over time.", upgradable: true },
  oilwell:    { label: "Oil Well",            emoji: "🛢️", produces: "oil",   blurb: "Produces Oil over time.", upgradable: true },
  powerplant: { label: "Power Plant",         emoji: "⚡", produces: "power", blurb: "Produces Power over time.", upgradable: true },
  storage:    { label: "Warehouse",           emoji: "📦", blurb: "Raises resource capacity + raid protection.", upgradable: true },
  barracks:   { label: "Barracks",            emoji: "⚔️", trains: true, blurb: "Trains all troop types; sets max troop capacity.", upgradable: true },
  hospital:   { label: "Hospital",            emoji: "⛑️", blurb: "Heals wounded troops.", upgradable: true },
  embassy:    { label: "Embassy",             emoji: "🏛️", blurb: "Receives allied reinforcement troops (capacity). Coming soon.", upgradable: true },
  wall:       { label: "Wall",                emoji: "🧱", blurb: "Adds defense against raids.", upgradable: true },
  academy:    { label: "Research Institute",  emoji: "🔬", blurb: "Research: Troops / Economy / Development. Coming soon.", upgradable: true },
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
  "keep", "bank", "oilwell", "powerplant", "storage", "barracks",
  "hospital", "embassy", "wall", "academy", "watchtower", "milestone",
];
export const TROOP_ORDER: TroopKey[] = ["army", "navy", "air"];
export const RES_ORDER: ResKey[] = ["cash", "oil", "power"];

const nb = (k: BKey): any => (N as any).buildings["building." + k];
const nt = (t: TroopKey): any => (N as any).troops["troop." + t];
const val = (cfg: { base: number; growth: number }, L: number) => Math.round(cfg.base * Math.pow(cfg.growth, L - 1));
const RESKEY_OF: Record<ResKey, string> = { cash: "res.cash", oil: "res.oil", power: "res.power" };

export const buildQueueSlots = (N as any).global.buildQueueSlots as number;
export const collectorCapHours = (N as any).global.offline.collectorCapHours as number;
export const TROOPS: Record<TroopKey, { arm: string; unlockAtKeep: number; cost: Partial<Record<ResKey, number>>; trainTimeSec: number; attack: number; defense: number; power: number; load: number }> =
  TROOP_ORDER.reduce((acc, t) => {
    const d = nt(t);
    const cost: Partial<Record<ResKey, number>> = {};
    RES_ORDER.forEach((r) => { if (d.cost[RESKEY_OF[r]] != null) cost[r] = d.cost[RESKEY_OF[r]]; });
    acc[t] = { arm: d.arm, unlockAtKeep: d.unlockAtKeep, cost, trainTimeSec: d.trainTimeSec, attack: d.attack, defense: d.defense, power: d.power, load: d.load };
    return acc;
  }, {} as Record<TroopKey, any>);

export function isUpgradable(k: BKey): boolean { return BUILDINGS[k].upgradable; }
export function unlockAtKeep(k: BKey): number { return nb(k).unlockAtKeep; }
export function maxLevel(k: BKey): number { return nb(k).maxLevel ?? ((N as any).global.buildingMaxLevel as number); }
export function isUnlocked(s: GameState, k: BKey): boolean { return s.buildings.keep.lvl >= unlockAtKeep(k); }
export function capForLevel(s: GameState, k: BKey): number {
  // building level is capped by keep level (keep itself uncapped up to maxLevel)
  return k === "keep" ? maxLevel(k) : Math.min(maxLevel(k), s.buildings.keep.lvl);
}

export function upgradeCost(k: BKey, targetLvl: number): Partial<Record<ResKey, number>> {
  const c = nb(k).cost || {};
  const out: Partial<Record<ResKey, number>> = {};
  RES_ORDER.forEach((r) => { if (c[RESKEY_OF[r]]) out[r] = val(c[RESKEY_OF[r]], targetLvl); });
  return out;
}
export function upgradeTimeSec(k: BKey, targetLvl: number): number {
  const t = nb(k).time;
  return t ? val(t, targetLvl) : 0;
}
export function capacity(s: GameState): number {
  const st = s.buildings.storage;
  const cap = nb("storage").capacityPerResource;
  return st.lvl >= 1 ? val(cap, st.lvl) : cap.base; // base cap even before a Warehouse exists
}
export function prodPerHour(s: GameState): Record<ResKey, number> {
  const out: Record<ResKey, number> = { cash: 0, oil: 0, power: 0 };
  (["bank", "oilwell", "powerplant"] as BKey[]).forEach((k) => {
    const b = s.buildings[k];
    if (b.lvl >= 1) {
      const r = BUILDINGS[k].produces!;
      out[r] += val(nb(k).productionPerHour, b.lvl);
    }
  });
  return out;
}
export function maxTroops(s: GameState): number {
  const b = s.buildings.barracks;
  if (b.lvl < 1) return 0;
  return val(nb("barracks").troopCapacity, b.lvl);
}
export function totalTroops(s: GameState): number {
  return TROOP_ORDER.reduce((sum, t) => sum + (s.troops[t] || 0), 0);
}
export function trainSpeedMult(s: GameState): number {
  const b = s.buildings.barracks;
  const t = nb("barracks").trainSpeedMult;
  return b.lvl >= 1 ? t.base + t.perLevel * (b.lvl - 1) : t.base;
}
export function might(s: GameState): number {
  const pw = (N as any).global.might.buildingPowerPerLevel;
  let m = 0;
  BUILDING_ORDER.forEach((k) => { m += (pw["building." + k] || 0) * s.buildings[k].lvl; });
  TROOP_ORDER.forEach((t) => { m += (s.troops[t] || 0) * (TROOPS[t].power || 0); });
  return Math.round(m);
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
    if (b.finishAt > 0 && now >= b.finishAt) { b.lvl += 1; b.finishAt = 0; }
  });
  // finished training
  if (ns.train.finishAt > 0 && now >= ns.train.finishAt) {
    ns.troops[ns.train.type] = (ns.troops[ns.train.type] || 0) + ns.train.qty;
    ns.train = { type: ns.train.type, qty: 0, per: 0, finishAt: 0 };
  }
  ns.lastTick = now;
  return ns;
}

export function startUpgrade(s: GameState, k: BKey): { state: GameState; ok: boolean; reason?: string } {
  const ns = project(s, Date.now());
  if (!isUpgradable(k)) return { state: ns, ok: false, reason: "Not upgradable" };
  const cur = ns.buildings[k].lvl;
  const target = cur + 1;
  if (!isUnlocked(ns, k)) return { state: ns, ok: false, reason: `Unlocks at Townhall Lv.${unlockAtKeep(k)}` };
  if (ns.buildings[k].finishAt > 0) return { state: ns, ok: false, reason: "Already upgrading" };
  if (target > capForLevel(ns, k)) return { state: ns, ok: false, reason: k === "keep" ? "Max level" : "Raise Townhall first" };
  if (activeUpgrades(ns) >= buildQueueSlots) return { state: ns, ok: false, reason: `Both build slots busy (${buildQueueSlots})` };
  const cost = upgradeCost(k, target);
  if (!canAfford(ns, cost)) return { state: ns, ok: false, reason: "Not enough resources" };
  RES_ORDER.forEach((r) => { ns.res[r] -= cost[r] ?? 0; });
  ns.buildings[k].finishAt = Date.now() + upgradeTimeSec(k, target) * 1000;
  return { state: ns, ok: true };
}

export function troopBatchCost(type: TroopKey, qty: number): Partial<Record<ResKey, number>> {
  const out: Partial<Record<ResKey, number>> = {};
  RES_ORDER.forEach((r) => { const c = TROOPS[type].cost[r]; if (c) out[r] = c * qty; });
  return out;
}
export function startTrain(s: GameState, type: TroopKey, qty: number): { state: GameState; ok: boolean; reason?: string } {
  const ns = project(s, Date.now());
  if (ns.buildings.barracks.lvl < 1) return { state: ns, ok: false, reason: "Build a Barracks" };
  if (ns.train.finishAt > 0) return { state: ns, ok: false, reason: "Already training" };
  const room = maxTroops(ns) - totalTroops(ns);
  qty = Math.max(0, Math.min(qty, room));
  if (qty <= 0) return { state: ns, ok: false, reason: "Troop capacity full" };
  const cost = troopBatchCost(type, qty);
  if (!canAfford(ns, cost)) return { state: ns, ok: false, reason: "Not enough resources" };
  RES_ORDER.forEach((r) => { ns.res[r] -= cost[r] ?? 0; });
  const per = TROOPS[type].trainTimeSec / trainSpeedMult(ns);
  ns.train = { type, qty, per, finishAt: Date.now() + per * qty * 1000 };
  return { state: ns, ok: true };
}
