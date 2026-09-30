// Per-wallet player profile. MVP persistence = localStorage (swap to D1 later).
export interface Profile {
  address: string;
  name: string;
  motto?: string;
  avatarId?: string;
  /** Backend player id the uploaded portrait ("u<version>" avatarId) belongs to. */
  avatarPlayerId?: string;
  /** Last uploaded portrait token ("u<version>"): stays selectable after switching to a sigil. */
  uploadedAvatar?: string;
  title?: string;
  lastRenamedAt?: string;
  faction: string | null; // alliance token contract address (CA), or null = no alliance
  factionSymbol: string | null;
  keepLevel: number;
  createdAt: string;
  renamedOnce: boolean;
}

export function normalizeUsername(value: string): string {
  return value.trim().normalize("NFKC");
}

export function usernameLength(value: string): number {
  return Array.from(normalizeUsername(value)).length;
}

/**
 * Renaming: the system issues a default name at sign-up; the first change is free and every
 * later change spends one Rename Signal (Warehouse item). The server enforces this too.
 */
export function canRenameForFree(profile: Pick<Profile, "lastRenamedAt" | "renamedOnce">): boolean {
  return !profile.lastRenamedAt && !profile.renamedOnce;
}

const KEY = (a: string) => `ruglands:profile:${a.toLowerCase()}`;

export function loadProfile(a: string): Profile | null {
  try {
    const s = localStorage.getItem(KEY(a));
    if (!s) return null;
    const { civilizationName: _legacyCivilizationName, ...profile } = JSON.parse(s) as Profile & { civilizationName?: string };
    return profile;
  } catch {
    return null;
  }
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY(p.address), JSON.stringify(p));
  } catch {}
}

export function clearProfile(a: string) {
  try {
    localStorage.removeItem(KEY(a));
  } catch {}
}

// Deterministic default name so the same wallet always gets the same handle.
export function autoName(address: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 2; i < address.length; i++) {
    h ^= address.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const n = (h % 10000000).toString().padStart(7, "0");
  return `Ruglord${n}`;
}

/**
 * Introductions must not carry anything that could send other players somewhere: links,
 * domains (also spelled "x dot com" / "x[.]com"), invite handles, or wallet addresses.
 * Light-touch on purpose: no word filter, only scam vectors.
 */
const LINK_TLDS = "com|net|org|io|xyz|gg|me|app|fi|finance|co|ly|link|site|online|top|vip|cc|tv|ai|so|to|sh|dev|info|biz|live|pro|club|fun|money|exchange|markets|trade|cash|bet|win|lol|meme|wtf";
const LINK_PATTERNS: RegExp[] = [
  /\b(?:https?|hxxps?|ftp)\s*[:：]\s*\/\//i,
  /\bwww\s*(?:\.|\[\.\]|\(\.\)|\bdot\b)/i,
  // A literal dot must touch both sides ("site.com"); a sentence break ("Hello. Me") is not a domain.
  new RegExp(`\\b[a-z0-9][a-z0-9-]*(?:\\.|\\s*(?:\\[\\.\\]|\\(\\.\\)|\\(dot\\)|\\[dot\\])\\s*|\\s+dot\\s+)(?:${LINK_TLDS})\\b`, "i"),
  /\b(?:t\.me|telegram\.me|discord\.gg|discord(?:app)?\.com\/invite|wa\.me|bit\.ly|tinyurl)\b/i,
  /\b0x[a-f0-9]{16,}\b/i,
  /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/,
  /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/,
];
export function bioLooksLikeLink(text: string): boolean {
  const flat = text.normalize("NFKC");
  return LINK_PATTERNS.some((pattern) => pattern.test(flat));
}

/**
 * Commander ID shown in Account and typed to confirm account deletion: "IV-7F3K-92QX".
 * Derived from the backend player id (same on client and server), Crockford base32, 40 bits.
 */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export function commanderIdOf(playerId: string): string {
  let a = 2166136261, b = 0x9e3779b9;
  for (let i = 0; i < playerId.length; i += 1) {
    const c = playerId.toLowerCase().charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = Math.imul(b ^ c, 2246822519) >>> 0;
  }
  let out = "";
  for (let i = 0; i < 8; i += 1) out += CROCKFORD[(i < 6 ? a >>> (i * 5) : b >>> ((i - 6) * 5)) & 31];
  return `IV-${out.slice(0, 4)}-${out.slice(4)}`;
}
