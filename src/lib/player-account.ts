import { hasLocalGm, localGmRequested } from "./gm";
import { isGraphicsTier, type GraphicsTier } from "./graphics-tier";

export type LanguageCode = "en" | "zh-CN" | "zh-TW" | "ja" | "ko" | "es";
export type NumberFormat = "compact" | "full";
export type ConsentKey = "terms" | "privacy" | "digitalAssets";
export type LoginMethod = "wallet" | "google";

export type PlanetSkinId = "dust-homestead" | "blue-marble" | "void-touched" | "sovereign-core" | "event-horizon" | "solar-imperator";
export type PlanetOrbitId = "survey-ring" | "orbital-belt" | "accretion-halo" | "sovereign-crown";
export type PlanetHaloId = "faint-corona" | "pulse-aura" | "aurora-veil" | "radiant-crown";
export type MarchSignatureId = "ion-wake" | "warp-thread" | "aurora-sail" | "comet-vanguard";
export type StrikeSignatureId = "vector-snap" | "dust-fracture" | "blockfall" | "comet-break" | "rift-guillotine" | "solar-bloom" | "finality-engine" | "whalefall-protocol";
export type ChatSignalId = "clear-channel" | "signal-boost" | "verdant-hail" | "void-whisper" | "ember-cipher" | "sovereign-flare" | "eclipse-herald";
export type GameCursorId = "reticle" | "comet" | "sigil";
export type TitleId = "frontier-born" | "rift-cartographer" | "whale-fall";
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
  /** Rendering quality: "auto" adapts to the device, or a pinned tier. */
  graphicsTier: GraphicsTier;
  autoTranslateComms: boolean;
  criticalNotifications: boolean;
  showAchievements: boolean;
  allowDirectMessages: boolean;
  consents: Record<ConsentKey, { version: string; acceptedAt: string | null }>;
}

export interface CosmeticLoadout {
  planetBody: PlanetSkinId;
  marchSignature: MarchSignatureId | null;
  strikeSignature: StrikeSignatureId | null;
  chatSignal: ChatSignalId | null;
  halo: PlanetHaloId | null;
  /** Legacy slot retained only so older local saves remain readable. */
  surface: string;
  orbit: PlanetOrbitId | null;
  glyph: string;
  trail: string;
  title: TitleId | null;
  cursor: GameCursorId | null;
}

export interface CosmeticVault {
  owned: string[];
  equipped: CosmeticLoadout;
}

