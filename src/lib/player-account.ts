import { hasLocalGm, localGmRequested } from "./gm";

export type LanguageCode = "en" | "zh-CN" | "zh-TW" | "ja" | "ko" | "es";
export type NumberFormat = "compact" | "full";
export type ConsentKey = "terms" | "privacy" | "digitalAssets";
export type LoginMethod = "wallet" | "google";

export type PlanetSkinId = "civic-core" | "void-touched" | "event-horizon" | "solar-imperator";
export type PlanetOrbitId = "survey-ring" | "orbital-belt" | "accretion-halo" | "sovereign-crown";
export type PlanetHaloId = "faint-corona" | "pulse-aura" | "aurora-veil" | "radiant-crown";
export type MarchSignatureId = "ion-wake" | "warp-thread" | "aurora-sail" | "comet-vanguard";
export type ChatSignalId = "clear-channel" | "void-whisper" | "sovereign-flare";
export type CosmeticRarity = "ISSUED" | "RELIC" | "MYTHIC" | "SOVEREIGN";

export interface PlayerAccount {
  playerId: string;
  loginMethod: LoginMethod;
  primaryWallet: string | null;
  linkedWallets: string[];
  alliancePledge: {
    wallet: string;
    chainId: number;
    tokenAddress: string;
    lastCheckedAt: string;
    graceEndsAt: string | null;
  } | null;
  credits: number;
  language: LanguageCode;
  timeZone: string;
  numberFormat: NumberFormat;
  soundEnabled: boolean;
  musicEnabled: boolean;
  /** Player-selected mix inside the game's deliberately quiet music ceiling. */
  musicVolume: number;
  reducedMotion: boolean;
  autoTranslateComms: boolean;
  criticalNotifications: boolean;
  showAchievements: boolean;
  allowDirectMessages: boolean;
  consents: Record<ConsentKey, { version: string; acceptedAt: string | null }>;
}

export interface CosmeticLoadout {
  planetBody: PlanetSkinId;
  marchSignature: MarchSignatureId;
  chatSignal: ChatSignalId;
  halo: PlanetHaloId;
  /** Legacy slot retained only so older local saves remain readable. */
  surface: string;
  orbit: PlanetOrbitId;
  glyph: string;
  trail: string;
  title: string;
}

export interface CosmeticVault {
  owned: string[];
  equipped: CosmeticLoadout;
}

export interface PlanetSkinDefinition {
  id: PlanetSkinId;
  name: string;
  rarity: CosmeticRarity;
  transmission: string;
  source: string;
}

export interface CosmeticEffectDefinition<Id extends string> {
  id: Id;
  skinId?: string;
  name: string;
  translatedName?: string;
  rarity: CosmeticRarity;
  tier?: "R" | "SR" | "SSR" | "UR";
  accent?: string;
  price?: number | null;
  transmission: string;
  source: string;
}

export const PLANET_SKINS: PlanetSkinDefinition[] = [
  {
    id: "civic-core",
    name: "Civic Core",
    rarity: "ISSUED",
    transmission: "First light of a newly founded civilization.",
    source: "Townhall founding rite",
  },
  {
    id: "void-touched",
    name: "Void-Touched",
    rarity: "MYTHIC",
    transmission: "Obsidian crust. Living fractures. A scar that refuses to close.",
    source: "Rift Sovereign cache",
  },
  {
    id: "event-horizon",
    name: "Event Horizon",
    rarity: "SOVEREIGN",
    transmission: "The city is gone. Its gravity remains.",
    source: "Season prestige track",
  },
  {
    id: "solar-imperator",
    name: "Solar Imperator",
    rarity: "RELIC",
    transmission: "A forged sun crowned in orbital gold.",
    source: "Alliance world engineering",
  },
];

