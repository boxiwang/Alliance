// Per-wallet player profile. MVP persistence = localStorage (swap to D1 later).
export interface Profile {
  address: string;
  name: string;
  faction: string | null; // token contract address (CA), or null = solo
  factionSymbol: string | null;
  keepLevel: number;
  createdAt: string;
  renamedOnce: boolean;
}

const KEY = (a: string) => `ruglands:profile:${a.toLowerCase()}`;

export function loadProfile(a: string): Profile | null {
  try {
    const s = localStorage.getItem(KEY(a));
    return s ? (JSON.parse(s) as Profile) : null;
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