export interface PlanetSkinDefinition {
  id: PlanetSkinId;
  name: string;
  translatedName?: string;
  rarity: CosmeticRarity;
  tier?: "R" | "SR" | "SSR" | "UR";
  accent?: string;
  price?: number | null;
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
    id: "dust-homestead",
    name: "Dust Homestead",
    translatedName: "荒土",
    rarity: "ISSUED",
    tier: "R",
    accent: "#c8a06a",
    price: 0,
    transmission: "A weathered first world. Quiet craters keep the record of every frontier dawn.",
    source: "Command activation // default",
  },
  {
    id: "blue-marble",
    name: "Blue Marble",
    translatedName: "蔚蓝",
    rarity: "RELIC",
    tier: "SR",
    accent: "#59dcff",
    price: 1400,
    transmission: "Ocean, cloud and a living edge of day. Proof that the dark can shelter a world.",
    source: "Credit exchange · Relic draw // ◈1,400",
  },
  {
    id: "void-touched",
    name: "Void-Touched",
    translatedName: "触虚核",
    rarity: "MYTHIC",
    tier: "SSR",
    accent: "#a96cff",
    price: 3200,
    transmission: "Obsidian crust. Living fractures. A scar that refuses to close.",
    source: "Limited relic draw // ◈3,200",
  },
  {
    id: "sovereign-core",
    name: "Sovereign Core",
    translatedName: "君核",
    rarity: "SOVEREIGN",
    tier: "UR",
    accent: "#f3c46b",
    price: null,
    transmission: "Contained stellar fury. Fourteen flare-signals rise and die beneath a sovereign rim.",
    source: "Season ascent // earn-only",
  },
  {
    id: "event-horizon",
    name: "Event Horizon",
    rarity: "SOVEREIGN",
    tier: "UR",
    accent: "#a96cff",
    transmission: "The city is gone. Its gravity remains.",
    source: "Season prestige track",
  },
  {
    id: "solar-imperator",
    name: "Solar Imperator",
    rarity: "RELIC",
    tier: "SR",
    accent: "#ffb454",
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

export const STRIKE_SIGNATURES: CosmeticEffectDefinition<StrikeSignatureId>[] = [
  {
    id: "vector-snap", skinId: "strike.vector", name: "Vector Snap", translatedName: "向量闭合",
    rarity: "ISSUED", tier: "R", accent: "#58dfff", price: 520,
    transmission: "The sky discards every point but one.",
    source: "Credit exchange // ◈520",
  },
  {
    id: "dust-fracture", skinId: "strike.dust", name: "Dust Fracture", translatedName: "星尘裂痕",
    rarity: "RELIC", tier: "R", accent: "#c8a06a", price: 620,
    transmission: "The wound is brief. The dust remembers.",
    source: "Frontier rupture cache // ◈620",
  },
  {
    id: "blockfall", skinId: "strike.blockfall", name: "Blockfall", translatedName: "区块坠击",
    rarity: "RELIC", tier: "SR", accent: "#4ff0d0", price: 1350,
    transmission: "Every block agrees on where the fall ends.",
    source: "Relic draw // ◈1,350",
  },
  {
    id: "comet-break", skinId: "strike.comet", name: "Comet Break", translatedName: "彗核破",
    rarity: "RELIC", tier: "SR", accent: "#58dfff", price: 1500,
    transmission: "The voyage ends. Its fragments keep moving.",
    source: "Relic draw // ◈1,500",
  },
  {
    id: "rift-guillotine", skinId: "strike.rift", name: "Rift Guillotine", translatedName: "裂隙裁决",
    rarity: "MYTHIC", tier: "SSR", accent: "#ad70ff", price: 3100,
    transmission: "Space waits for the second cut before it screams.",
    source: "Rift Sovereign cache // ◈3,100",
  },
  {
    id: "solar-bloom", skinId: "strike.solar", name: "Solar Bloom", translatedName: "日冕盛放",
    rarity: "MYTHIC", tier: "SSR", accent: "#f3c46b", price: 3400,
    transmission: "A small sun flowers only to turn its petals inward.",
    source: "Helios breach cache // ◈3,400",
  },
  {
    id: "finality-engine", skinId: "strike.finality", name: "Finality Engine", translatedName: "终局确认",
    rarity: "SOVEREIGN", tier: "UR", accent: "#f3c46b", price: null,
    transmission: "Three confirmations. One history. No return.",
    source: "Season ascent // earn-only",
  },
  {
    id: "whalefall-protocol", skinId: "strike.whalefall", name: "Whalefall Protocol", translatedName: "鲸落协议",
    rarity: "SOVEREIGN", tier: "UR", accent: "#72d8ff", price: null,
    transmission: "The largest signals do not explode. They change gravity.",
    source: "Whale covenant // earn-only",
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
  { id: "clear-channel", name: "Clear Channel", translatedName: "明码", rarity: "ISSUED", tier: "R", accent: "#eaf4ff", transmission: "An unmodified commander signal.", source: "Command activation" },
  { id: "signal-boost", name: "Signal Boost", translatedName: "增幅", rarity: "RELIC", tier: "SR", accent: "#59dcff", price: 900, transmission: "The name pings as it transmits.", source: "Relic draw // ◈900" },
  { id: "verdant-hail", name: "Verdant Hail", translatedName: "青鸣", rarity: "RELIC", tier: "SR", accent: "#43f2a1", price: 900, transmission: "Spores drift up from a breathing name.", source: "Relic draw // ◈900" },
  { id: "void-whisper", name: "Void Whisper", translatedName: "虚语", rarity: "MYTHIC", tier: "SSR", accent: "#a96cff", transmission: "A black hole spits the name out, then swallows it.", source: "Rift Sovereign cache" },
  { id: "ember-cipher", name: "Ember Cipher", translatedName: "炽语", rarity: "MYTHIC", tier: "SSR", accent: "#ffbf63", transmission: "The name is burned in, then burned away.", source: "Rift Sovereign cache" },
  { id: "sovereign-flare", name: "Sovereign Flare", translatedName: "君焰", rarity: "SOVEREIGN", tier: "UR", accent: "#f3c46b", price: null, transmission: "A crowned nameplate for sector-defining commanders.", source: "Season prestige track // earn-only" },
  { id: "eclipse-herald", name: "Eclipse Herald", translatedName: "蚀谕", rarity: "SOVEREIGN", tier: "UR", accent: "#f6e6bf", price: null, transmission: "The name resolves out of gathered light.", source: "Season prestige track // earn-only" },
];

export const GAME_CURSORS: CosmeticEffectDefinition<GameCursorId>[] = [
  { id: "reticle", name: "Reticle", translatedName: "星标准星", rarity: "ISSUED", tier: "R", accent: "#59dcff", transmission: "Four sensor ticks hold the command point in their center.", source: "Command activation" },
  { id: "comet", name: "Comet", translatedName: "彗针", rarity: "RELIC", tier: "SR", accent: "#59dcff", price: 700, transmission: "A navigator's arrow carrying one last spark through the dark.", source: "Relic draw // ◈700" },
  { id: "sigil", name: "Sovereign Sigil", translatedName: "君印", rarity: "SOVEREIGN", tier: "UR", accent: "#f3c46b", price: null, transmission: "A gold command seal follows the hand that rules the sector.", source: "Season ascent // earn-only" },
];

export const TITLE_SEALS: CosmeticEffectDefinition<TitleId>[] = [
  { id: "frontier-born", name: "Frontier Born", translatedName: "边疆初生", rarity: "ISSUED", tier: "R", accent: "#8ca9ba", transmission: "The first seal carried beyond the safe orbit.", source: "Command activation" },
  { id: "rift-cartographer", name: "Rift Cartographer", translatedName: "裂隙绘师", rarity: "MYTHIC", tier: "SSR", accent: "#a96cff", transmission: "A title written in routes no ordinary chart can hold.", source: "Rogue Codex ascent" },
  { id: "whale-fall", name: "Whale Fall", translatedName: "鲸落", rarity: "SOVEREIGN", tier: "UR", accent: "#f3c46b", transmission: "The market remembers the gravity of your arrival.", source: "Season prestige track" },
];

export const CONSENT_VERSIONS: Record<ConsentKey, string> = {
  terms: "0.1",
  privacy: "0.1",
  digitalAssets: "0.1",
};

export const PLAYER_ACCOUNT_CHANGED_EVENT = "ruglands:player-account-changed";
export const COSMETIC_VAULT_CHANGED_EVENT = "ruglands:cosmetic-vault-changed";

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
    graphicsTier: "auto",
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
    ...STRIKE_SIGNATURES.map((signature) => `strike:${signature.id}`),
    ...CHAT_SIGNALS.map((signal) => `chat:${signal.id}`),
    ...GAME_CURSORS.map((cursor) => `cursor:${cursor.id}`),
    ...TITLE_SEALS.map((title) => `title:${title.id}`),
    "surface:founder-grid", "glyph:genesis", "trail:none",
  ];
}

