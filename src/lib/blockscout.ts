// Read-only reads from Robinhood Chain's Blockscout, via the Vite dev proxy (/bs).
const BASE = "/bs/api/v2";

async function bs(path: string): Promise<any> {
  const r = await fetch(`${BASE}${path}`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`Blockscout ${r.status} on ${path}`);
  return r.json();
}

export interface TokenHolding {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  raw: string;
  type: string;
  exchangeRate: number | null;
  marketCap: number | null;
  iconUrl: string | null;
  reputation: string | null;
}

export interface WalletRecords {
  address: string;
  coinBalanceRaw: string; // wei
  ethPrice: number | null;
  isContract: boolean;
  txCount: number;
  tokenTransferCount: number;
  tokens: TokenHolding[];
  recentTxs: { hash: string; ts: string; to: string; from: string; method: string | null }[];
  oldestSeen: string | null; // best-effort wallet-age signal
}

export async function readWallet(address: string): Promise<WalletRecords> {
  const a = address.toLowerCase();

  const [info, counters, tokenRes, txRes] = await Promise.all([
    bs(`/addresses/${a}`).catch(() => ({})),
    bs(`/addresses/${a}/counters`).catch(() => ({})),
    bs(`/addresses/${a}/token-balances`).catch(() => []),
    bs(`/addresses/${a}/transactions?filter=to%20%7C%20from`).catch(() => ({ items: [] })),
  ]);

  const tokens: TokenHolding[] = (Array.isArray(tokenRes) ? tokenRes : [])
    .map((t: any) => ({
      address: t?.token?.address_hash || t?.token?.address || "",
      name: t?.token?.name || "Unknown",
      symbol: t?.token?.symbol || "?",
      decimals: parseInt(t?.token?.decimals ?? "18", 10) || 0,
      raw: String(t?.value ?? "0"),
      type: t?.token?.type || "ERC-20",
      exchangeRate: t?.token?.exchange_rate ? Number(t.token.exchange_rate) : null,
      marketCap: t?.token?.circulating_market_cap ? Number(t.token.circulating_market_cap) : null,
      iconUrl: t?.token?.icon_url || null,
      reputation: t?.token?.reputation || null,
    }))
    .filter((t: TokenHolding) => t.raw !== "0");

  const items = Array.isArray(txRes?.items) ? txRes.items : [];
  const recentTxs = items.slice(0, 8).map((tx: any) => ({
    hash: tx?.hash || "",
    ts: tx?.timestamp || "",
    to: tx?.to?.hash || "",
    from: tx?.from?.hash || "",
    method: tx?.method || null,
  }));
  const oldestSeen = items.length ? items[items.length - 1]?.timestamp || null : null;

  return {
    address,
    coinBalanceRaw: String(info?.coin_balance ?? "0"),
    ethPrice: info?.exchange_rate ? Number(info.exchange_rate) : null,
    isContract: !!info?.is_contract,
    txCount: parseInt(counters?.transactions_count ?? "0", 10) || 0,
    tokenTransferCount: parseInt(counters?.token_transfers_count ?? "0", 10) || 0,
    tokens,
    recentTxs,
    oldestSeen,
  };
}
