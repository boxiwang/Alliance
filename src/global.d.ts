export {};

export interface Eip1193Provider {
  request: (args: { method: string; params?: any[] | object }) => Promise<any>;
  on?: (event: string, handler: (...args: any[]) => void) => void;
  removeListener?: (event: string, handler: (...args: any[]) => void) => void;
  isMetaMask?: boolean;
  isCoinbaseWallet?: boolean;
  isOkxWallet?: boolean;
  isPhantom?: boolean;
}

export interface Eip6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string; // data URI
  rdns: string;
}
export interface Eip6963ProviderDetail {
  info: Eip6963ProviderInfo;
  provider: Eip1193Provider;
}

declare global {
  interface Window {
    ethereum?: Eip1193Provider & { providers?: Eip1193Provider[] };
    phantom?: { ethereum?: Eip1193Provider };
    okxwallet?: Eip1193Provider;
    coinbaseWalletExtension?: Eip1193Provider;
  }
  interface WindowEventMap {
    "eip6963:announceProvider": CustomEvent<Eip6963ProviderDetail>;
  }
}