function defaultVault(address: string): CosmeticVault {
  const gm = gmCosmetics(address);
  const owned = Array.from(new Set(["planet:dust-homestead", "orbit:survey-ring", "halo:faint-corona", "march:ion-wake", "strike:vector-snap", "chat:clear-channel", "cursor:reticle", "surface:founder-grid", "glyph:genesis", "trail:none", "title:frontier-born", ...gm]));
  return {
    owned,
    equipped: {
      planetBody: gm.length ? "void-touched" : "dust-homestead",
      marchSignature: gm.length ? "aurora-sail" : "ion-wake",
      strikeSignature: gm.length ? "whalefall-protocol" : "vector-snap",
      chatSignal: gm.length ? "void-whisper" : "clear-channel",
      halo: gm.length ? "radiant-crown" : "faint-corona",
      surface: "founder-grid",
      orbit: gm.length ? "accretion-halo" : "survey-ring",
      glyph: "genesis",
      trail: "none",
      title: "frontier-born",
      cursor: "reticle",
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
    graphicsTier: isGraphicsTier(saved.graphicsTier) ? saved.graphicsTier : fallback.graphicsTier,
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
  const savedOwned = (Array.isArray(saved.owned) ? saved.owned : []).filter((relic) => relic !== "planet:civic-core");
  const owned = Array.from(new Set([...fallback.owned, ...savedOwned]));
  const savedEquipped = (saved.equipped || {}) as Partial<Omit<CosmeticLoadout, "halo" | "planetBody" | "orbit" | "marchSignature" | "strikeSignature" | "chatSignal" | "title" | "cursor">> & {
    halo?: string | null;
    planetBody?: string;
    orbit?: string | null;
    marchSignature?: string | null;
    strikeSignature?: string | null;
    chatSignal?: string | null;
    title?: string | null;
    cursor?: string | null;
  };
  const legacyOrbit = savedEquipped.halo === "orbit-one" ? "survey-ring" : undefined;
  const savedHalo = savedEquipped.halo === null
    ? null
    : PLANET_HALOS.some((halo) => halo.id === savedEquipped.halo) ? savedEquipped.halo as PlanetHaloId : fallback.equipped.halo;
  const savedOrbit = savedEquipped.orbit === null
    ? null
    : PLANET_ORBITS.some((orbit) => orbit.id === savedEquipped.orbit) ? savedEquipped.orbit as PlanetOrbitId : legacyOrbit || fallback.equipped.orbit;
  const savedMarch = savedEquipped.marchSignature === null
    ? null
    : MARCH_SIGNATURES.some((signature) => signature.id === savedEquipped.marchSignature) ? savedEquipped.marchSignature as MarchSignatureId : fallback.equipped.marchSignature;
  const savedStrike = savedEquipped.strikeSignature === null
    ? null
    : STRIKE_SIGNATURES.some((signature) => signature.id === savedEquipped.strikeSignature) ? savedEquipped.strikeSignature as StrikeSignatureId : fallback.equipped.strikeSignature;
  const savedChat = savedEquipped.chatSignal === null
    ? null
    : CHAT_SIGNALS.some((signal) => signal.id === savedEquipped.chatSignal) ? savedEquipped.chatSignal as ChatSignalId : fallback.equipped.chatSignal;
  const savedTitle = savedEquipped.title === null
    ? null
    : TITLE_SEALS.some((title) => title.id === savedEquipped.title) ? savedEquipped.title as TitleId : fallback.equipped.title;
  const savedCursor = savedEquipped.cursor === null
    ? null
    : GAME_CURSORS.some((cursor) => cursor.id === savedEquipped.cursor) ? savedEquipped.cursor as GameCursorId : fallback.equipped.cursor;
  const savedCore = savedEquipped.planetBody === "civic-core" ? "dust-homestead" : savedEquipped.planetBody;
  const equipped: CosmeticLoadout = {
    ...fallback.equipped,
    ...savedEquipped,
    planetBody: (savedCore || fallback.equipped.planetBody) as PlanetSkinId,
    halo: savedHalo,
    orbit: savedOrbit,
    marchSignature: savedMarch,
    strikeSignature: savedStrike,
    chatSignal: savedChat,
    title: savedTitle,
    cursor: savedCursor,
  };
  if (!PLANET_SKINS.some((skin) => skin.id === equipped.planetBody) || !owned.includes(`planet:${equipped.planetBody}`)) equipped.planetBody = "dust-homestead";
  if (equipped.orbit !== null && (!PLANET_ORBITS.some((orbit) => orbit.id === equipped.orbit) || !owned.includes(`orbit:${equipped.orbit}`))) equipped.orbit = fallback.equipped.orbit;
  if (equipped.halo !== null && (!PLANET_HALOS.some((halo) => halo.id === equipped.halo) || !owned.includes(`halo:${equipped.halo}`))) equipped.halo = fallback.equipped.halo;
  if (equipped.marchSignature !== null && (!MARCH_SIGNATURES.some((signature) => signature.id === equipped.marchSignature) || !owned.includes(`march:${equipped.marchSignature}`))) equipped.marchSignature = fallback.equipped.marchSignature;
  if (equipped.strikeSignature !== null && (!STRIKE_SIGNATURES.some((signature) => signature.id === equipped.strikeSignature) || !owned.includes(`strike:${equipped.strikeSignature}`))) equipped.strikeSignature = fallback.equipped.strikeSignature;
  if (equipped.chatSignal !== null && (!CHAT_SIGNALS.some((signal) => signal.id === equipped.chatSignal) || !owned.includes(`chat:${equipped.chatSignal}`))) equipped.chatSignal = fallback.equipped.chatSignal;
  if (equipped.title !== null && (!TITLE_SEALS.some((title) => title.id === equipped.title) || !owned.includes(`title:${equipped.title}`))) equipped.title = fallback.equipped.title;
  if (equipped.cursor !== null && (!GAME_CURSORS.some((cursor) => cursor.id === equipped.cursor) || !owned.includes(`cursor:${equipped.cursor}`))) equipped.cursor = fallback.equipped.cursor;
  return { owned, equipped };
}

export function saveCosmeticVault(address: string, vault: CosmeticVault): void {
  writeJson(VAULT_KEY(address), vault);
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") window.dispatchEvent(new Event(COSMETIC_VAULT_CHANGED_EVENT));
  } catch {}
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

export function ownsStrikeSignature(vault: CosmeticVault, signatureId: StrikeSignatureId): boolean {
  return vault.owned.includes(`strike:${signatureId}`);
}

export function ownsChatSignal(vault: CosmeticVault, signalId: ChatSignalId): boolean {
  return vault.owned.includes(`chat:${signalId}`);
}

export function ownsGameCursor(vault: CosmeticVault, cursorId: GameCursorId): boolean {
  return vault.owned.includes(`cursor:${cursorId}`);
}

export function ownsTitleSeal(vault: CosmeticVault, titleId: TitleId): boolean {
  return vault.owned.includes(`title:${titleId}`);
}
