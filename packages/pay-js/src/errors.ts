export type TerraPayErrorCode =
  | "SECRET_KEY_REFUSED"
  | "INVALID_PUBLISHABLE_KEY"
  | "INVALID_CHECKOUT"
  | "POPUP_BLOCKED"
  | "UNSUPPORTED_ENVIRONMENT"
  | "CHECKOUT_ERROR";

export const DOCS_ERRORS_URL = "https://developers.terrawallet.us/docs/errors";

const MESSAGES: Record<TerraPayErrorCode, string> = {
  SECRET_KEY_REFUSED:
    "A secret key was passed to browser code and was refused. Use your publishable key (tw_test_pk_ or tw_live_pk_) here, and rotate that secret key in the Terra dashboard now: anything shipped to a browser is public.",
  INVALID_PUBLISHABLE_KEY: "Use a publishable key that starts with tw_test_pk_ or tw_live_pk_.",
  INVALID_CHECKOUT: "Pass a checkout URL on https://pay.terrawallet.us, a payment intent id (pi_...), or a plan id (plan_...).",
  POPUP_BLOCKED: "The browser blocked the checkout window. Open checkout from a click.",
  UNSUPPORTED_ENVIRONMENT: "Terra Pay checkout needs a browser.",
  CHECKOUT_ERROR: "Checkout reported an error.",
};

export class TerraPayError extends Error {
  override readonly name = "TerraPayError";
  readonly code: TerraPayErrorCode;
  readonly docUrl: string;
  constructor(code: TerraPayErrorCode, message?: string) {
    super(message || MESSAGES[code]);
    this.code = code;
    this.docUrl = `${DOCS_ERRORS_URL}#${code.toLowerCase()}`;
  }
}

/**
 * Browser code takes publishable keys only. The key is never echoed in errors.
 * - Refused as a secret: `_sk_` anywhere (or `sk_` at the start) and `whsec_` anywhere, case-insensitive.
 * - Accepted: `tw_test_pk_` / `tw_live_pk_` plus base64url (the API mints 43 characters, `-` and `_` included).
 */
export function assertPublishableKey(key: unknown): asserts key is string {
  if (typeof key === "string" && /(^|_)sk_|whsec_/i.test(key)) throw new TerraPayError("SECRET_KEY_REFUSED");
  if (typeof key !== "string" || !/^tw_(test|live)_pk_[A-Za-z0-9_-]{8,128}$/.test(key)) throw new TerraPayError("INVALID_PUBLISHABLE_KEY");
}
