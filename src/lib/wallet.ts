// Multi-wallet connect for Robinhood Chain. READ-ONLY app:
// we only ask for account access + one signature. NEVER a fund-moving transaction.
import type { Eip1193Provider, Eip6963ProviderDetail } from "../global";

export const RH_MAINNET = {
  chainIdHex: "0x1237", // 4663
  chainIdDec: 4663,
  params: {
    chainId: "0x1237",
    chainName: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
    blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
  },
};

// The wallets we explicitly feature. We match EIP-6963 announcements by rdns/name,
// and fall back to legacy window globals so they show up even without 6963.
export interface FeaturedWallet {
  key: string;
  name: string;
  emoji: string;
  color: string;
  rdns: string[];
  nameMatch: string;
  install: string;
  legacy: () => Eip1193Provider | null | undefined;
}

export const FEATURED: FeaturedWallet[] = [
  {
    key: "metamask", name: "MetaMask", emoji: "🦊", color: "#f6851b",
    rdns: ["io.metamask", "io.metamask.mobile"], nameMatch: "metamask",
    install: "https://metamask.io/download/",
    legacy: () => (window.ethereum?.isMetaMask ? window.ethereum : null),
  },
  {
    key: "phantom", name: "Phantom", emoji: "👻", color: "#ab9ff2",
    rdns: ["app.phantom"], nameMatch: "phantom",
    install: "https://phantom.app/download",
    legacy: () => window.phantom?.ethereum || null,
  },
  {
    key: "okx", name: "OKX Wallet", emoji: "⭕", color: "#111111",
    rdns: ["com.okex.wallet"], nameMatch: "okx",
    install: "https://www.okx.com/web3",
    legacy: () => window.okxwallet || null,
  },
  {
    key: "coinbase", name: "Coinbase Wallet", emoji: "🔵", color: "#0052ff",
    rdns: ["com.coinbase.wallet"], nameMatch: "coinbase",
    install: "https://www.coinbase.com/wallet/downloads",
    legacy: () =>
      window.coinbaseWalletExtension ||
      (window.ethereum?.isCoinbaseWallet ? window.ethereum : null),
  },
  {
    key: "uniswap", name: "Uniswap Wallet", emoji: "🦄", color: "#ff007a",
    rdns: ["org.uniswap.app", "com.uniswap.wallet", "org.uniswap.walletextension"],
    nameMatch: "uniswap",
    install: "https://wallet.uniswap.org/",
    legacy: () => null,
  },
];

// ---- EIP-6963 discovery ----
export function subscribeProviders(
  onUpdate: (list: Eip6963ProviderDetail[]) => void
): () => void {
  const found = new Map<string, Eip6963ProviderDetail>();
  const handler = (e: CustomEvent<Eip6963ProviderDetail>) => {
    const d = e.detail;
    if (d?.info?.rdns) {
      found.set(d.info.rdns, d);
      onUpdate([...found.values()]);
    }
  };
  window.addEventListener("eip6963:announceProvider", handler as EventListener);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  return () => window.removeEventListener("eip6963:announceProvider", handler as EventListener);
}

export interface WalletButton {
  key: string;
  name: string;
  emoji: string;
  color: string;
  icon: string | null; // data URI from 6963 if present
  provider: Eip1193Provider | null; // null => not installed, show install link
  install: string;
  detected: boolean;
}

// Merge the featured list with whatever 6963 announced (+ legacy globals) + any extra wallets.
export function resolveWallets(detected: Eip6963ProviderDetail[]): WalletButton[] {
  const used = new Set<string>();
  const featured: WalletButton[] = FEATURED.map((f) => {
    let match = detected.find(
      (d) =>
        f.rdns.includes(d.info.rdns) ||
        d.info.name.toLowerCase().includes(f.nameMatch)
    );
    if (match) used.add(match.info.rdns);
    const provider = match?.provider || f.legacy() || null;
    return {
      key: f.key, name: f.name, emoji: f.emoji, color: f.color,
      icon: match?.info.icon || null,
      provider, install: f.install, detected: !!provider,
    };
  });

  // Any other discovered wallet not already featured.
  const extras: WalletButton[] = detected
    .filter((d) => !used.has(d.info.rdns))
    .map((d) => ({
      key: d.info.rdns, name: d.info.name, emoji: "🔌", color: "#6a7a9a",
      icon: d.info.icon, provider: d.provider, install: "", detected: true,
    }));

  return [...featured, ...extras];
}

// ---- connect / chain / sign, all on a chosen provider ----
export async function connect(
  provider: Eip1193Provider
): Promise<{ address: string; chainOk: boolean }> {
  if (!provider) throw new Error("Wallet not installed.");
  const accounts: string[] = await provider.request({ method: "eth_requestAccounts" });
  const address = accounts?.[0];
  if (!address) throw new Error("No account returned.");

  let chainOk = false;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: RH_MAINNET.chainIdHex }],
    });
    chainOk = true;
  } catch (e: any) {
    if (e?.code === 4902 || String(e?.message || "").toLowerCase().includes("unrecognized")) {
      try {
        await provider.request({ method: "wallet_addEthereumChain", params: [RH_MAINNET.params] });
        chainOk = true;
      } catch {
        chainOk = false;
      }
    }
  }
  return { address, chainOk };
}

export async function signIn(provider: Eip1193Provider, address: string): Promise<string> {
  const nonce = Math.random().toString(36).slice(2, 10);
  const message =
    `RUGLANDS wants to verify you own this wallet.\n\n` +
    `Address: ${address}\n` +
    `Chain: Robinhood Chain (4663)\n` +
    `Nonce: ${nonce}\n` +
    `Issued: ${new Date().toISOString()}\n\n` +
    `(Read-only. This signature moves no funds.)`;
  return provider.request({ method: "personal_sign", params: [message, address] });
}
