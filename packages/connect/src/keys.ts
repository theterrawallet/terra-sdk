import { TerraError } from "./errors.js";

/**
 * Publishable keys only: `tw_test_pk_...` or `tw_live_pk_...`. The API mints the secret part as base64url
 * (43 characters today), so `-` and `_` are part of the alphabet.
 */
const PUBLISHABLE = /^tw_(test|live)_pk_[A-Za-z0-9_-]{8,128}$/;
/**
 * Anything that looks like a secret, anywhere in the string: an API secret key (`_sk_`, or `sk_` at the start) or
 * a webhook signing secret (`whsec_`). Checked before the publishable format, so a secret glued onto a
 * publishable-looking prefix is still refused.
 */
const SECRET = /(^|_)sk_|whsec_/i;

/** True when a string carries something shaped like a secret key or webhook secret. */
export const looksLikeSecretKey = (key: unknown): boolean => typeof key === "string" && SECRET.test(key);

/**
 * Browser packages accept publishable keys only. A secret key reaching browser code is already exposed, so the
 * error says to rotate it. The key itself is never echoed into the message or logs.
 */
export function assertPublishableKey(key: unknown): asserts key is string {
  if (looksLikeSecretKey(key)) {
    throw new TerraError(
      "SECRET_KEY_REFUSED",
      "A secret key was passed to browser code and was refused. Use your publishable key (tw_test_pk_ or tw_live_pk_) here, and rotate that secret key in the Terra dashboard now: anything shipped to a browser is public.",
    );
  }
  if (typeof key !== "string" || !PUBLISHABLE.test(key)) throw new TerraError("INVALID_PUBLISHABLE_KEY");
}

/** `test` or `live`, from a publishable key that already passed `assertPublishableKey`. */
export function keyEnvironment(key: string): "test" | "live" {
  return key.startsWith("tw_live_") ? "live" : "test";
}
