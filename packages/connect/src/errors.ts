/**
 * Typed errors. Every failure the SDK surfaces is a `TerraError` with a stable `code`, the original EIP-1193 /
 * JSON-RPC numeric code when there was one (`rpcCode`), and a `docUrl` that explains the fix.
 */

export type TerraErrorCode =
  | "USER_REJECTED"
  | "UNAUTHORIZED"
  | "UNSUPPORTED_METHOD"
  | "DISCONNECTED"
  | "CHAIN_DISCONNECTED"
  | "UNRECOGNIZED_CHAIN"
  | "REQUEST_PENDING"
  | "INVALID_PARAMS"
  | "INTERNAL"
  | "NOT_INSTALLED"
  | "NOT_CONNECTED"
  | "WALLETCONNECT_UNAVAILABLE"
  | "TIMEOUT"
  | "SECRET_KEY_REFUSED"
  | "INVALID_PUBLISHABLE_KEY"
  | "UNSUPPORTED_ENVIRONMENT"
  | "UNKNOWN";

export const DOCS_ERRORS_URL = "https://developers.terrawallet.us/docs/errors";

const MESSAGES: Record<TerraErrorCode, string> = {
  USER_REJECTED: "The request was rejected in Terra Wallet.",
  UNAUTHORIZED: "This site is not connected to Terra Wallet, or the account is not available.",
  UNSUPPORTED_METHOD: "Terra Wallet does not support this request.",
  DISCONNECTED: "Terra Wallet is disconnected.",
  CHAIN_DISCONNECTED: "Terra Wallet is not connected to the requested network.",
  UNRECOGNIZED_CHAIN: "This network is not available in Terra Wallet.",
  REQUEST_PENDING: "A request is already waiting in Terra Wallet. Open the wallet to finish it.",
  INVALID_PARAMS: "The request parameters are invalid.",
  INTERNAL: "Terra Wallet hit an internal error. Please try again.",
  NOT_INSTALLED: "Terra Wallet was not found in this browser.",
  NOT_CONNECTED: "Connect Terra Wallet first.",
  WALLETCONNECT_UNAVAILABLE: "Connecting with the mobile app needs a WalletConnect project id.",
  TIMEOUT: "Terra Wallet did not respond in time.",
  SECRET_KEY_REFUSED: "A secret key must never be used in browser code.",
  INVALID_PUBLISHABLE_KEY: "Use a publishable key that starts with tw_test_pk_ or tw_live_pk_.",
  UNSUPPORTED_ENVIRONMENT: "This needs a browser.",
  UNKNOWN: "Something went wrong.",
};

/** EIP-1193, JSON-RPC and WalletConnect numeric codes, mapped to SDK codes. */
const RPC_CODES: Record<number, TerraErrorCode> = {
  4001: "USER_REJECTED",
  4100: "UNAUTHORIZED",
  4200: "UNSUPPORTED_METHOD",
  4900: "DISCONNECTED",
  4901: "CHAIN_DISCONNECTED",
  4902: "UNRECOGNIZED_CHAIN",
  [-32002]: "REQUEST_PENDING",
  [-32602]: "INVALID_PARAMS",
  [-32603]: "INTERNAL",
  [-32601]: "UNSUPPORTED_METHOD",
  5000: "USER_REJECTED",
  5001: "USER_REJECTED",
  5002: "USER_REJECTED",
  5100: "UNRECOGNIZED_CHAIN",
  5101: "UNSUPPORTED_METHOD",
};

/** The EIP-1193 numeric code reported to dApps for each SDK code (wagmi, viem and ethers read `code`). */
const TO_RPC: Partial<Record<TerraErrorCode, number>> = {
  USER_REJECTED: 4001,
  UNAUTHORIZED: 4100,
  UNSUPPORTED_METHOD: 4200,
  DISCONNECTED: 4900,
  NOT_CONNECTED: 4900,
  CHAIN_DISCONNECTED: 4901,
  UNRECOGNIZED_CHAIN: 4902,
  REQUEST_PENDING: -32002,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
};

export class TerraError extends Error {
  override readonly name = "TerraError";
  readonly code: TerraErrorCode;
  /** Original EIP-1193 / JSON-RPC code when the wallet returned one, otherwise the closest EIP-1193 code. */
  readonly rpcCode: number | undefined;
  readonly data: unknown;
  readonly docUrl: string;

  constructor(code: TerraErrorCode, message?: string, opts: { rpcCode?: number; data?: unknown; cause?: unknown } = {}) {
    super(message || MESSAGES[code], opts.cause === undefined ? undefined : { cause: opts.cause });
    this.code = code;
    this.rpcCode = opts.rpcCode ?? TO_RPC[code];
    this.data = opts.data;
    this.docUrl = `${DOCS_ERRORS_URL}#${code.toLowerCase()}`;
  }
}

export function isTerraError(e: unknown): e is TerraError {
  return e instanceof TerraError;
}

/** Normalises anything thrown by a wallet, WalletConnect or the SDK into a `TerraError`. */
export function toTerraError(e: unknown): TerraError {
  if (e instanceof TerraError) return e;
  const o = (e && typeof e === "object" ? e : {}) as { code?: unknown; message?: unknown; data?: unknown };
  const raw = typeof o.message === "string" ? o.message.slice(0, 500) : typeof e === "string" ? e.slice(0, 500) : "";
  const num = typeof o.code === "number" ? o.code : undefined;
  let code: TerraErrorCode = num !== undefined && RPC_CODES[num] ? RPC_CODES[num]! : "UNKNOWN";
  if (code === "UNKNOWN" && /user (rejected|denied|cancel)|rejected by user|request rejected/i.test(raw)) code = "USER_REJECTED";
  return new TerraError(code, raw || undefined, { rpcCode: num, data: o.data, cause: e });
}

/**
 * EIP-1193 shaped error (numeric `code`) for the provider surface, so viem, wagmi and ethers recognise user
 * rejections (4001), unknown chains (4902) and so on. The SDK code and docs link ride along.
 */
export function toProviderError(e: unknown): Error & { code: number; data?: unknown; terraCode: TerraErrorCode; docUrl: string } {
  const t = toTerraError(e);
  return Object.assign(new Error(t.message), { name: "ProviderRpcError", code: t.rpcCode ?? -32603, data: t.data, terraCode: t.code, docUrl: t.docUrl });
}
