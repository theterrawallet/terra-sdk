/**
 * Webhook signature verification.
 *
 * Header:   Terra-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, `${t}.${rawBody}`)>
 * Several v1 entries may appear during a secret rotation; any one valid signature is enough.
 *
 * Always verify the RAW request body (the exact bytes received), before any JSON parsing.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { TerraApiError, docUrlFor } from "./errors.js";
import type { TerraEvent } from "./types.js";

export const SIGNATURE_HEADER = "Terra-Signature";
export const DEFAULT_TOLERANCE_SEC = 300;

export type WebhookErrorCode = "NO_SIGNATURE_HEADER" | "MALFORMED_SIGNATURE_HEADER" | "SIGNATURE_MISMATCH" | "TIMESTAMP_OUT_OF_TOLERANCE" | "INVALID_PAYLOAD";

export class TerraWebhookSignatureError extends TerraApiError {
  override name = "TerraWebhookSignatureError";
  declare readonly code: WebhookErrorCode;
  constructor(code: WebhookErrorCode, message: string) {
    super({ code, message, status: 400, docUrl: docUrlFor(code) });
  }
}

export interface ParsedSignature {
  timestamp: number;
  signatures: string[];
}

const MALFORMED = "The Terra-Signature header must look like t=<unix>,v1=<hex>.";

/**
 * Parses `t=<unix>,v1=<hex>[,v1=<hex>...]`. Unknown schemes (v0=...) are skipped. Throws only
 * TerraWebhookSignatureError: a missing header, one over 4096 characters, no valid t or v1, or two different t
 * values (an attacker-controlled header must not get to pick which timestamp is checked).
 */
export function parseSignatureHeader(header: string | readonly string[] | null | undefined): ParsedSignature {
  const raw: unknown = header;
  const value = Array.isArray(raw) ? (raw.every((h) => typeof h === "string") ? raw.join(",") : null) : raw;
  if (Array.isArray(raw) && value === null) throw new TerraWebhookSignatureError("MALFORMED_SIGNATURE_HEADER", MALFORMED);
  if (!value || typeof value !== "string") throw new TerraWebhookSignatureError("NO_SIGNATURE_HEADER", "The Terra-Signature header is missing.");
  if (value.length > 4096) throw new TerraWebhookSignatureError("MALFORMED_SIGNATURE_HEADER", "The Terra-Signature header is too long.");
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of value.split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "t") {
      if (!/^\d{1,12}$/.test(v) || (timestamp !== null && timestamp !== Number(v))) throw new TerraWebhookSignatureError("MALFORMED_SIGNATURE_HEADER", MALFORMED);
      timestamp = Number(v);
    } else if (k === "v1" && /^[0-9a-f]{64}$/i.test(v)) signatures.push(v.toLowerCase());
  }
  if (timestamp === null || !signatures.length) throw new TerraWebhookSignatureError("MALFORMED_SIGNATURE_HEADER", MALFORMED);
  return { timestamp, signatures };
}

const toBuffer = (body: string | Uint8Array): Buffer => (typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body.buffer, body.byteOffset, body.byteLength));

function hmac(secret: string, timestamp: number, body: Buffer): Buffer {
  return createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest();
}

/**
 * Verifies a webhook and returns the parsed event. Throws `TerraWebhookSignatureError` when the header is missing
 * or malformed, no signature matches (tampered body or wrong secret), or the timestamp is outside the tolerance
 * window (replay protection). Signatures are compared in constant time.
 *
 * @param rawBody      exact request body bytes (string or Buffer/Uint8Array), not re-serialised JSON
 * @param header       value of the Terra-Signature header
 * @param secret       the endpoint's signing secret (whsec_...), or several during a rotation
 * @param toleranceSec maximum age (and clock skew) in seconds; default 300
 * @param nowSec       current unix time, for tests
 */
export function verifyWebhook<T = TerraEvent>(
  rawBody: string | Uint8Array,
  header: string | readonly string[] | null | undefined,
  secret: string | readonly string[],
  toleranceSec: number = DEFAULT_TOLERANCE_SEC,
  nowSec: number = Math.floor(Date.now() / 1000),
): T {
  const secrets = (Array.isArray(secret) ? secret : [secret]).filter((s): s is string => typeof s === "string" && s.length > 0);
  if (!secrets.length) throw new TypeError("verifyWebhook needs the endpoint signing secret (whsec_...).");
  if (typeof rawBody !== "string" && !(rawBody instanceof Uint8Array)) {
    throw new TypeError("verifyWebhook needs the raw request body as a string or Buffer, not parsed JSON.");
  }
  const { timestamp, signatures } = parseSignatureHeader(header);
  const body = toBuffer(rawBody);
  const given = signatures.map((s) => Buffer.from(s, "hex"));
  let valid = false;
  for (const s of secrets) {
    const expected = hmac(s, timestamp, body);
    for (const g of given) if (g.length === expected.length && timingSafeEqual(g, expected)) valid = true;
  }
  if (!valid) throw new TerraWebhookSignatureError("SIGNATURE_MISMATCH", "No signature matches the payload. Check the signing secret and that you pass the raw body.");
  if (!(toleranceSec > 0) || Math.abs(nowSec - timestamp) > toleranceSec) {
    throw new TerraWebhookSignatureError("TIMESTAMP_OUT_OF_TOLERANCE", "The webhook timestamp is outside the tolerance window (possible replay).");
  }
  try {
    return JSON.parse(body.toString("utf8")) as T;
  } catch {
    throw new TerraWebhookSignatureError("INVALID_PAYLOAD", "The webhook body is not valid JSON.");
  }
}

export type WebhookVerification<T> = { ok: true; event: T } | { ok: false; code: WebhookErrorCode; message: string };

/**
 * Like verifyWebhook, but never throws for anything a sender controls (header, body, timestamp): it returns
 * `{ ok: true, event }` or `{ ok: false, code, message }`, so a malformed request can be answered with a 400 without a
 * try/catch. Configuration mistakes on your side (no secret, a parsed object instead of the raw body) still throw a
 * TypeError, so they cannot pass silently.
 *
 *   const r = safeVerifyWebhook(raw, req.headers["terra-signature"], process.env.TERRA_WEBHOOK_SECRET!);
 *   if (!r.ok) return res.status(400).end();
 */
export function safeVerifyWebhook<T = TerraEvent>(
  rawBody: string | Uint8Array,
  header: string | readonly string[] | null | undefined,
  secret: string | readonly string[],
  toleranceSec: number = DEFAULT_TOLERANCE_SEC,
  nowSec: number = Math.floor(Date.now() / 1000),
): WebhookVerification<T> {
  try {
    return { ok: true, event: verifyWebhook<T>(rawBody, header, secret, toleranceSec, nowSec) };
  } catch (e) {
    if (e instanceof TerraWebhookSignatureError) return { ok: false, code: e.code, message: e.message };
    throw e;
  }
}

/** Builds a valid Terra-Signature header for a payload. For tests and local tools only. */
export function generateTestHeader(opts: { payload: string | Uint8Array; secret: string; timestamp?: number }): string {
  const t = opts.timestamp ?? Math.floor(Date.now() / 1000);
  return `t=${t},v1=${hmac(opts.secret, t, toBuffer(opts.payload)).toString("hex")}`;
}
