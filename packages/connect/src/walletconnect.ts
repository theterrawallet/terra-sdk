/**
 * WalletConnect v2 connector, built on the minimal official sign client (no AppKit, no modal: the SDK draws its
 * own QR code). This module is only ever loaded with a dynamic import, the first time the fallback is needed, so
 * neither it nor WalletConnect weighs on the core bundle.
 */
import { addChainParams, parseChainId, toHexChainId, type TerraChain } from "./chains.js";
import { buildWakeDeepLink, openAppLink, type Platform } from "./deeplink.js";
import type { EIP1193Provider, RequestArguments } from "./discovery.js";
import { createEmitter } from "./emitter.js";
import { base58Decode, base58Encode, base64ToBytes, bytesToBase64, type Hex } from "./encoding.js";
import { TerraError, toTerraError } from "./errors.js";
import type { WalletConnectLoader, WcSession, WcSignClient, WcSignClientStatic } from "./wc-types.js";

export const SOLANA_MAINNET = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

/** Methods that need the wallet. Everything else (reads) goes straight to the network's public RPC. */
const EVM_WALLET_METHODS = [
  "eth_sendTransaction",
  "personal_sign",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_signTypedData_v4",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
];
const SOLANA_METHODS = ["solana_signMessage", "solana_signTransaction", "solana_signAndSendTransaction"];

export interface WcConfig {
  projectId: string;
  metadata: { name: string; description: string; url: string; icons: string[] };
  chains: readonly TerraChain[];
  platform: Platform;
  relayUrl?: string;
  loader?: WalletConnectLoader;
  /** WalletConnect usage telemetry. Default false. */
  telemetry?: boolean;
}

export interface WcAccounts {
  accounts: Hex[];
  chainId: number;
  solana: string | null;
}

export interface WcConnector {
  readonly provider: EIP1193Provider;
  pair(opts: { chainId?: number; onUri(uri: string): void }): Promise<WcAccounts>;
  restore(): Promise<WcAccounts | null>;
  disconnect(): Promise<void>;
  /** Abandons a pairing in progress: if the wallet approves later, that session is closed right away. */
  abort(): void;
  solana: {
    signMessage(address: string, message: Uint8Array): Promise<Uint8Array>;
    signTransaction(tx: Uint8Array): Promise<Uint8Array>;
    signAndSendTransaction(tx: Uint8Array): Promise<string>;
  };
}

const clients = new Map<string, Promise<WcSignClient>>();

const defaultLoader: WalletConnectLoader = () => import("@walletconnect/sign-client") as unknown as ReturnType<WalletConnectLoader>;

function getClient(cfg: WcConfig): Promise<WcSignClient> {
  const key = `${cfg.projectId}|${cfg.relayUrl ?? ""}`;
  let p = clients.get(key);
  if (!p) {
    p = (async () => {
      const mod = await (cfg.loader ?? defaultLoader)();
      const def = mod.default as (WcSignClientStatic & { SignClient?: WcSignClientStatic }) | undefined;
      const Static = mod.SignClient ?? def?.SignClient ?? def;
      if (!Static || typeof Static.init !== "function") throw new TerraError("WALLETCONNECT_UNAVAILABLE", "The WalletConnect sign client could not be loaded.");
      return Static.init({
        projectId: cfg.projectId,
        metadata: cfg.metadata,
        customStoragePrefix: "terra-sdk",
        telemetryEnabled: cfg.telemetry === true,
        ...(cfg.relayUrl ? { relayUrl: cfg.relayUrl } : {}),
      });
    })();
    p.catch(() => clients.delete(key));
    clients.set(key, p);
  }
  return p;
}

const accountOf = (caip: string) => caip.split(":")[2] ?? "";

async function rpcCall(chain: TerraChain | undefined, method: string, params: unknown): Promise<unknown> {
  const url = chain?.rpcUrls[0];
  if (!url) throw new TerraError("UNSUPPORTED_METHOD", `No public RPC is configured for this network, so ${method} cannot be answered.`);
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params: params ?? [] }),
  });
  const body = (await res.json().catch(() => null)) as { result?: unknown; error?: { code?: number; message?: string } } | null;
  if (!res.ok || !body) throw new TerraError("INTERNAL", `RPC request failed (${res.status}).`);
  if (body.error) throw toTerraError(body.error);
  return body.result;
}

