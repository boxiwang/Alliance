import type { TokenHolding } from "./blockscout";

export interface FactionRow {
  symbol: string;
  name: string | null;
  players: number;
  might: number;
  held: boolean;
  icon: string | null;
}

// Illustrative player counts only. Names and tickers must stay token identities;
// never invent a separate alliance alias for a memecoin.
const SEED: { symbol: string; name: null; players: number; might: number }[] = [
  { symbol: "FRONG", name: null, players: 1284, might: 184600 },
  { symbol: "DUCKGO", name: null, players: 962, might: 151200 },
  { symbol: "PIXELCAT", name: null, players: 733, might: 120700 },
  { symbol: "SAYLORMOON", name: null, players: 588, might: 98400 },
  { symbol: "POOLS", name: null, players: 441, might: 70200 },
  { symbol: "4663.wtf", name: null, players: 377, might: 60900 },
];

export function topFactions(heldSymbols: Set<string>, iconBySymbol: Map<string, string | null>, nameBySymbol = new Map<string, string>()): FactionRow[] {
  return SEED.map((f) => ({
    ...f,
    name: nameBySymbol.get(f.symbol.toUpperCase())?.trim() || null,
    held: heldSymbols.has(f.symbol.toUpperCase()),
    icon: iconBySymbol.get(f.symbol.toUpperCase()) || null,
  })).sort((a, b) => b.players - a.players);
}

// Pledgeable factions = the memecoins THIS wallet actually holds.
export function pledgeableFrom(memes: TokenHolding[]) {
  return memes.map((t) => ({
    ca: t.address,
    symbol: t.symbol,
    name: t.name,
    icon: t.iconUrl,
  }));
}
