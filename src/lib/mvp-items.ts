export type ItemCategory = "speedup" | "resource" | "energy" | "war" | "identity" | "relic";
export type SpeedupQueue = "universal" | "construction" | "research" | "training" | "healing";

export type MvpItem = {
  id: string;
  name: string;
  category: ItemCategory;
  rarity: "common" | "rare" | "epic";
  status: "active" | "planned";
  description: string;
  speedupSeconds?: number;
  speedupQueue?: SpeedupQueue;
};

const speedup = (id: string, name: string, seconds: number, queue: SpeedupQueue, rarity: MvpItem["rarity"] = "common"): MvpItem => ({
  id, name, category: "speedup", rarity, status: "active", speedupSeconds: seconds, speedupQueue: queue,
  description: `Reduces ${queue === "universal" ? "any active" : `an active ${queue}`} timer by ${seconds >= 3600 ? `${seconds / 3600} hour${seconds === 3600 ? "" : "s"}` : `${seconds / 60} minutes`}.`,
});

/** One shared catalog is imported by both the Worker and the game client. */
export const MVP_ITEMS: readonly MvpItem[] = [
  speedup("speedup.universal.5m", "5m Speedup", 300, "universal"),
  speedup("speedup.universal.1h", "1h Speedup", 3600, "universal", "rare"),
  speedup("speedup.universal.3h", "3h Speedup", 10_800, "universal", "epic"),
  speedup("speedup.construction.5m", "5m Construction Speedup", 300, "construction"),
  speedup("speedup.construction.1h", "1h Construction Speedup", 3600, "construction", "rare"),
  speedup("speedup.research.5m", "5m Research Speedup", 300, "research"),
  speedup("speedup.research.1h", "1h Research Speedup", 3600, "research", "rare"),
  speedup("speedup.training.5m", "5m Training Speedup", 300, "training"),
  speedup("speedup.training.1h", "1h Training Speedup", 3600, "training", "rare"),
  speedup("speedup.healing.5m", "5m Healing Speedup", 300, "healing"),
  speedup("speedup.healing.1h", "1h Healing Speedup", 3600, "healing", "rare"),

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
  "speedup.universal.5m": 10,
  "speedup.universal.1h": 2,
  "speedup.construction.5m": 5,
  "speedup.research.5m": 5,
  "speedup.training.5m": 5,
  "speedup.healing.5m": 5,
};
