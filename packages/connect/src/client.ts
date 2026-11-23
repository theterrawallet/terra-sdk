/**
 * The Terra Connect client: one object that finds Terra Wallet, connects (browser extension or the app's in-app
 * browser first, then WalletConnect with a QR code or an app deep link), keeps account and network state, and
 * exposes `request`, `switchChain`, `signMessage`, `sendTransaction` plus a stable EIP-1193 provider.
 *
 * Safe to create during server rendering: nothing touches `window` until a browser method runs.
 */
import { addChainParams, getChain, parseChainId, resolveChains, toHexChainId } from "./chains.js";
import { buildPairingDeepLink, detectPlatform, openAppLink } from "./deeplink.js";
import { discoverEip6963, discoverSolanaWallet, findLegacyInjected, type EIP1193Provider, type StandardWallet, type StandardWalletAccount } from "./discovery.js";
import { createEmitter } from "./emitter.js";
import { base58Encode, bytesToHex, isHex, stringifyJson, toQuantity, utf8ToHex, type Hex } from "./encoding.js";
import { TerraError, toProviderError, toTerraError } from "./errors.js";
import { assertPublishableKey } from "./keys.js";
import type { ConnectOptions, ConnectResult, ConnectorKind, SignableMessage, TerraConnect, TerraConnectOptions, TerraEvents, TerraState, TransactionRequest } from "./types.js";
import type { WcConnector } from "./walletconnect.js";

export const INITIAL_STATE: TerraState = Object.freeze({
  status: "disconnected",
  address: null,
  accounts: Object.freeze([]) as readonly Hex[],
  chainId: null,
  connector: null,
  solanaAddress: null,
  error: null,
  pairingUri: null,
});

const inBrowser = () => typeof window !== "undefined" && typeof document !== "undefined";

/**
 * Plain text for the WalletConnect metadata Terra Wallet shows when asking the user to approve: no control
 * characters and no bidirectional overrides (which can make one name render as another).
 */
const plainText = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").trim().slice(0, max);

/** An absolute URL with an allowed scheme and no credentials or whitespace, returned as given; otherwise throws. */
function checkedUrl(value: unknown, what: string, schemes: readonly string[]): string {
  let u: URL | null = null;
  if (typeof value === "string" && value.length <= 2048 && !/[\s\u0000-\u001f\u007f]/.test(value)) {
    try {
      u = new URL(value);
    } catch {
      u = null;
    }
  }
  if (!u || !schemes.includes(u.protocol) || u.username || u.password) {
    throw new TerraError("INVALID_PARAMS", `${what} must be an absolute ${schemes.map((x) => x.slice(0, -1)).join(" or ")} URL.`);
  }
  return value as string;
}

const asAccounts = (v: unknown): Hex[] => (Array.isArray(v) ? v.filter((a): a is Hex => typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a)) : []);

interface Active {
  kind: ConnectorKind;
  provider: EIP1193Provider;
  wc?: WcConnector;
  detach(): void;
}