export async function createWalletConnect(cfg: WcConfig): Promise<WcConnector> {
  if (!/^[0-9a-f]{32}$/i.test(cfg.projectId)) throw new TerraError("WALLETCONNECT_UNAVAILABLE", "The WalletConnect project id looks invalid.");
  const client = await getClient(cfg);
  const events = createEmitter<{ accountsChanged: string[]; chainChanged: Hex; disconnect: { code: number; message: string } }>();
  let session: WcSession | null = null;
  let accounts: Hex[] = [];
  let chainId = cfg.chains[0]?.id ?? 1;
  let solana: string | null = null;
  let aborted = false;

  const sessionChains = (): number[] => {
    const ns = session?.namespaces.eip155;
    const caips = ns?.chains?.length ? ns.chains : (ns?.accounts ?? []).map((a) => a.split(":").slice(0, 2).join(":"));
    return [...new Set(caips.map((x) => parseChainId(x)).filter((n): n is number => n !== null))];
  };

  function apply(s: WcSession, preferred?: number): WcAccounts {
    session = s;
    const evm = s.namespaces.eip155?.accounts ?? [];
    accounts = [...new Set(evm.map(accountOf).filter((a): a is Hex => /^0x[0-9a-fA-F]{40}$/.test(a)))];
    const ids = sessionChains();
    if (preferred && ids.includes(preferred)) chainId = preferred;
    else if (!ids.includes(chainId)) chainId = ids[0] ?? chainId;
    solana = (s.namespaces.solana?.accounts ?? []).map(accountOf).find(Boolean) ?? null;
    return { accounts, chainId, solana };
  }

  function setChain(id: number) {
    if (id === chainId) return;
    chainId = id;
    events.emit("chainChanged", toHexChainId(id));
  }

  function drop(code: number, message: string) {
    session = null;
    accounts = [];
    solana = null;
    events.emit("disconnect", { code, message });
  }

  const forThis = (topic: unknown) => !!session && topic === session.topic;
  client.on("session_event", (e: { topic: string; params: { event: { name: string; data: unknown }; chainId?: string } }) => {
    if (!forThis(e?.topic)) return;
    const { name, data } = e.params.event;
    if (name === "chainChanged") {
      const id = parseChainId(data);
      if (id) setChain(id);
    } else if (name === "accountsChanged" && Array.isArray(data)) {
      accounts = data.map((a) => (String(a).includes(":") ? accountOf(String(a)) : String(a))).filter((a): a is Hex => /^0x[0-9a-fA-F]{40}$/.test(a));
      events.emit("accountsChanged", accounts.slice());
    }
  });
  client.on("session_update", (e: { topic: string; params: { namespaces: WcSession["namespaces"] } }) => {
    if (!forThis(e?.topic) || !session) return;
    const before = accounts.join();
    apply({ ...session, namespaces: e.params.namespaces });
    if (accounts.join() !== before) events.emit("accountsChanged", accounts.slice());
  });
  client.on("session_delete", (e: { topic: string }) => forThis(e?.topic) && drop(6000, "Terra Wallet ended the session."));
  client.on("session_expire", (e: { topic: string }) => forThis(e?.topic) && drop(6000, "The WalletConnect session expired."));
  // Phones: once a request is published to the relay, bring Terra Wallet forward to approve it.
  client.on("session_request_sent", (e: { topic: string; id: number }) => {
    if (cfg.platform !== "desktop" && forThis(e?.topic)) openAppLink(buildWakeDeepLink(e.topic, e.id));
  });

  async function walletRequest<T>(caipChain: string, method: string, params: unknown): Promise<T> {
    if (!session) throw new TerraError("DISCONNECTED");
    try {
      return await client.request<T>({ topic: session.topic, chainId: caipChain, request: { method, params } });
    } catch (e) {
      throw toTerraError(e);
    }
  }

  const provider: EIP1193Provider = {
    async request({ method, params }: RequestArguments) {
      switch (method) {
        case "eth_accounts":
        case "eth_requestAccounts":
          return accounts.slice();
        case "eth_chainId":
          return toHexChainId(chainId);
        case "net_version":
          return String(chainId);
        case "wallet_switchEthereumChain": {
          const id = parseChainId((Array.isArray(params) ? (params[0] as { chainId?: unknown }) : undefined)?.chainId);
          if (!id) throw new TerraError("INVALID_PARAMS", "Expected [{ chainId: \"0x1\" }].");
          // Networks approved in the session switch locally: every request carries its CAIP-2 chain id.
          if (!sessionChains().includes(id)) {
            const chain = cfg.chains.find((x) => x.id === id);
            if (!chain) throw new TerraError("UNRECOGNIZED_CHAIN");
            await walletRequest(`eip155:${chainId}`, "wallet_addEthereumChain", [addChainParams(chain)]);
          }
          setChain(id);
          return null;
        }
      }
      if (!session) throw new TerraError("DISCONNECTED");
      if (EVM_WALLET_METHODS.includes(method)) return walletRequest(`eip155:${chainId}`, method, params);
      if (method.startsWith("wallet_") || method === "eth_sign") throw new TerraError("UNSUPPORTED_METHOD");
      return rpcCall(cfg.chains.find((x) => x.id === chainId), method, params);
    },
    on(event: string, cb: (d: any) => void) {
      return events.on(event as "accountsChanged", cb);
    },
    removeListener(event: string, cb: (d: any) => void) {
      events.off(event as "accountsChanged", cb);
    },
  };

  return {
    provider,
    async pair({ chainId: want, onUri }) {
      aborted = false;
      const evmChains = cfg.chains.map((x) => `eip155:${x.id}`);
      const { uri, approval } = await client.connect({
        optionalNamespaces: {
          eip155: { chains: evmChains, methods: EVM_WALLET_METHODS, events: ["chainChanged", "accountsChanged"] },
          solana: { chains: [SOLANA_MAINNET], methods: SOLANA_METHODS, events: [] },
        },
      });
      if (uri) onUri(uri);
      let s: WcSession;
      try {
        s = await approval();
      } catch (e) {
        throw toTerraError(e);
      }
      if (aborted) {
        client.disconnect({ topic: s.topic, reason: { code: 6000, message: "Connection cancelled" } }).catch(() => {});
        throw new TerraError("USER_REJECTED", "The connection was cancelled.");
      }
      const out = apply(s, want);
      if (!out.accounts.length) throw new TerraError("UNAUTHORIZED", "Terra Wallet did not share an EVM account.");
      return out;
    },
    async restore() {
      const now = Date.now() / 1000;
      const live = client.session.getAll().filter((s) => s.expiry > now && s.namespaces.eip155?.accounts?.length);
      const last = live[live.length - 1];
      return last ? apply(last) : null;
    },
    async disconnect() {
      const s = session;
      session = null;
      accounts = [];
      if (s) await client.disconnect({ topic: s.topic, reason: { code: 6000, message: "User disconnected" } }).catch(() => {});
    },
    abort() {
      aborted = true;
    },
    solana: {
      async signMessage(address, message) {
        const r = await walletRequest<{ signature: string }>(SOLANA_MAINNET, "solana_signMessage", { message: base58Encode(message), pubkey: address });
        return base58Decode(r.signature);
      },
      async signTransaction(tx) {
        const r = await walletRequest<{ transaction?: string }>(SOLANA_MAINNET, "solana_signTransaction", { transaction: bytesToBase64(tx) });
        if (!r.transaction) throw new TerraError("INTERNAL", "Terra Wallet did not return the signed transaction.");
        return base64ToBytes(r.transaction);
      },
      async signAndSendTransaction(tx) {
        const r = await walletRequest<{ signature: string }>(SOLANA_MAINNET, "solana_signAndSendTransaction", { transaction: bytesToBase64(tx) });
        return r.signature;
      },
    },
  };
}
