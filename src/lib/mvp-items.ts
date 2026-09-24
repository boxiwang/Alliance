export type ItemCategory = "speedup" | "resource" | "energy" | "war" | "identity" | "relic";
export type SpeedupQueue = "universal" | "construction" | "research" | "training" | "healing";

export type MvpItem = {
  id: string;
  name: string;
  category: ItemCategory;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary" | "mythic";
  status: "active" | "planned";
  description: string;
  speedupSeconds?: number;
  speedupQueue?: SpeedupQueue;
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

/** One shared catalog is imported by both the Worker and the game client. */
export const MVP_ITEMS: readonly MvpItem[] = [
  ...SPEEDUP_QUEUES.flatMap((queue) => SPEEDUP_DURATIONS.map((duration) => speedup(
    `speedup.${queue}.${duration.id}`,
    `${duration.label} ${SPEEDUP_QUEUE_LABEL[queue]}Speedup`,
    duration.seconds,
    queue,
    duration.rarity,
  ))),

  { id: "resource.cash.small", name: "Cash Reserve", category: "resource", rarity: "common", status: "planned", description: "Adds a protected bundle of Cash." },
  { id: "resource.oil.small", name: "Oil Reserve", category: "resource", rarity: "common", status: "planned", description: "Adds a protected bundle of Oil." },
  { id: "resource.power.small", name: "Power Reserve", category: "resource", rarity: "common", status: "planned", description: "Adds a protected bundle of Power." },
  { id: "energy.cell.10", name: "Energy Cell", category: "energy", rarity: "common", status: "planned", description: "Restores 10 Star Map energy." },
  { id: "war.shield.8h", name: "Peace Shield 8h", category: "war", rarity: "rare", status: "planned", description: "Stops hostile attacks against your city for 8 hours." },
  { id: "war.relocator.random", name: "Drift Jump", category: "war", rarity: "common", status: "planned", description: "Relocates your city to a random valid sector." },
  { id: "war.relocator.advanced", name: "Precision Jump", category: "war", rarity: "epic", status: "planned", description: "Relocates your city to a chosen valid coordinate." },
  { id: "identity.rename", name: "Rename Signal", category: "identity", rarity: "rare", status: "planned", description: "Changes your unique commander name without waiting for the free rename window." },
  { id: "relic.key.standard", name: "Relic Key", category: "relic", rarity: "rare", status: "planned", description: "Opens one standard Relic cache." },
] as const;

export const MVP_ITEM_BY_ID = new Map(MVP_ITEMS.map((item) => [item.id, item]));

export const ALPHA_STARTER_ITEMS: Readonly<Record<string, number>> = {
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
