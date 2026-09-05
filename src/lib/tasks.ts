import type { WalletRecords, TokenHolding } from "./blockscout";
import { fromRaw } from "./format";

const STABLES = new Set(["USDG", "USDC", "USDT", "DAI", "USDE", "FDUSD", "PYUSD", "TUSD"]);

// A rough "memecoin-ish" heuristic for Slice 1: a non-stable ERC-20 the wallet actually holds.
// (Real faction eligibility will use a curated CA registry later — this just demonstrates
// deriving tasks/eligibility from live wallet records.)
export function memeHoldings(r: WalletRecords): TokenHolding[] {
  return r.tokens.filter(
    (t) => t.type === "ERC-20" && !STABLES.has((t.symbol || "").toUpperCase())
  );
}

export interface Task {
  id: string;
  title: string;
  desc: string;
  reward: string;
  met: boolean;
  detail?: string;
}

export function buildTasks(r: WalletRecords): Task[] {
  const eth = fromRaw(r.coinBalanceRaw, 18);
  const memes = memeHoldings(r);
  const tasks: Task[] = [];

  tasks.push({
    id: "connect",
    title: "Establish a foothold",
    desc: "Connect a wallet on Robinhood Chain.",
    reward: "Starter cache",
    met: true,
  });

  tasks.push({
    id: "hold_eth",
    title: "Fuel reserves",
    desc: "Hold any ETH on Robinhood Chain.",
    reward: "+200 gems",
    met: eth > 0,
    detail: eth > 0 ? `holding ${eth.toFixed(4)} ETH` : "no ETH on this chain yet",
  });

  tasks.push({
    id: "hold_token",
    title: "Pledge a banner",
    desc: "Hold at least one memecoin — it decides your faction.",
    reward: "Faction unlock",
    met: memes.length > 0,
    detail: memes.length
      ? `eligible for: ${memes.slice(0, 4).map((t) => "$" + t.symbol).join(", ")}${memes.length > 4 ? "…" : ""}`
      : "hold a memecoin to pick a side",
  });

  tasks.push({
    id: "diversify",
    title: "Warlord of many houses",
    desc: "Hold 3+ different tokens.",
    reward: "+1 build slot",
    met: r.tokens.length >= 3,
    detail: `${r.tokens.length} token(s) held`,
  });

  tasks.push({
    id: "active",
    title: "Seasoned raider",
    desc: "Make 20+ transactions on-chain.",
    reward: "+500 gems",
    met: r.txCount >= 20,
    detail: `${r.txCount.toLocaleString()} tx`,
  });

  tasks.push({
    id: "veteran",
    title: "Chain veteran",
    desc: "100+ transactions — you know these roads.",
    reward: "Veteran title",
    met: r.txCount >= 100,
    detail: `${r.txCount.toLocaleString()} tx`,
  });

  tasks.push({
    id: "mover",
    title: "Token runner",
    desc: "Move tokens 5+ times.",
    reward: "Merchant perk",
    met: r.tokenTransferCount >= 5,
    detail: `${r.tokenTransferCount.toLocaleString()} token transfers`,
  });

  return tasks;
}
