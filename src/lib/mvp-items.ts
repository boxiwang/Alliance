export type ItemCategory = "speedup" | "resource" | "energy" | "war" | "boost" | "identity" | "chest" | "relic";
export type SpeedupQueue = "universal" | "construction" | "research" | "training" | "healing";

/** What using an item does (server-applied; docs/ITEMS.md). */
export type ItemEffect =
  | { kind: "resource"; resource: "cash" | "oil" | "power"; amount: number }
  | { kind: "stamina"; amount: number }
  | { kind: "shield"; hours: number }
  | { kind: "march_boost"; bonus: number; minutes: number }
  | { kind: "warp"; mode: "random" | "precision" }
  | { kind: "rename" }
  | { kind: "chest"; table: string };

export type MvpItem = {
  id: string;
  name: string;
  category: ItemCategory;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic";
  status: "active" | "planned";
  description: string;
  speedupSeconds?: number;
  speedupQueue?: SpeedupQueue;
  effect?: ItemEffect;
};

export const SPEEDUP_DURATIONS = [
  { id: "1m", label: "1m", seconds: 60, rarity: "common" },
  { id: "5m", label: "5m", seconds: 300, rarity: "uncommon" },
  { id: "1h", label: "1h", seconds: 3_600, rarity: "rare" },
  { id: "3h", label: "3h", seconds: 10_800, rarity: "epic" },
  { id: "8h", label: "8h", seconds: 28_800, rarity: "legendary" },
  { id: "24h", label: "24h", seconds: 86_400, rarity: "mythic" },
] as const satisfies readonly { id: string; label: string; seconds: number; rarity: MvpItem["rarity"] }[];

export const SPEEDUP_QUEUES: readonly SpeedupQueue[] = ["universal", "construction", "training", "research", "healing"];

const SPEEDUP_QUEUE_LABEL: Record<SpeedupQueue, string> = {
  universal: "",
  construction: "Construction ",
  training: "Training ",
  research: "Research ",
  healing: "Healing ",
};

const speedup = (id: string, name: string, seconds: number, queue: SpeedupQueue, rarity: MvpItem["rarity"] = "common"): MvpItem => ({
  id, name, category: "speedup", rarity, status: "active", speedupSeconds: seconds, speedupQueue: queue,
  description: `Reduces ${queue === "universal" ? "any active" : `an active ${queue}`} timer by ${seconds >= 3600 ? `${seconds / 3600} hour${seconds === 3600 ? "" : "s"}` : `${seconds / 60} minutes`}.`,
});

const RESOURCE_NAME = { cash: "Cash", oil: "Oil", power: "Power" } as const;
const RESOURCE_CRATES = [
  { size: "small", label: "1M", amount: 1_000, rarity: "common" },
  { size: "medium", label: "10M", amount: 10_000, rarity: "uncommon" },
  { size: "large", label: "100M", amount: 100_000, rarity: "rare" },
] as const satisfies readonly { size: string; label: string; amount: number; rarity: MvpItem["rarity"] }[];

/** One shared catalog is imported by both the Worker and the game client. */
export const MVP_ITEMS: readonly MvpItem[] = [
  ...SPEEDUP_QUEUES.flatMap((queue) => SPEEDUP_DURATIONS.map((duration) => speedup(
    `speedup.${queue}.${duration.id}`,
    `${duration.label} ${SPEEDUP_QUEUE_LABEL[queue]}Speedup`,
    duration.seconds,
    queue,
    duration.rarity,
  ))),

  // Resource crates (internal units; the game shows x1000: 1K -> 1M).
  ...(["cash", "oil", "power"] as const).flatMap((resource) => RESOURCE_CRATES.map((crate) => ({
    id: `resource.${resource}.${crate.size}`,
    name: `${crate.label} ${RESOURCE_NAME[resource]} Crate`,
    category: "resource" as const, rarity: crate.rarity, status: "active" as const,
    description: `Adds ${crate.label} ${RESOURCE_NAME[resource]} to your city.`,
    effect: { kind: "resource" as const, resource, amount: crate.amount },
  }))),
  { id: "energy.cell.10", name: "Stamina Cell", category: "energy", rarity: "common", status: "active", description: "Restores 10 Stamina (can go above the cap).", effect: { kind: "stamina", amount: 10 } },
  { id: "energy.cell.50", name: "Stamina Pack", category: "energy", rarity: "rare", status: "active", description: "Restores 50 Stamina (can go above the cap).", effect: { kind: "stamina", amount: 50 } },
  { id: "war.shield.8h", name: "Peace Shield 8h", category: "war", rarity: "rare", status: "active", description: "Your city can't be attacked for 8 hours (extends a running shield).", effect: { kind: "shield", hours: 8 } },
  { id: "war.shield.24h", name: "Peace Shield 24h", category: "war", rarity: "epic", status: "active", description: "Your city can't be attacked for 24 hours (extends a running shield).", effect: { kind: "shield", hours: 24 } },
  { id: "boost.march.1h", name: "March Boost 1h", category: "boost", rarity: "uncommon", status: "active", description: "Fleets you send travel 25% faster for 1 hour.", effect: { kind: "march_boost", bonus: .25, minutes: 60 } },
  { id: "boost.march.8h", name: "March Boost 8h", category: "boost", rarity: "epic", status: "active", description: "Fleets you send travel 25% faster for 8 hours.", effect: { kind: "march_boost", bonus: .25, minutes: 480 } },
  { id: "war.relocator.random", name: "Drift Jump", category: "war", rarity: "common", status: "active", description: "Relocates your city to a random valid sector.", effect: { kind: "warp", mode: "random" } },
  { id: "war.relocator.advanced", name: "Precision Jump", category: "war", rarity: "epic", status: "active", description: "Relocates your city to a chosen valid coordinate.", effect: { kind: "warp", mode: "precision" } },
  { id: "identity.rename", name: "Rename Signal", category: "identity", rarity: "rare", status: "active", description: "Change your commander name now, without waiting for the free rename window.", effect: { kind: "rename" } },
  { id: "chest.supply", name: "Supply Chest", category: "chest", rarity: "uncommon", status: "active", description: "Opens into 3 rewards: speedups, resource crates, Stamina — sometimes a Peace Shield.", effect: { kind: "chest", table: "supply" } },
  // Not in the MVP: nothing to open yet.
  { id: "relic.key.standard", name: "Relic Key", category: "relic", rarity: "rare", status: "planned", description: "Opens one standard Relic cache." },
] as const;