export const MARCH_SIGNATURES: CosmeticEffectDefinition<MarchSignatureId>[] = [
  {
    id: "ion-wake", skinId: "march.ion", name: "Ion Wake", translatedName: "离子尾迹",
    rarity: "ISSUED", tier: "R", accent: "#59dcff", price: 480,
    transmission: "Cold light falls away segment by segment. Clean. Restrained. Unmistakable.",
    source: "Credit exchange // ◈480",
  },
  {
    id: "warp-thread", skinId: "march.warp", name: "Warp Thread", translatedName: "曲率折线",
    rarity: "RELIC", tier: "SR", accent: "#a96cff", price: 1200,
    transmission: "The fleet folds the dark ahead and pulls a braided corridor through the wake.",
    source: "Credit exchange · Relic draw // ◈1,200",
  },
  {
    id: "aurora-sail", skinId: "march.aurora", name: "Aurora Sail", translatedName: "极光帆",
    rarity: "MYTHIC", tier: "SSR", accent: "#4ff0d0", price: 2800,
    transmission: "A living curtain of teal, ion-blue and violet is painted across the voyage.",
    source: "Limited relic draw // ◈2,800",
  },
  {
    id: "comet-vanguard", skinId: "march.comet", name: "Comet Vanguard", translatedName: "彗锋",
    rarity: "SOVEREIGN", tier: "UR", accent: "#f3c46b", price: null,
    transmission: "The comet declares its intent: cyan to scout, gold to harvest, red to strike.",
    source: "Season ascent // earn-only",
  },
];

export const PLANET_ORBITS: CosmeticEffectDefinition<PlanetOrbitId>[] = [
  {
    id: "survey-ring", skinId: "orbit.survey", name: "Survey Ring", translatedName: "勘测环",
    rarity: "ISSUED", tier: "R", accent: "#59dcff", price: 420,
    transmission: "A lone survey mark circles the frontier, measuring worlds that have no names yet.",
    source: "Credit exchange // ◈420",
  },
  {
    id: "orbital-belt", skinId: "orbit.belt", name: "Orbital Belt", translatedName: "轨道带",
    rarity: "RELIC", tier: "SR", accent: "#a96cff", price: 1100,
    transmission: "Twin lanes, staggered satellites and the debris of an installation that never sleeps.",
    source: "Credit exchange · Relic draw // ◈1,100",
  },
  {
    id: "accretion-halo", skinId: "orbit.accretion", name: "Accretion Halo", translatedName: "吸积光环",
    rarity: "MYTHIC", tier: "SSR", accent: "#ffb454", price: 2600,
    transmission: "Amber matter races the inner edge and vanishes into violet at the darkward rim.",
    source: "Limited relic draw // ◈2,600",
  },
  {
    id: "sovereign-crown", skinId: "orbit.crown", name: "Sovereign Crown", translatedName: "君冕环",
    rarity: "SOVEREIGN", tier: "UR", accent: "#d7e7ff", price: null,
    transmission: "A gyroscopic crown whose six gold witnesses orbit a realm-level civilization.",
    source: "Season ascent // earn-only",
  },
];

export const PLANET_HALOS: CosmeticEffectDefinition<PlanetHaloId>[] = [
  {
    id: "faint-corona", skinId: "halo.corona", name: "Faint Corona", translatedName: "微光冕",
    rarity: "ISSUED", tier: "R", accent: "#59dcff", price: 400,
    transmission: "A quiet breath of light held close to the world.",
    source: "Credit exchange // ◈400",
  },
  {
    id: "pulse-aura", skinId: "halo.pulse", name: "Pulse Aura", translatedName: "脉冲光晕",
    rarity: "RELIC", tier: "SR", accent: "#a96cff", price: 1050,
    transmission: "The world sends a slow violet heartbeat into the dark.",
    source: "Credit exchange · Relic draw // ◈1,050",
  },
  {
    id: "aurora-veil", skinId: "halo.aurora", name: "Aurora Veil", translatedName: "极光晕纱",
    rarity: "MYTHIC", tier: "SSR", accent: "#4ff0d0", price: 2500,
    transmission: "Teal and violet curtains drift across the planet's limb.",
    source: "Limited relic draw // ◈2,500",
  },
  {
    id: "radiant-crown", skinId: "halo.radiant", name: "Radiant Crown", translatedName: "光辉圣冕",
    rarity: "SOVEREIGN", tier: "UR", accent: "#f3c46b", price: null,
    transmission: "Light gathers into a king's crown, crumbles outward, then gathers again.",
    source: "Season ascent // earn-only",
  },
];

export const CHAT_SIGNALS: CosmeticEffectDefinition<ChatSignalId>[] = [
  { id: "clear-channel", name: "Clear Channel", rarity: "ISSUED", transmission: "An unmodified commander signal.", source: "Command activation" },
  { id: "void-whisper", name: "Void Whisper", rarity: "MYTHIC", transmission: "The name arrives a fraction before the message.", source: "Rift Sovereign cache" },
  { id: "sovereign-flare", name: "Sovereign Flare", rarity: "SOVEREIGN", transmission: "A nameplate forged for sector-defining commanders.", source: "Season prestige track" },
];

