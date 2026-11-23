import type { TerraChain } from "./chains.js";
import type { EIP1193Provider, RequestArguments } from "./discovery.js";
import type { Hex } from "./encoding.js";
import type { TerraError } from "./errors.js";
import type { Platform } from "./deeplink.js";
import type { WalletConnectLoader } from "./wc-types.js";

export type ConnectionStatus = "disconnected" | "connecting" | "reconnecting" | "connected";
export type ConnectorKind = "injected" | "walletconnect";
export type ConnectMethod = "auto" | "injected" | "walletconnect";

export interface TerraConnectOptions {
  /** Your app's name, shown in Terra Wallet when connecting through WalletConnect. Defaults to the page title. */
  appName?: string;
  appDescription?: string;
  /** Defaults to the page origin. Must be an absolute http(s) URL. */
  appUrl?: string;
  /** Absolute https URL of your app icon. */
  appIcon?: string;
  /** EVM networks your app uses (ids from the built-in list, or custom `TerraChain` objects). The first is the default. */
  chains?: readonly (number | TerraChain)[];
  /**
   * WalletConnect (Reown) project id. Needed only for the fallback when Terra Wallet is not in the browser: a QR
   * code on desktop, an app deep link on phones. Create one free at https://cloud.reown.com.
   */
  walletConnectProjectId?: string;
  walletConnect?: {
    relayUrl?: string;
    /** Supplies the WalletConnect sign client. Defaults to a dynamic import of `@walletconnect/sign-client`. */
    loader?: WalletConnectLoader;
    /**
     * WalletConnect's own usage telemetry (events posted to pulse.walletconnect.org). Off unless set to true, so
     * your users' sessions are not reported to a third party by default.
     */
    telemetry?: boolean;
  };
  /** Optional publishable key (`tw_test_pk_...` / `tw_live_pk_...`). Secret keys are refused. */
  publishableKey?: string;
  /** Restore the previous connection on page load without prompting. Default true. */
  autoReconnect?: boolean;
  /** localStorage key that remembers the last connection. Default "terra-connect". Set null to disable. */
  storageKey?: string | null;
  /** How long to wait for EIP-6963 / Wallet Standard announcements, in ms. Default 500. */
  discoveryTimeoutMs?: number;
  /**
   * Phones without Terra Wallet in the browser: "auto" opens the app as soon as the pairing link is ready, "manual"
   * leaves it to your UI (listen for `display_uri` and call `openAppLink(buildPairingDeepLink(uri))` on a tap).
   */
  deepLink?: "auto" | "manual";
}

export interface TerraState {
  readonly status: ConnectionStatus;
  readonly address: Hex | null;
  readonly accounts: readonly Hex[];
  readonly chainId: number | null;
  readonly connector: ConnectorKind | null;
  readonly solanaAddress: string | null;
  readonly error: TerraError | null;
  /** A WalletConnect pairing URI waiting to be scanned or opened in the app. */
  readonly pairingUri: string | null;
}

export interface ConnectOptions {
  method?: ConnectMethod;
  /** Network to switch to after connecting. */
  chainId?: number;
}

export interface ConnectResult {
  address: Hex;
  chainId: number;
  connector: ConnectorKind;
}

export interface Detection {
  /** Terra Wallet is injected in this page (the extension, or the app's in-app browser). */
  injected: boolean;
  /** Terra Wallet's Solana Wallet Standard wallet is registered in this page. */
  solana: boolean;
  platform: Platform;
  /** A WalletConnect project id is configured (QR and app deep-link fallback available). */
  walletConnect: boolean;
}

export interface TransactionRequest {
  to?: string;
  from?: string;
  value?: bigint | number | string;
  data?: Hex;
  gas?: bigint | number | string;
  gasPrice?: bigint | number | string;
  maxFeePerGas?: bigint | number | string;
  maxPriorityFeePerGas?: bigint | number | string;
  nonce?: number;
  /** Switches to this network first when it differs from the current one. */
  chainId?: number;
}

export type SignableMessage = string | Uint8Array | { raw: Hex };

export interface TerraEvents extends Record<string, unknown> {
  connect: ConnectResult;
  disconnect: undefined;
  accountsChanged: readonly Hex[];
  chainChanged: number;
  /** A WalletConnect pairing URI: render it as a QR code (desktop) or open it in the app (phones). */
  display_uri: string;
  error: TerraError;
}

export interface TerraSolana {
  readonly address: string | null;
  connect(): Promise<string>;
  disconnect(): Promise<void>;
  /** Returns the 64-byte ed25519 signature. */
  signMessage(message: string | Uint8Array): Promise<Uint8Array>;
  /** Takes a serialized (unsigned) transaction, returns the signed serialized transaction. */
  signTransaction(transaction: Uint8Array): Promise<Uint8Array>;
  /** Signs and submits. Returns the base58 transaction signature. */
  signAndSendTransaction(transaction: Uint8Array): Promise<string>;
}

export interface TerraConnect {
  readonly chains: readonly TerraChain[];
  readonly options: Readonly<TerraConnectOptions>;
  getState(): TerraState;
  subscribe(listener: (state: TerraState, prev: TerraState) => void): () => void;
  on<K extends keyof TerraEvents>(event: K, cb: (data: TerraEvents[K]) => void): () => void;
  detect(): Promise<Detection>;
  connect(opts?: ConnectOptions): Promise<ConnectResult>;
  /** Abandons a connection that is waiting for the user (closing a QR code, for example). */
  cancel(): void;
  disconnect(): Promise<void>;
  /** Silently restores the previous connection, if any. Resolves true when connected. */
  reconnect(): Promise<boolean>;
  request<T = unknown>(args: RequestArguments): Promise<T>;
  switchChain(chainId: number): Promise<number>;
  signMessage(message: SignableMessage): Promise<Hex>;
  signTypedData(typedData: object): Promise<Hex>;
  sendTransaction(tx: TransactionRequest): Promise<Hex>;
  /** A stable EIP-1193 provider that follows the active connection (for viem, ethers, wagmi). */
  getProvider(): EIP1193Provider & { on(event: string, cb: (...a: any[]) => void): unknown; removeListener(event: string, cb: (...a: any[]) => void): unknown };
  readonly solana: TerraSolana;
  readonly platform: Platform;
  destroy(): void;
}