/** Chest loot (weighted, rolled on the server for each chest opened). */
export const CHEST_TABLES: Record<string, { rolls: number; entries: { itemId: string; quantity: number; weight: number }[] }> = {
  supply: {
    rolls: 3,
    entries: [
      { itemId: "speedup.universal.5m", quantity: 3, weight: 26 },
      { itemId: "speedup.universal.1h", quantity: 1, weight: 10 },
      { itemId: "speedup.construction.1h", quantity: 1, weight: 8 },
      { itemId: "speedup.training.1h", quantity: 1, weight: 8 },
      { itemId: "resource.cash.small", quantity: 2, weight: 14 },
      { itemId: "resource.oil.small", quantity: 2, weight: 12 },
      { itemId: "resource.power.small", quantity: 2, weight: 12 },
      { itemId: "energy.cell.10", quantity: 1, weight: 7 },
      { itemId: "boost.march.1h", quantity: 1, weight: 2 },
      { itemId: "war.shield.8h", quantity: 1, weight: 1 },
    ],
  },
};

/** Roll a chest table `count` times; `random` returns [0, 1). */
export function rollChest(table: string, count: number, random: () => number = Math.random): Record<string, number> {
  const loot = CHEST_TABLES[table];
  const out: Record<string, number> = {};
  if (!loot) return out;
  const total = loot.entries.reduce((sum, entry) => sum + entry.weight, 0);
  for (let chest = 0; chest < count; chest += 1) {
    for (let roll = 0; roll < loot.rolls; roll += 1) {
      let pick = random() * total;
      const entry = loot.entries.find((candidate) => (pick -= candidate.weight) < 0) ?? loot.entries[loot.entries.length - 1];
      out[entry.itemId] = (out[entry.itemId] || 0) + entry.quantity;
    }
  }
  return out;
}

export const MVP_ITEM_BY_ID = new Map(MVP_ITEMS.map((item) => [item.id, item]));

/** GM accounts hold every active item without limit; the server reports this count and never debits them. */
export const UNLIMITED_ITEM_QUANTITY = 999_999;
export const isUnlimitedQuantity = (quantity: number) => quantity >= UNLIMITED_ITEM_QUANTITY;

export const ALPHA_STARTER_ITEMS: Readonly<Record<string, number>> = {
  "war.relocator.advanced": 1,
  "war.relocator.random": 2,
  "speedup.universal.1m": 20,
  "speedup.universal.5m": 10,
  "speedup.universal.1h": 2,
  "speedup.construction.1m": 10,
  "speedup.construction.5m": 5,
  "speedup.construction.1h": 1,
  "speedup.research.1m": 10,
  "speedup.research.5m": 5,
  "speedup.research.1h": 1,
  "speedup.training.1m": 10,
  "speedup.training.5m": 5,
  "speedup.training.1h": 1,
  "speedup.healing.1m": 10,
  "speedup.healing.5m": 5,
  "speedup.healing.1h": 1,
};

export function speedupIconPath(item: Pick<MvpItem, "id" | "speedupQueue">): string {
  const parts = item.id.split(".");
  const duration = parts[parts.length - 1] || "1m";
  return `/assets/items/speedups-v2/${item.speedupQueue || "universal"}-${duration}.svg`;
}

// ---- Warehouse (backpack) categories ----
export type WarehouseCategory = "resources" | "speedups" | "gear" | "boosts" | "other";
export const WAREHOUSE_CATEGORIES: readonly { id: WarehouseCategory; label: string; glyph: string; empty: string }[] = [
  { id: "resources", label: "Resources", glyph: "▣", empty: "Resource crates and Stamina cells land here — from daily rewards, events and the Shop." },
  { id: "speedups", label: "Speedups", glyph: "»", empty: "Speedups come from the Shop, daily rewards and events." },
  { id: "gear", label: "Gear", glyph: "◈", empty: "Hero gear arrives with Heroes." },
  { id: "boosts", label: "Boosts", glyph: "⬡", empty: "Shields, march boosts and battle buffs show up here." },
  { id: "other", label: "Other", glyph: "✦", empty: "Warp jumps, chests, keys and rename signals show up here." },
];

export function warehouseCategoryOf(item: Pick<MvpItem, "id" | "category">): WarehouseCategory {
  if (item.category === "speedup") return "speedups";
  if (item.category === "resource" || item.category === "energy") return "resources";
  if (item.category === "boost" || item.id.startsWith("war.shield")) return "boosts";
  return "other";
}

/** Backpack order: speedups by queue then duration; everything else by catalog order. */
export function warehouseSortKey(item: Pick<MvpItem, "id" | "speedupQueue" | "speedupSeconds">): number {
  if (item.speedupQueue) return SPEEDUP_QUEUES.indexOf(item.speedupQueue) * 1e6 + (item.speedupSeconds || 0);
  return 1e8 + MVP_ITEMS.findIndex((entry) => entry.id === item.id);
}