export const CONSENT_VERSIONS: Record<ConsentKey, string> = {
  terms: "0.1",
  privacy: "0.1",
  digitalAssets: "0.1",
};

export const PLAYER_ACCOUNT_CHANGED_EVENT = "ruglands:player-account-changed";

const ACCOUNT_KEY = (playerId: string) => `ruglands:account:${playerId.toLowerCase()}`;
const LEGACY_ACCOUNT_KEY = (address: string) => `ruglands:account:${address.toLowerCase()}`;
const WALLET_INDEX_KEY = (address: string) => `ruglands:wallet-account:${address.toLowerCase()}`;
const VAULT_KEY = (address: string) => `ruglands:cosmetics:${address.toLowerCase()}`;

function stablePlayerId(address: string): string {
  let hash = 2166136261 >>> 0;
  for (const character of address.toLowerCase()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return `PLY-${hash.toString(16).toUpperCase().padStart(8, "0")}`;
}

function defaultAccount(address: string): PlayerAccount {
  return {
    playerId: stablePlayerId(address),
    loginMethod: "wallet",
    primaryWallet: address,
    linkedWallets: [address],
    alliancePledge: null,
    credits: 0,
    language: "en",
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    numberFormat: "compact",
    soundEnabled: true,
    musicEnabled: true,
    musicVolume: 1,
    reducedMotion: false,
    autoTranslateComms: false,
    criticalNotifications: true,
    showAchievements: true,
    allowDirectMessages: true,
    consents: {
      terms: { version: CONSENT_VERSIONS.terms, acceptedAt: null },
      privacy: { version: CONSENT_VERSIONS.privacy, acceptedAt: null },
      digitalAssets: { version: CONSENT_VERSIONS.digitalAssets, acceptedAt: null },
    },
  };
}

function gmCosmetics(address: string): string[] {
  if (!(localGmRequested() || hasLocalGm(address))) return [];
  return [
    ...PLANET_SKINS.map((skin) => `planet:${skin.id}`),
    ...PLANET_ORBITS.map((orbit) => `orbit:${orbit.id}`),
    ...PLANET_HALOS.map((halo) => `halo:${halo.id}`),
    ...MARCH_SIGNATURES.map((signature) => `march:${signature.id}`),
    ...CHAT_SIGNALS.map((signal) => `chat:${signal.id}`),
    "surface:founder-grid", "glyph:genesis", "trail:none",
    "title:frontier-born", "title:rift-cartographer", "title:whale-fall",
  ];
}

function defaultVault(address: string): CosmeticVault {
  const gm = gmCosmetics(address);
  const owned = Array.from(new Set(["planet:civic-core", "orbit:survey-ring", "halo:faint-corona", "march:ion-wake", "chat:clear-channel", "surface:founder-grid", "glyph:genesis", "trail:none", "title:frontier-born", ...gm]));
  return {
    owned,
    equipped: {
      planetBody: gm.length ? "void-touched" : "civic-core",
      marchSignature: gm.length ? "aurora-sail" : "ion-wake",
      chatSignal: gm.length ? "void-whisper" : "clear-channel",
      halo: gm.length ? "radiant-crown" : "faint-corona",
      surface: "founder-grid",
      orbit: gm.length ? "accretion-halo" : "survey-ring",
      glyph: "genesis",
      trail: "none",
      title: "frontier-born",
    },
  };
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

export function loadPlayerAccount(address: string): PlayerAccount {
  const fallback = defaultAccount(address);
  const indexedPlayerId = readJson<string>(WALLET_INDEX_KEY(address));
  const saved = (indexedPlayerId ? readJson<Partial<PlayerAccount>>(ACCOUNT_KEY(indexedPlayerId)) : null)
    || readJson<Partial<PlayerAccount>>(ACCOUNT_KEY(fallback.playerId))
    || readJson<Partial<PlayerAccount>>(LEGACY_ACCOUNT_KEY(address));
  if (!saved) return fallback;
  const playerId = typeof saved.playerId === "string" && saved.playerId ? saved.playerId : indexedPlayerId || fallback.playerId;
  const primaryWallet = saved.loginMethod === "google" && saved.primaryWallet === null
    ? null
    : typeof saved.primaryWallet === "string" && saved.primaryWallet ? saved.primaryWallet : address;
  const linkedWallets = Array.from(new Set([primaryWallet, ...(primaryWallet ? [address] : []), ...(Array.isArray(saved.linkedWallets) ? saved.linkedWallets : [])].filter((wallet): wallet is string => typeof wallet === "string" && !!wallet)));
  return {
    ...fallback,
    ...saved,
    playerId,
    primaryWallet,
    linkedWallets,
    credits: Math.max(0, Number(saved.credits) || 0),
    musicVolume: saved.musicVolume == null ? fallback.musicVolume : Math.max(0, Math.min(1, Number(saved.musicVolume) || 0)),
    consents: {
      terms: { ...fallback.consents.terms, ...saved.consents?.terms },
      privacy: { ...fallback.consents.privacy, ...saved.consents?.privacy },
      digitalAssets: { ...fallback.consents.digitalAssets, ...saved.consents?.digitalAssets },
    },
  };
}

export function savePlayerAccount(account: PlayerAccount): void {
  writeJson(ACCOUNT_KEY(account.playerId), account);
  Array.from(new Set([account.primaryWallet, ...account.linkedWallets].filter((wallet): wallet is string => typeof wallet === "string" && !!wallet))).forEach((wallet) => writeJson(WALLET_INDEX_KEY(wallet), account.playerId));
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new Event(PLAYER_ACCOUNT_CHANGED_EVENT));
    }
  } catch {}
}

