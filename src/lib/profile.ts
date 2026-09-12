// Per-wallet player profile. MVP persistence = localStorage (swap to D1 later).
export interface Profile {
  address: string;
  name: string;
  motto?: string;
  avatarId?: string;
  title?: string;
  lastRenamedAt?: string;
  faction: string | null; // alliance token contract address (CA), or null = no alliance
  factionSymbol: string | null;
  keepLevel: number;
  createdAt: string;
  renamedOnce: boolean;
}

export const FREE_RENAME_COOLDOWN_MS = 30 * 24 * 60 * 60 * 1000;

export function normalizeUsername(value: string): string {
  return value.trim().normalize("NFKC");
}

export function usernameLength(value: string): number {
  return Array.from(normalizeUsername(value)).length;
}

export function nextFreeRenameAt(profile: Pick<Profile, "lastRenamedAt">): number {
  if (!profile.lastRenamedAt) return 0;
  const lastRename = Date.parse(profile.lastRenamedAt);
  return Number.isFinite(lastRename) ? lastRename + FREE_RENAME_COOLDOWN_MS : 0;
}

export function canRenameForFree(profile: Pick<Profile, "lastRenamedAt">, now = Date.now()): boolean {
  return now >= nextFreeRenameAt(profile);
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
