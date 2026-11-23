/**
 * API errors. Every error from the `/v1` API carries the server's stable `code`, the `requestId` to quote to
 * support, and a `doc_url` explaining the fix. Secrets are never included in messages.
 */

export const DOCS_ERRORS_URL = "https://developers.terrawallet.us/docs/errors";

export const docUrlFor = (code: string) => `${DOCS_ERRORS_URL}#${code.toLowerCase()}`;

/** Terra API keys, webhook signing secrets and bearer credentials, wherever they appear in a text. */
const SECRETISH = /\bBearer\s+[^\s"',;]+|tw_(?:test|live)_(?:sk|pk)_[A-Za-z0-9_-]+|whsec_[A-Za-z0-9_-]+/gi;

/** Replaces anything shaped like a key, webhook secret or bearer credential with a marker (keeps the key type). */
export function redact(text: string): string {
  return text.replace(SECRETISH, (m) => (/^bearer/i.test(m) ? "Bearer [redacted]" : /^whsec_/i.test(m) ? "whsec_[redacted]" : `${m.slice(0, 11)}[redacted]`));
}

/**
 * A copy of a lower-level error that is safe to log: name, code, message and stack with secrets redacted, and the
 * same for its own causes (a few levels). Errors from a custom `fetch` (a proxy or logging wrapper) can quote the
 * request, Authorization header included; the original object is never attached.
 */
export function safeCause(e: unknown, depth = 0): unknown {
  if (e === undefined || e === null || depth > 3) return undefined;
  try {
    if (typeof e !== "object" && typeof e !== "function") return redact(String(e)).slice(0, 1000);
    const src = e as { name?: unknown; message?: unknown; code?: unknown; stack?: unknown; cause?: unknown };
    const message = redact(typeof src.message === "string" ? src.message : "").slice(0, 1000);
    const cause = src.cause === undefined ? undefined : safeCause(src.cause, depth + 1);
    const out = new Error(message, cause === undefined ? undefined : { cause }) as Error & { code?: string | number };
    out.name = typeof src.name === "string" ? src.name.slice(0, 100) : "Error";
    if (typeof src.code === "string" || typeof src.code === "number") out.code = typeof src.code === "string" ? redact(src.code).slice(0, 100) : src.code;
    out.stack = typeof src.stack === "string" ? redact(src.stack).slice(0, 4000) : `${out.name}: ${message}`;
    return out;
  } catch {
    return undefined;
  }
}

export interface TerraErrorInit {
  code: string;
  message: string;
  status?: number;
  requestId?: string;
  docUrl?: string;
  retryAfterSec?: number;
  /** The Idempotency-Key the failed request carried (yours, or the generated one). */
  idempotencyKey?: string;
  cause?: unknown;
}

export class TerraApiError extends Error {
  override name = "TerraApiError";
  /** Stable SNAKE_CASE code, e.g. "INVALID_REQUEST", "RATE_LIMITED", "IDEMPOTENCY_KEY_REUSED". */
  readonly code: string;
  /** HTTP status (undefined for network errors and timeouts). */
  readonly status: number | undefined;
  /** The `req_...` id of the failing request (from the error body or the X-Request-Id header). */
  readonly requestId: string | undefined;
  /** Where the fix is documented. */
  readonly doc_url: string;
  /**
   * The Idempotency-Key this request carried. After a TIMEOUT, CONNECTION_ERROR, 5xx or IDEMPOTENCY_IN_PROGRESS the
   * create may still have happened on the server: retry with `{ idempotencyKey: error.idempotencyKey }` (never a
   * new key), and the API returns the original result instead of creating a second one.
   */
  readonly idempotencyKey: string | undefined;

  constructor(init: TerraErrorInit) {
    super(redact(init.message), init.cause === undefined ? undefined : { cause: safeCause(init.cause) });
    this.code = init.code;
    this.status = init.status;
    this.requestId = init.requestId;
    this.doc_url = init.docUrl ?? docUrlFor(init.code);
    this.idempotencyKey = init.idempotencyKey;
  }

  /** camelCase alias of `doc_url`. */
  get docUrl(): string {
    return this.doc_url;
  }
}

export class TerraInvalidRequestError extends TerraApiError {
  override name = "TerraInvalidRequestError";
}
export class TerraAuthenticationError extends TerraApiError {
  override name = "TerraAuthenticationError";
}
export class TerraPermissionError extends TerraApiError {
  override name = "TerraPermissionError";
}
export class TerraNotFoundError extends TerraApiError {
  override name = "TerraNotFoundError";
}
/** 409, including IDEMPOTENCY_KEY_REUSED (same key, different body). */
export class TerraConflictError extends TerraApiError {
  override name = "TerraConflictError";
}
export class TerraRateLimitError extends TerraApiError {
  override name = "TerraRateLimitError";
  readonly retryAfterSec: number | undefined;
  constructor(init: TerraErrorInit) {
    super(init);
    this.retryAfterSec = init.retryAfterSec;
  }
}
export class TerraServerError extends TerraApiError {
  override name = "TerraServerError";
}
/** The request never got an HTTP response: network failure (CONNECTION_ERROR) or timeout (TIMEOUT). */
export class TerraConnectionError extends TerraApiError {
  override name = "TerraConnectionError";
}
/** Bad client configuration (missing or wrong key type, browser use). */
export class TerraConfigError extends TerraApiError {
  override name = "TerraConfigError";
}

export function errorForStatus(status: number, init: TerraErrorInit): TerraApiError {
  if (status === 400 || status === 422) return new TerraInvalidRequestError(init);
  if (status === 401) return new TerraAuthenticationError(init);
  if (status === 403) return new TerraPermissionError(init);
  if (status === 404) return new TerraNotFoundError(init);
  if (status === 409) return new TerraConflictError(init);
  if (status === 429) return new TerraRateLimitError(init);
  if (status >= 500) return new TerraServerError(init);
  return new TerraApiError(init);
}
