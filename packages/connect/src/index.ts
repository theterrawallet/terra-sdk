/**
 * @terrawallet/connect: connect any web app to Terra Wallet.
 *
 *   import { createTerraConnect } from "@terrawallet/connect";
 *   const terra = createTerraConnect({ appName: "My dApp", walletConnectProjectId: "..." });
 *   const { address, chainId } = await terra.connect();
 */
declare const __TERRA_SDK_VERSION__: string;

export const VERSION: string = typeof __TERRA_SDK_VERSION__ === "string" ? __TERRA_SDK_VERSION__ : "0.0.0-dev";

export { createTerraConnect, INITIAL_STATE } from "./client.js";
export { TerraError, isTerraError, toTerraError, toProviderError, DOCS_ERRORS_URL, type TerraErrorCode } from "./errors.js";
export { assertPublishableKey, keyEnvironment, looksLikeSecretKey } from "./keys.js";
export { TERRA_CHAINS, TERRA_TESTNETS, getChain, resolveChains, parseChainId, toHexChainId, type TerraChain } from "./chains.js";
export {
  TERRA_RDNS,
  TERRA_WALLET_NAME,
  discoverEip6963,
  watchEip6963,
  discoverSolanaWallet,
  findLegacyInjected,
  type EIP1193Provider,
  type EIP6963ProviderDetail,
  type EIP6963ProviderInfo,
  type RequestArguments,
  type StandardWallet,
  type StandardWalletAccount,
} from "./discovery.js";
export {
  TERRA_APP_SCHEME,
  TERRA_ANDROID_PACKAGE,
  PLAY_STORE_URL,
  CHROME_STORE_URL,
  APP_STORE_URL,
  detectPlatform,
  buildPairingDeepLink,
  buildWakeDeepLink,
  isWalletConnectPairingUri,
  isSafeAppLink,
  installUrl,
  openAppLink,
  type Platform,
} from "./deeplink.js";
export { base58Encode, base58Decode, bytesToHex, utf8ToHex, toQuantity, type Hex } from "./encoding.js";
export type {
  TerraConnect,
  TerraConnectOptions,
  TerraState,
  TerraEvents,
  TerraSolana,
  ConnectOptions,
  ConnectResult,
  ConnectMethod,
  ConnectionStatus,
  ConnectorKind,
  Detection,
  TransactionRequest,
  SignableMessage,
} from "./types.js";
export type { WalletConnectLoader } from "./wc-types.js";
