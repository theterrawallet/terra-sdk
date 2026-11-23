/**
 * Finding Terra Wallet in the page, using only open standards:
 * - EVM: EIP-6963 (`eip6963:requestProvider` / `eip6963:announceProvider`), matched on Terra Wallet's rdns.
 *   Both the browser extension and the in-app browser of the mobile app announce `com.terrawallet.app`.
 * - Solana: the Wallet Standard app-side handshake (`wallet-standard:app-ready` / `wallet-standard:register-wallet`).
 * - Legacy fallback: `window.ethereum.isTerraWallet` (or an entry of `window.ethereum.providers`).
 */

export const TERRA_RDNS = "com.terrawallet.app";
export const TERRA_WALLET_NAME = "Terra Wallet";

export interface RequestArguments {
  readonly method: string;
  readonly params?: readonly unknown[] | object;
}

export interface EIP1193Provider {
  request(args: RequestArguments): Promise<unknown>;
  on?(event: string, listener: (...args: any[]) => void): unknown;
  removeListener?(event: string, listener: (...args: any[]) => void): unknown;
}

export interface EIP6963ProviderInfo {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
}

export interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: EIP1193Provider;
}

/** The subset of a Wallet Standard wallet the SDK uses. */
export interface StandardWalletAccount {
  readonly address: string;
  readonly publicKey: Uint8Array;
  readonly chains: readonly string[];
  readonly features: readonly string[];
}

export interface StandardWallet {
  readonly name: string;
  readonly icon: string;
  readonly chains: readonly string[];
  readonly accounts: readonly StandardWalletAccount[];
  readonly features: Readonly<Record<string, any>>;
}

type EventTargetLike = Pick<EventTarget, "addEventListener" | "removeEventListener" | "dispatchEvent">;

function defaultTarget(): EventTargetLike | null {
  return typeof window !== "undefined" && typeof window.addEventListener === "function" ? window : null;
}

function isTerraDetail(d: unknown, rdns: string): d is EIP6963ProviderDetail {
  if (!d || typeof d !== "object") return false;
  const { info, provider } = d as Partial<EIP6963ProviderDetail>;
  return !!info && typeof info === "object" && info.rdns === rdns && !!provider && typeof provider.request === "function";
}

/**
 * Calls `onFound` for every Terra Wallet EIP-6963 announcement (now and later). Returns an unsubscribe function.
 * Announcements are deduplicated by provider object.
 */
export function watchEip6963(onFound: (detail: EIP6963ProviderDetail) => void, opts: { target?: EventTargetLike; rdns?: string } = {}): () => void {
  const target = opts.target ?? defaultTarget();
  if (!target) return () => {};
  const rdns = opts.rdns ?? TERRA_RDNS;
  const seen = new WeakSet<object>();
  const onAnnounce = (ev: Event) => {
    const detail = (ev as CustomEvent).detail;
    if (!isTerraDetail(detail, rdns) || seen.has(detail.provider)) return;
    seen.add(detail.provider);
    onFound(detail);
  };
  target.addEventListener("eip6963:announceProvider", onAnnounce);
  target.dispatchEvent(new Event("eip6963:requestProvider"));
  return () => target.removeEventListener("eip6963:announceProvider", onAnnounce);
}

/** Resolves with Terra Wallet's EIP-6963 provider, or null when none announced itself within `timeoutMs`. */
export function discoverEip6963(opts: { target?: EventTargetLike; rdns?: string; timeoutMs?: number } = {}): Promise<EIP6963ProviderDetail | null> {
  return new Promise((resolve) => {
    let done = false;
    let stop: () => void = () => {};
    const finish = (d: EIP6963ProviderDetail | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      stop();
      resolve(d);
    };
    const timer = setTimeout(() => finish(null), opts.timeoutMs ?? 500);
    stop = watchEip6963(finish, opts);
    if (done) stop();
  });
}

/** Legacy injection: `window.ethereum` (or one of `window.ethereum.providers`) that says it is Terra Wallet. */
export function findLegacyInjected(win: unknown = typeof window !== "undefined" ? window : undefined): EIP1193Provider | null {
  const eth = (win as { ethereum?: unknown } | undefined)?.ethereum as (EIP1193Provider & { isTerraWallet?: boolean; providers?: unknown[] }) | undefined;
  if (!eth || typeof eth !== "object") return null;
  const list = Array.isArray(eth.providers) ? eth.providers : [eth];
  for (const p of list) {
    const cand = p as EIP1193Provider & { isTerraWallet?: boolean };
    if (cand && cand.isTerraWallet === true && typeof cand.request === "function") return cand;
  }
  return null;
}

const isTerraSolana = (w: unknown): w is StandardWallet => {
  const x = w as Partial<StandardWallet> | null;
  return (
    !!x &&
    typeof x === "object" &&
    x.name === TERRA_WALLET_NAME &&
    Array.isArray(x.chains) &&
    x.chains.some((ch) => typeof ch === "string" && ch.startsWith("solana:")) &&
    !!x.features &&
    typeof x.features["standard:connect"]?.connect === "function"
  );
};

/** Wallet Standard (Solana): resolves with Terra Wallet's registered wallet, or null after `timeoutMs`. */
export function discoverSolanaWallet(opts: { target?: EventTargetLike; timeoutMs?: number } = {}): Promise<StandardWallet | null> {
  const target = opts.target ?? defaultTarget();
  if (!target) return Promise.resolve(null);
  return new Promise((resolve) => {
    let done = false;
    const finish = (w: StandardWallet | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      target.removeEventListener("wallet-standard:register-wallet", onRegister);
      resolve(w);
    };
    const api = Object.freeze({
      register(...wallets: unknown[]) {
        for (const w of wallets) if (isTerraSolana(w)) finish(w);
        return () => {};
      },
    });
    const onRegister = (ev: Event) => {
      const cb = (ev as CustomEvent).detail;
      if (typeof cb !== "function") return;
      try {
        cb(api);
      } catch {
        /* a misbehaving wallet: ignore */
      }
    };
    const timer = setTimeout(() => finish(null), opts.timeoutMs ?? 500);
    target.addEventListener("wallet-standard:register-wallet", onRegister);
    try {
      target.dispatchEvent(new CustomEvent("wallet-standard:app-ready", { detail: api }));
    } catch {
      /* CustomEvent missing (very old environments): wallets that register later still reach onRegister */
    }
  });
}
