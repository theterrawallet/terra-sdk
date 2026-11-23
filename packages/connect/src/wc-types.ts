/**
 * The few WalletConnect sign-client shapes the SDK touches, declared structurally so the published types never
 * depend on WalletConnect's packages (and the core stays free of them until the fallback is actually used).
 */

export interface WcNamespace {
  accounts: string[];
  chains?: string[];
  methods: string[];
  events: string[];
}

export interface WcSession {
  topic: string;
  expiry: number;
  namespaces: Record<string, WcNamespace>;
  peer?: { metadata?: { name?: string; url?: string } };
}

export interface WcSignClient {
  connect(params: {
    optionalNamespaces: Record<string, { chains: string[]; methods: string[]; events: string[] }>;
  }): Promise<{ uri?: string; approval(): Promise<WcSession> }>;
  request<T = unknown>(params: { topic: string; chainId: string; request: { method: string; params: unknown } }): Promise<T>;
  disconnect(params: { topic: string; reason: { code: number; message: string } }): Promise<void>;
  on(event: string, listener: (args: any) => void): unknown;
  off?(event: string, listener: (args: any) => void): unknown;
  session: { getAll(): WcSession[] };
}

export interface WcSignClientStatic {
  init(opts: Record<string, unknown>): Promise<WcSignClient>;
}

/** Resolves to the `@walletconnect/sign-client` module (or anything exposing `SignClient.init`). */
export type WalletConnectLoader = () => Promise<{ SignClient?: WcSignClientStatic; default?: WcSignClientStatic | { SignClient?: WcSignClientStatic } }>;