export function createTerraConnect(options: TerraConnectOptions = {}): TerraConnect {
  if (options.publishableKey !== undefined) assertPublishableKey(options.publishableKey);
  // WalletConnect metadata is shown to the user by the wallet: only http(s) links and an https icon.
  if (options.appUrl !== undefined) checkedUrl(options.appUrl, "appUrl", ["https:", "http:"]);
  if (options.appIcon !== undefined) checkedUrl(options.appIcon, "appIcon", ["https:"]);
  const chains = resolveChains(options.chains);
  const storageKey = options.storageKey === undefined ? "terra-connect" : options.storageKey;
  const timeoutMs = options.discoveryTimeoutMs ?? 500;
  const platform = detectPlatform();
  const events = createEmitter<TerraEvents>();
  const eip1193 = createEmitter<Record<string, unknown>>();
  const listeners = new Set<(s: TerraState, p: TerraState) => void>();

  let state = INITIAL_STATE;
  let active: Active | null = null;
  let injected: EIP1193Provider | null = null;
  let wc: Promise<WcConnector> | null = null;
  let inflight: Promise<ConnectResult> | null = null;
  let pending: { cancel(): void } | null = null;
  let sol: { wallet: StandardWallet; account: StandardWalletAccount } | null = null;
  let destroyed = false;

  function setState(patch: Partial<TerraState>) {
    const prev = state;
    state = Object.freeze({ ...state, ...patch });
    for (const l of [...listeners]) {
      try {
        l(state, prev);
      } catch {
        /* isolate listeners */
      }
    }
  }

  const store = {
    read(): { c?: ConnectorKind } | null {
      try {
        return storageKey && inBrowser() ? JSON.parse(localStorage.getItem(storageKey) || "null") : null;
      } catch {
        return null;
      }
    },
    write(c: ConnectorKind | null) {
      try {
        if (!storageKey || !inBrowser()) return;
        if (c) localStorage.setItem(storageKey, JSON.stringify({ c }));
        else localStorage.removeItem(storageKey);
      } catch {
        /* storage blocked (private mode, sandboxed iframe) */
      }
    },
  };

  async function findInjected(): Promise<EIP1193Provider | null> {
    if (!inBrowser()) return null;
    if (injected) return injected;
    const found = (await discoverEip6963({ timeoutMs }))?.provider ?? findLegacyInjected(window);
    return (injected = found);
  }

  async function findSolana(): Promise<StandardWallet | null> {
    return inBrowser() ? (sol?.wallet ?? discoverSolanaWallet({ timeoutMs })) : null;
  }

  function loadWc(): Promise<WcConnector> {
    const projectId = options.walletConnectProjectId;
    if (!projectId) return Promise.reject(new TerraError("WALLETCONNECT_UNAVAILABLE"));
    if (!wc) {
      const appUrl = options.appUrl ?? (inBrowser() ? location.origin : "https://terrawallet.us");
      wc = import("./walletconnect.js").then((m) =>
        m.createWalletConnect({
          projectId,
          chains,
          platform,
          relayUrl: options.walletConnect?.relayUrl,
          loader: options.walletConnect?.loader,
          telemetry: options.walletConnect?.telemetry === true,
          metadata: {
            name: plainText(options.appName ?? (inBrowser() ? document.title : "") ?? "", 80) || new URL(appUrl).host,
            description: plainText(options.appDescription ?? "", 200),
            url: appUrl,
            icons: options.appIcon ? [options.appIcon] : [],
          },
        }),
      );
      wc.catch(() => (wc = null));
    }
    return wc;
  }

  function onAccounts(list: unknown) {
    const accounts = asAccounts(list);
    if (!accounts.length) return void dropConnection();
    setState({ accounts, address: accounts[0] ?? null });
    events.emit("accountsChanged", accounts);
    eip1193.emit("accountsChanged", accounts);
  }

  function onChain(hex: unknown) {
    const id = parseChainId(hex);
    if (!id || id === state.chainId) return;
    setState({ chainId: id });
    events.emit("chainChanged", id);
    eip1193.emit("chainChanged", toHexChainId(id));
  }

  function attach(kind: ConnectorKind, provider: EIP1193Provider, connector?: WcConnector) {
    active?.detach();
    const onDisconnect = () => dropConnection();
    provider.on?.("accountsChanged", onAccounts);
    provider.on?.("chainChanged", onChain);
    provider.on?.("disconnect", onDisconnect);
    active = {
      kind,
      provider,
      wc: connector,
      detach() {
        provider.removeListener?.("accountsChanged", onAccounts);
        provider.removeListener?.("chainChanged", onChain);
        provider.removeListener?.("disconnect", onDisconnect);
      },
    };
  }

  function connected(kind: ConnectorKind, accounts: Hex[], chainId: number, solanaAddress?: string | null): ConnectResult {
    setState({
      status: "connected",
      accounts,
      address: accounts[0] ?? null,
      chainId,
      connector: kind,
      error: null,
      pairingUri: null,
      ...(solanaAddress ? { solanaAddress } : {}),
    });
    store.write(kind);
    const result: ConnectResult = { address: accounts[0]!, chainId, connector: kind };
    events.emit("connect", result);
    eip1193.emit("connect", { chainId: toHexChainId(chainId) });
    return result;
  }

  /** The wallet ended the connection (revoked, account removed, WalletConnect session deleted). */
  function dropConnection() {
    if (!active && state.status === "disconnected") return;
    active?.detach();
    active = null;
    store.write(null);
    setState({ ...INITIAL_STATE, solanaAddress: sol ? state.solanaAddress : null });
    events.emit("disconnect", undefined);
    eip1193.emit("disconnect", new TerraError("DISCONNECTED"));
  }

  async function connectInjected(provider: EIP1193Provider, want?: number): Promise<ConnectResult> {
    const accounts = asAccounts(await provider.request({ method: "eth_requestAccounts" }));
    if (!accounts.length) throw new TerraError("UNAUTHORIZED", "Terra Wallet did not share an account.");
    const chainId = parseChainId(await provider.request({ method: "eth_chainId" })) ?? chains[0]!.id;
    attach("injected", provider);
    const result = connected("injected", accounts, chainId);
    if (want && want !== chainId) {
      result.chainId = await switchChain(want).catch(() => chainId);
    }
    return result;
  }

  async function connectWalletConnect(want?: number): Promise<ConnectResult> {
    const connector = await loadWc();
    const out = await connector.pair({
      chainId: want,
      onUri(uri) {
        setState({ pairingUri: uri });
        events.emit("display_uri", uri);
        if (platform !== "desktop" && options.deepLink !== "manual") openAppLink(buildPairingDeepLink(uri, { platform }));
      },
    });
    attach("walletconnect", connector.provider, connector);
    return connected("walletconnect", out.accounts, out.chainId, out.solana);
  }

  function connect(opts: ConnectOptions = {}): Promise<ConnectResult> {
    if (destroyed) return Promise.reject(new TerraError("DISCONNECTED", "This client was destroyed."));
    if (!inBrowser()) return Promise.reject(new TerraError("UNSUPPORTED_ENVIRONMENT", "connect() needs a browser."));
    if (state.status === "connected" && active && state.address && state.chainId) {
      const done: ConnectResult = { address: state.address, chainId: state.chainId, connector: active.kind };
      return opts.chainId && opts.chainId !== state.chainId ? switchChain(opts.chainId).then((chainId) => ({ ...done, chainId })) : Promise.resolve(done);
    }
    if (inflight) return inflight;
    const method = opts.method ?? "auto";
    setState({ status: "connecting", error: null, pairingUri: null });
    let cancelled = false;
    const run = new Promise<ConnectResult>((resolve, reject) => {
      pending = {
        cancel() {
          cancelled = true;
          reject(new TerraError("USER_REJECTED", "The connection was cancelled."));
        },
      };
      (async () => {
        const provider = method === "walletconnect" ? null : await findInjected();
        if (cancelled) return;
        if (provider) return connectInjected(provider, opts.chainId);
        if (method === "injected") throw new TerraError("NOT_INSTALLED");
        return connectWalletConnect(opts.chainId);
      })().then(
        (r) => {
          if (cancelled && r) void disconnect();
          else if (r) resolve(r);
        },
        reject,
      );
    });
    inflight = run
      .catch((e: unknown) => {
        const err = toTerraError(e);
        if (state.status !== "connected") setState({ status: "disconnected", pairingUri: null, error: err });
        events.emit("error", err);
        throw err;
      })
      .finally(() => {
        inflight = null;
        pending = null;
      });
    return inflight;
  }

  function cancel() {
    if (!pending) return;
    void wc?.then((c) => c.abort()).catch(() => {});
    pending.cancel();
  }

  async function disconnect() {
    const a = active;
    active = null;
    a?.detach();
    store.write(null);
    if (a?.kind === "walletconnect") await a.wc?.disconnect();
    else if (a) await a.provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }).catch(() => {});
    if (sol) {
      await Promise.resolve(sol.wallet.features["standard:disconnect"]?.disconnect?.()).catch(() => {});
      sol = null;
    }
    const was = state.status;
    setState(INITIAL_STATE);
    if (was !== "disconnected") {
      events.emit("disconnect", undefined);
      eip1193.emit("disconnect", new TerraError("DISCONNECTED"));
    }
  }

  async function reconnect(): Promise<boolean> {
    if (!inBrowser() || destroyed) return false;
    if (state.status === "connected") return true;
    if (inflight) return inflight.then(() => true, () => false);
    const saved = store.read();
    if (saved?.c !== "injected" && saved?.c !== "walletconnect") return false;
    setState({ status: "reconnecting", error: null });
    try {
      if (saved.c === "injected") {
        const provider = await findInjected();
        const accounts = provider ? asAccounts(await provider.request({ method: "eth_accounts" })) : [];
        if (provider && accounts.length) {
          const chainId = parseChainId(await provider.request({ method: "eth_chainId" })) ?? chains[0]!.id;
          attach("injected", provider);
          connected("injected", accounts, chainId);
          return true;
        }
      } else if (options.walletConnectProjectId) {
        const connector = await loadWc();
        const out = await connector.restore();
        if (out?.accounts.length) {
          attach("walletconnect", connector.provider, connector);
          connected("walletconnect", out.accounts, out.chainId, out.solana);
          return true;
        }
      }
    } catch {
      /* fall through: stay disconnected, never prompt */
    }
    if (state.status === "reconnecting") setState({ status: "disconnected" });
    store.write(null);
    return false;
  }

  function requireActive(): Active {
    if (!active || state.status !== "connected") throw new TerraError("NOT_CONNECTED");
    return active;
  }

  async function request<T = unknown>(args: { method: string; params?: readonly unknown[] | object }): Promise<T> {
    const a = requireActive();
    try {
      return (await a.provider.request(args)) as T;
    } catch (e) {
      throw toTerraError(e);
    }
  }

  async function switchChain(chainId: number): Promise<number> {
    const a = requireActive();
    if (state.chainId === chainId) return chainId;
    const hex = toHexChainId(chainId);
    try {
      await a.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hex }] });
    } catch (e) {
      const err = toTerraError(e);
      const chain = getChain(chainId, chains);
      if (err.code !== "UNRECOGNIZED_CHAIN" || !chain || a.kind !== "injected") throw err;
      try {
        await a.provider.request({ method: "wallet_addEthereumChain", params: [addChainParams(chain)] });
      } catch (e2) {
        throw toTerraError(e2);
      }
    }
    const now = parseChainId(await a.provider.request({ method: "eth_chainId" }).catch(() => hex)) ?? chainId;
    onChain(toHexChainId(now));
    return now;
  }

  async function signMessage(message: SignableMessage): Promise<Hex> {
    requireActive();
    const data = typeof message === "string" ? utf8ToHex(message) : message instanceof Uint8Array ? bytesToHex(message) : message?.raw;
    if (!isHex(data)) throw new TerraError("INVALID_PARAMS", "signMessage expects text, bytes, or { raw: \"0x...\" }.");
    return request<Hex>({ method: "personal_sign", params: [data, state.address] });
  }

  async function signTypedData(typedData: object): Promise<Hex> {
    requireActive();
    return request<Hex>({ method: "eth_signTypedData_v4", params: [state.address, stringifyJson(typedData)] });
  }

  async function sendTransaction(tx: TransactionRequest): Promise<Hex> {
    requireActive();
    if (tx.chainId && tx.chainId !== state.chainId) await switchChain(tx.chainId);
    const out: Record<string, string> = { from: tx.from ?? state.address! };
    if (tx.to) out.to = tx.to;
    if (tx.data) out.data = tx.data;
    for (const k of ["value", "gas", "gasPrice", "maxFeePerGas", "maxPriorityFeePerGas", "nonce"] as const) {
      const v = tx[k];
      if (v !== undefined && v !== null) out[k] = toQuantity(v);
    }
    return request<Hex>({ method: "eth_sendTransaction", params: [out] });
  }

  const provider = {
    request(args: { method: string; params?: readonly unknown[] | object }): Promise<unknown> {
      let run: Promise<unknown>;
      if (active && state.status === "connected") run = request(args);
      else if (args.method === "eth_accounts") run = Promise.resolve([]);
      else if (args.method === "eth_chainId") run = Promise.resolve(toHexChainId(chains[0]!.id));
      else if (args.method === "eth_requestAccounts") run = connect().then((r) => [r.address]);
      else run = Promise.reject(new TerraError("DISCONNECTED"));
      return run.catch((e: unknown) => {
        throw toProviderError(e);
      });
    },
    on(event: string, cb: (...a: any[]) => void) {
      eip1193.on(event, cb);
      return provider;
    },
    removeListener(event: string, cb: (...a: any[]) => void) {
      eip1193.off(event, cb);
      return provider;
    },
  };

  const solana = {
    get address() {
      return state.solanaAddress;
    },
    async connect(): Promise<string> {
      const wallet = await findSolana();
      if (wallet) {
        const res = await wallet.features["standard:connect"].connect();
        const account: StandardWalletAccount | undefined = res?.accounts?.[0] ?? wallet.accounts[0];
        if (!account) throw new TerraError("UNAUTHORIZED", "Terra Wallet did not share a Solana account.");
        sol = { wallet, account };
        setState({ solanaAddress: account.address });
        return account.address;
      }
      if (active?.kind === "walletconnect" && state.solanaAddress) return state.solanaAddress;
      throw new TerraError("NOT_INSTALLED", "Terra Wallet for Solana was not found. Connect with the Terra Wallet app or install the extension.");
    },
    async disconnect() {
      if (sol) await Promise.resolve(sol.wallet.features["standard:disconnect"]?.disconnect?.()).catch(() => {});
      sol = null;
      setState({ solanaAddress: null });
    },
    async signMessage(message: string | Uint8Array): Promise<Uint8Array> {
      const bytes = typeof message === "string" ? new TextEncoder().encode(message) : message;
      try {
        if (sol) {
          const [out] = await sol.wallet.features["solana:signMessage"].signMessage({ account: sol.account, message: bytes });
          return out.signature as Uint8Array;
        }
        return await requireSolWc().solana.signMessage(state.solanaAddress!, bytes);
      } catch (e) {
        throw toTerraError(e);
      }
    },
    async signTransaction(transaction: Uint8Array): Promise<Uint8Array> {
      try {
        if (sol) {
          const [out] = await sol.wallet.features["solana:signTransaction"].signTransaction({ account: sol.account, transaction, chain: "solana:mainnet" });
          return out.signedTransaction as Uint8Array;
        }
        return await requireSolWc().solana.signTransaction(transaction);
      } catch (e) {
        throw toTerraError(e);
      }
    },
    async signAndSendTransaction(transaction: Uint8Array): Promise<string> {
      try {
        if (sol) {
          const [out] = await sol.wallet.features["solana:signAndSendTransaction"].signAndSendTransaction({ account: sol.account, transaction, chain: "solana:mainnet" });
          return base58Encode(out.signature as Uint8Array);
        }
        return await requireSolWc().solana.signAndSendTransaction(transaction);
      } catch (e) {
        throw toTerraError(e);
      }
    },
  };

  function requireSolWc(): WcConnector {
    if (active?.kind === "walletconnect" && active.wc && state.solanaAddress) return active.wc;
    throw new TerraError("NOT_CONNECTED", "Connect Terra Wallet for Solana first (solana.connect()).");
  }

  const client: TerraConnect = {
    chains,
    options: Object.freeze({ ...options }),
    platform,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    on: (event, cb) => events.on(event, cb),
    async detect() {
      const [p, s] = await Promise.all([findInjected(), findSolana()]);
      return { injected: !!p, solana: !!s, platform, walletConnect: !!options.walletConnectProjectId };
    },
    connect,
    cancel,
    disconnect,
    reconnect,
    request,
    switchChain,
    signMessage,
    signTypedData,
    sendTransaction,
    getProvider: () => provider,
    solana,
    destroy() {
      destroyed = true;
      cancel();
      active?.detach();
      active = null;
      listeners.clear();
      events.clear();
      eip1193.clear();
    },
  };

  if (options.autoReconnect !== false && inBrowser()) queueMicrotask(() => void reconnect());
  return client;
}