export function loadCosmeticVault(address: string): CosmeticVault {
  const fallback = defaultVault(address);
  const saved = readJson<Partial<CosmeticVault>>(VAULT_KEY(address));
  if (!saved) return fallback;
  const owned = Array.from(new Set([...fallback.owned, ...(Array.isArray(saved.owned) ? saved.owned : [])]));
  const savedEquipped = (saved.equipped || {}) as Partial<Omit<CosmeticLoadout, "halo">> & { halo?: string };
  const legacyOrbit = savedEquipped.halo === "orbit-one" ? "survey-ring" : undefined;
  const savedHalo = PLANET_HALOS.some((halo) => halo.id === savedEquipped.halo) ? savedEquipped.halo as PlanetHaloId : fallback.equipped.halo;
  const equipped = { ...fallback.equipped, ...savedEquipped, halo: savedHalo, orbit: savedEquipped.orbit || legacyOrbit || fallback.equipped.orbit };
  if (!PLANET_SKINS.some((skin) => skin.id === equipped.planetBody) || !owned.includes(`planet:${equipped.planetBody}`)) equipped.planetBody = "civic-core";
  if (!PLANET_ORBITS.some((orbit) => orbit.id === equipped.orbit) || !owned.includes(`orbit:${equipped.orbit}`)) equipped.orbit = "survey-ring";
  if (!PLANET_HALOS.some((halo) => halo.id === equipped.halo) || !owned.includes(`halo:${equipped.halo}`)) equipped.halo = "faint-corona";
  if (!MARCH_SIGNATURES.some((signature) => signature.id === equipped.marchSignature) || !owned.includes(`march:${equipped.marchSignature}`)) equipped.marchSignature = "ion-wake";
  if (!CHAT_SIGNALS.some((signal) => signal.id === equipped.chatSignal) || !owned.includes(`chat:${equipped.chatSignal}`)) equipped.chatSignal = "clear-channel";
  return { owned, equipped };
}

export function saveCosmeticVault(address: string, vault: CosmeticVault): void {
  writeJson(VAULT_KEY(address), vault);
}

export function ownsPlanetSkin(vault: CosmeticVault, skinId: PlanetSkinId): boolean {
  return vault.owned.includes(`planet:${skinId}`);
}

export function ownsPlanetOrbit(vault: CosmeticVault, orbitId: PlanetOrbitId): boolean {
  return vault.owned.includes(`orbit:${orbitId}`);
}

export function ownsPlanetHalo(vault: CosmeticVault, haloId: PlanetHaloId): boolean {
  return vault.owned.includes(`halo:${haloId}`);
}

export function ownsMarchSignature(vault: CosmeticVault, signatureId: MarchSignatureId): boolean {
  return vault.owned.includes(`march:${signatureId}`);
}

export function ownsChatSignal(vault: CosmeticVault, signalId: ChatSignalId): boolean {
  return vault.owned.includes(`chat:${signalId}`);
}
