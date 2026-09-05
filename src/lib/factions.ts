import type { TokenHolding } from "./blockscout";

export interface FactionRow {
  symbol: string;
  name: string;
  players: number;
  might: number;
  held: boolean;
  icon: string | null;
}

// SEED top-factions board (illustrative until we have a backend counting real players).
// Uses real Robinhood Chain meme tickers so it feels live. `name` is a placeholder tribe name.
const SEED: { symbol: string; name: string; players: number; might: number }[] = [
  { symbol: "FRONG", name: "Frogbound", players: 1284, might: 184600 },
  { symbol: "DUCKGO", name: "Duckdom", players: 962, might: 151200 },
  { symbol: "PIXELCAT", name: "Nine Lives", players: 733, might: 120700 },
  { symbol: "SAYLORMOON", name: "Moonguard", players: 588, might: 98400 },
  { symbol: "POOLS", name: "Poolsiders", players: 441, might: 70200 },
  { symbol: "4663.wtf", name: "The 4663", players: 377, might: 60900 },
];

export function topFactions(heldSymbols: Set<string>, iconBySymbol: Map<string, string | null>): FactionRow[] {
  return SEED.map((f) => ({
    ...f,
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
