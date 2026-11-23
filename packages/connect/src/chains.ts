/**
 * EVM networks Terra Wallet supports today (the same list as the browser extension and the app), plus the
 * testnets Terra Pay test mode uses. `logo` is the key of the official network mark bundled by the UI packages.
 */
import type { Hex } from "./encoding.js";

export interface TerraChain {
  id: number;
  name: string;
  symbol: string;
  decimals: number;
  rpcUrls: readonly string[];
  explorerUrl?: string;
  /** Official network mark key (see @terrawallet/elements logos). */
  logo: string;
  testnet?: boolean;
}

const c = (id: number, name: string, symbol: string, rpc: string, explorerUrl: string, logo: string, testnet?: true): TerraChain => ({
  id,
  name,
  symbol,
  decimals: 18,
  rpcUrls: [rpc],
  explorerUrl,
  logo,
  ...(testnet ? { testnet } : {}),
});

export const TERRA_CHAINS: readonly TerraChain[] = [
  c(1, "Ethereum", "ETH", "https://ethereum-rpc.publicnode.com", "https://etherscan.io", "ethereum"),
  c(56, "BNB Smart Chain", "BNB", "https://bsc-dataseed.binance.org", "https://bscscan.com", "smartchain"),
  c(137, "Polygon", "POL", "https://polygon-bor-rpc.publicnode.com", "https://polygonscan.com", "polygon"),
  c(8453, "Base", "ETH", "https://mainnet.base.org", "https://basescan.org", "base"),
  c(42161, "Arbitrum", "ETH", "https://arb1.arbitrum.io/rpc", "https://arbiscan.io", "arbitrum"),
  c(10, "Optimism", "ETH", "https://mainnet.optimism.io", "https://optimistic.etherscan.io", "optimism"),
  c(43114, "Avalanche", "AVAX", "https://api.avax.network/ext/bc/C/rpc", "https://snowtrace.io", "avalanchec"),
  c(250, "Fantom", "FTM", "https://rpcapi.fantom.network", "https://explorer.fantom.network", "fantom"),
];

export const TERRA_TESTNETS: readonly TerraChain[] = [
  c(11155111, "Sepolia", "ETH", "https://ethereum-sepolia-rpc.publicnode.com", "https://sepolia.etherscan.io", "ethereum", true),
  c(84532, "Base Sepolia", "ETH", "https://sepolia.base.org", "https://sepolia.basescan.org", "base", true),
  c(80002, "Polygon Amoy", "POL", "https://rpc-amoy.polygon.technology", "https://amoy.polygonscan.com", "polygon", true),
];

const ALL = [...TERRA_CHAINS, ...TERRA_TESTNETS];

export const getChain = (id: number, list: readonly TerraChain[] = ALL): TerraChain | undefined => list.find((x) => x.id === id) ?? ALL.find((x) => x.id === id);

/**
 * The app's chain list: numbers pick from the built-in list, objects add custom networks. The first entry is the
 * default network. Defaults to every Terra Wallet mainnet.
 */
export function resolveChains(input?: readonly (number | TerraChain)[]): readonly TerraChain[] {
  if (!input || !input.length) return TERRA_CHAINS;
  const out: TerraChain[] = [];
  for (const item of input) {
    const chain = typeof item === "number" ? getChain(item) : item;
    if (!chain || !Number.isSafeInteger(chain.id) || chain.id <= 0) throw new TypeError(`Unknown chain: ${String(typeof item === "number" ? item : item?.id)}`);
    if (!out.some((x) => x.id === chain.id)) out.push(chain);
  }
  return out;
}

export const toHexChainId = (id: number): Hex => `0x${id.toString(16)}`;

/** Accepts "0x1", "1", 1 or a CAIP-2 "eip155:1". Returns null for anything else. */
export function parseChainId(v: unknown): number | null {
  if (typeof v === "number") return Number.isSafeInteger(v) && v > 0 ? v : null;
  if (typeof v !== "string") return null;
  const s = v.startsWith("eip155:") ? v.slice(7) : v;
  const n = /^0x[0-9a-f]+$/i.test(s) ? Number.parseInt(s, 16) : /^\d+$/.test(s) ? Number(s) : NaN;
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** wallet_addEthereumChain parameters for a network. */
export const addChainParams = (chain: TerraChain) => ({
  chainId: toHexChainId(chain.id),
  chainName: chain.name,
  nativeCurrency: { name: chain.symbol, symbol: chain.symbol, decimals: chain.decimals },
  rpcUrls: [...chain.rpcUrls],
  ...(chain.explorerUrl ? { blockExplorerUrls: [chain.explorerUrl] } : {}),
});
