// Central numbers accessor. The game reads getN() instead of importing the JSON directly,
// so an admin-tuned override (localStorage) takes effect. MVP: override applies on next load
// (admin offers "Save & reload"). Later: a backend serves these to all clients.
import DEFAULTS from "../../docs/numbers.json";

const KEY = "ruglands:numbers";

const BUILDING_MIGHT_WEIGHTS: Record<string, number> = {
  "building.keep": 40, "building.bank": 8, "building.oilwell": 8, "building.powerplant": 8,
  "building.storage": 6, "building.armyCamp": 8, "building.navalBase": 9, "building.airfield": 10,
  "building.hospital": 6, "building.embassy": 6, "building.wall": 5, "building.academy": 10,
  "building.watchtower": 5,
};

function addMissingDefaults(defaultValue: any, currentValue: any): any {
  if (currentValue === undefined) return JSON.parse(JSON.stringify(defaultValue));
  if (!defaultValue || typeof defaultValue !== "object" || Array.isArray(defaultValue)) return currentValue;
  const output = currentValue && typeof currentValue === "object" && !Array.isArray(currentValue)
    ? JSON.parse(JSON.stringify(currentValue))
    : {};
  Object.entries(defaultValue).forEach(([key, value]) => {
    output[key] = addMissingDefaults(value, output[key]);
  });
  return output;
}

// Preserve browser-local Balance Lab overrides across schema versions.
export function migrateLegacyNumbers(input: any): any {
  if (!input || typeof input !== "object") return input;
  if (input.meta?.version === (DEFAULTS as any).meta.version) return input;
  if (input.meta?.version === "0.6" && input.global?.display) {
    const upgraded = addMissingDefaults(DEFAULTS, input);
    upgraded.meta.version = (DEFAULTS as any).meta.version;
    return upgraded;
  }
  const numbers = JSON.parse(JSON.stringify(input));
  if (numbers.buildings?.["building.barracks"] && !numbers.buildings["building.armyCamp"]) {
    const legacy = numbers.buildings["building.barracks"];
    const definitions = [
      ["building.armyCamp", "troop.army", 1, 0.55, 0.65],
      ["building.navalBase", "troop.navy", 2, 0.60, 0.75],
      ["building.airfield", "troop.air", 4, 0.65, 0.85],
    ] as const;
    const specialized: Record<string, any> = {};
    definitions.forEach(([key, troop, unlockAtKeep, costFactor, timeFactor]) => {
      const building = JSON.parse(JSON.stringify(legacy));
      building.unlockAtKeep = unlockAtKeep;
      building.trains = troop;
      Object.values(building.levels ?? {}).forEach((value: any) => {
        Object.keys(value.cost ?? {}).forEach((resource) => {
          value.cost[resource] = Math.max(1, Math.round(value.cost[resource] * costFactor));
        });
        value.timeSec = value.timeSec === 0 ? 0 : Math.max(1, Math.round(value.timeSec * timeFactor));
        value.troopCapacity = Math.max(1, Math.ceil(value.troopCapacity / 3));
      });
      specialized[key] = building;
    });
    const buildings: Record<string, any> = {};
    Object.entries(numbers.buildings).forEach(([key, building]) => {
      if (key === "building.barracks") Object.assign(buildings, specialized);
      else buildings[key] = building;
    });
    numbers.buildings = buildings;
    numbers.startingLayout.prebuilt = (numbers.startingLayout.prebuilt ?? [])
      .filter((key: string) => key !== "building.barracks")
      .concat("building.armyCamp");
    Object.values(numbers.troops ?? {}).forEach((troop: any) => {
      Object.values(troop.tiers ?? {}).forEach((row: any) => {
        row.unlockAtTrainingBuilding = row.unlockAtKeep;
        delete row.unlockAtKeep;
      });
    });
    const replacements: Record<string, string> = {
      "20": "building.wall", "21": "building.academy", "22": "building.wall", "23": "building.academy",
      "24": "building.wall", "25": "building.academy", "26": "building.wall", "27": "building.academy",
      "28": "building.wall", "29": "building.wall", "30": "building.wall",
    };
    Object.entries(numbers.townhallPrerequisites?.perLevel ?? {}).forEach(([level, requirements]: [string, any]) => {
      numbers.townhallPrerequisites.perLevel[level] = requirements.map((key: string) => key === "building.barracks" ? replacements[level] : key);
    });
  }

  numbers.global.display = JSON.parse(JSON.stringify((DEFAULTS as any).global.display));
  numbers.global.might = JSON.parse(JSON.stringify((DEFAULTS as any).global.might));
  Object.entries(numbers.buildings ?? {}).forEach(([key, building]: [string, any]) => {
    Object.entries(building.levels ?? {}).forEach(([levelText, row]: [string, any]) => {
      row.might = Math.round((BUILDING_MIGHT_WEIGHTS[key] ?? 5) * Math.pow(Number(levelText), 4) * 60);
    });
  });
  const troopPower = [2, 4, 8, 16, 24, 36, 52, 72, 96, 128];
  Object.values(numbers.troops ?? {}).forEach((troop: any) => {
    for (let tier = 1; tier <= 10; tier += 1) troop.tiers[String(tier)].power = troopPower[tier - 1];
  });
  numbers.designTargets.might = JSON.parse(JSON.stringify((DEFAULTS as any).designTargets.might));
  numbers.meta.version = (DEFAULTS as any).meta.version;
  return addMissingDefaults(DEFAULTS, numbers);
}

export function defaultN(): any {
  return DEFAULTS;
}

// Effective numbers = saved override if present, else the bundled defaults.
export function getN(): any {
  try {
    const s = localStorage.getItem(KEY);
    return s ? migrateLegacyNumbers(JSON.parse(s)) : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

export function saveN(obj: any) {
  try {
    localStorage.setItem(KEY, JSON.stringify(obj));
  } catch {}
}

export function resetN() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}

export function hasOverride(): boolean {
  try {
    return localStorage.getItem(KEY) != null;
  } catch {
    return false;
  }
}
