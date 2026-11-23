/**
 * Typed client for the Terra `/v1` API.
 *
 *   const terra = new Terra(process.env.TERRA_SECRET_KEY);
 *   const pi = await terra.paymentIntents.create({ amount: "120.00", currency: "USD", accepted_assets: [...] });
 *
 * - Every create sends an Idempotency-Key (yours, or a generated one), and the SAME key on every retry.
 * - 429 and 5xx responses, 409 IDEMPOTENCY_IN_PROGRESS, network errors and timeouts are retried with exponential
 *   backoff and jitter, honouring Retry-After. Non-idempotent requests without a key are never retried.
 * - The secret key is sent only to the https base URL; errors never contain it (see errors.ts `redact`).
 * - Errors expose `code`, `requestId` and `doc_url`.
 */
import { randomBytes } from "node:crypto";
import { TerraApiError, TerraConfigError, TerraConnectionError, errorForStatus } from "./errors.js";
import type {
  Invoice,
  InvoiceCreateParams,
  ListPage,
  ListParams,
  PaymentIntent,
  PaymentIntentCreateParams,
  PaymentLink,
  PaymentLinkCreateParams,
  Plan,
  PlanCreateParams,
  RequestOptions,
  Subscription,
  SubscriptionCreateParams,
  WebhookEndpoint,
  WebhookEndpointCreateParams,
} from "./types.js";

declare const __TERRA_SDK_VERSION__: string;
export const VERSION: string = typeof __TERRA_SDK_VERSION__ === "string" ? __TERRA_SDK_VERSION__ : "0.0.0-dev";

export const DEFAULT_BASE_URL = "https://terrawallet.us/api/v1";
const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_RETRY_AFTER_MS = 20_000;
/** Secret keys as the API mints them: the type prefix plus base64url (43 characters today). */
const SECRET_KEY = /^tw_(test|live)_sk_[A-Za-z0-9_-]{8,128}$/;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** https only; plain http only for a local test server. No credentials, query or fragment in the base URL. */
function parseBaseUrl(raw: unknown): URL {
  let u: URL | null = null;
  try {
    u = typeof raw === "string" && !/[\s\u0000-\u001f\u007f]/.test(raw) ? new URL(raw) : null;
  } catch {
    u = null;
  }
  if (!u || !(u.protocol === "https:" || (u.protocol === "http:" && LOCAL_HOSTS.has(u.hostname)))) {
    throw new TerraConfigError({ code: "INSECURE_BASE_URL", message: "baseUrl must be an https URL (plain http is allowed only for localhost, for local tests)." });
  }
  if (u.username || u.password || u.search || u.hash) {
    throw new TerraConfigError({ code: "INVALID_BASE_URL", message: "baseUrl must not carry credentials, a query or a fragment." });
  }
  return u;
}

export interface TerraOptions {
  /** tw_test_sk_... or tw_live_sk_... Defaults to process.env.TERRA_SECRET_KEY. */
  secretKey?: string;
  baseUrl?: string;
  /** Per attempt. Default 30000 ms. */
  timeoutMs?: number;
  /** Retries after the first attempt. Default 2. */
  maxRetries?: number;
  fetch?: typeof fetch;
  /** Appended to the User-Agent, e.g. "my-shop/1.4". */
  appInfo?: string;
  /** The SDK refuses to run in a browser, where a secret key would be public. Only for trusted server-like runtimes. */
  dangerouslyAllowBrowser?: boolean;
  /** Test hooks. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

/** A fresh idempotency key: "idk_" plus 32 random base64url characters. */
export function idempotencyKey(prefix = "idk"): string {
  return `${prefix}_${randomBytes(24).toString("base64url")}`;
}

const ID_RE = /^[a-z]{2,6}_[A-Za-z0-9]{6,64}$/;
function idPath(id: string, prefix: string): string {
  if (typeof id !== "string" || !ID_RE.test(id) || !id.startsWith(`${prefix}_`)) throw new TypeError(`Expected a ${prefix}_... id.`);
  return encodeURIComponent(id);
}

function parseRetryAfter(v: string | null): number | undefined {
  if (!v) return undefined;
  if (/^\d+(\.\d+)?$/.test(v.trim())) return Math.round(Number(v) * 1000);
  const at = Date.parse(v);
  return Number.isNaN(at) ? undefined : Math.max(0, at - Date.now());
}

interface CallOptions extends RequestOptions {
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  idempotent?: boolean;
}

export class Terra {
  readonly baseUrl: string;
  readonly environment: "test" | "live";
  readonly #key: string;
  readonly #opts: TerraOptions;
  readonly #origin: string;
  readonly #basePath: string;

  constructor(keyOrOptions?: string | TerraOptions, maybeOptions: TerraOptions = {}) {
    const opts: TerraOptions = typeof keyOrOptions === "string" ? { ...maybeOptions, secretKey: keyOrOptions } : { ...(keyOrOptions ?? {}) };
    const key = opts.secretKey ?? (typeof process !== "undefined" ? process.env?.TERRA_SECRET_KEY : undefined);
    if (typeof window !== "undefined" && typeof document !== "undefined" && !opts.dangerouslyAllowBrowser) {
      throw new TerraConfigError({ code: "BROWSER_NOT_ALLOWED", message: "The Terra server SDK must not run in a browser: your secret key would be public. In the browser, use the Terra pay-js package with a publishable key." });
    }
    if (!key) throw new TerraConfigError({ code: "MISSING_SECRET_KEY", message: "Pass your secret key (tw_test_sk_... or tw_live_sk_...) or set TERRA_SECRET_KEY." });
    if (/^tw_(test|live)_pk_/.test(key)) {
      throw new TerraConfigError({ code: "PUBLISHABLE_KEY_ON_SERVER", message: "This is a publishable key. The server API needs a secret key (tw_test_sk_... or tw_live_sk_...)." });
    }
    if (!SECRET_KEY.test(key)) {
      throw new TerraConfigError({ code: "INVALID_SECRET_KEY", message: "The secret key format is not recognised (expected tw_test_sk_... or tw_live_sk_...)." });
    }
    if (opts.appInfo !== undefined && (typeof opts.appInfo !== "string" || !/^[\x20-\x7e]{1,200}$/.test(opts.appInfo))) {
      throw new TerraConfigError({ code: "INVALID_APP_INFO", message: "appInfo must be 1 to 200 printable ASCII characters." });
    }
    const base = parseBaseUrl(opts.baseUrl ?? DEFAULT_BASE_URL);
    this.#key = key;
    this.#opts = opts;
    this.environment = key.startsWith("tw_live_") ? "live" : "test";
    this.#origin = base.origin;
    this.#basePath = base.pathname.replace(/\/+$/, "");
    this.baseUrl = this.#origin + this.#basePath;
  }

  // ------------------------------------------------------------------ resources
  readonly paymentIntents = {
    create: async (params: PaymentIntentCreateParams, o?: RequestOptions) => this.#create<PaymentIntent>("/payment_intents", params, o),
    retrieve: async (id: string, o?: RequestOptions) => this.request<PaymentIntent>("GET", `/payment_intents/${idPath(id, "pi")}`, o),
    list: async (p?: ListParams & { status?: string }, o?: RequestOptions) => this.#list<PaymentIntent>("/payment_intents", p, o),
    listAll: (p?: ListParams & { status?: string }, o?: RequestOptions) => this.#listAll<PaymentIntent>("/payment_intents", p, o),
  };

  readonly paymentLinks = {
    create: async (params: PaymentLinkCreateParams, o?: RequestOptions) => this.#create<PaymentLink>("/payment_links", params, o),
    retrieve: async (id: string, o?: RequestOptions) => this.request<PaymentLink>("GET", `/payment_links/${idPath(id, "plink")}`, o),
    list: async (p?: ListParams, o?: RequestOptions) => this.#list<PaymentLink>("/payment_links", p, o),
    listAll: (p?: ListParams, o?: RequestOptions) => this.#listAll<PaymentLink>("/payment_links", p, o),
  };

  readonly invoices = {
    create: async (params: InvoiceCreateParams, o?: RequestOptions) => this.#create<Invoice>("/invoices", params, o),
    retrieve: async (id: string, o?: RequestOptions) => this.request<Invoice>("GET", `/invoices/${idPath(id, "inv")}`, o),
    list: async (p?: ListParams, o?: RequestOptions) => this.#list<Invoice>("/invoices", p, o),
    listAll: (p?: ListParams, o?: RequestOptions) => this.#listAll<Invoice>("/invoices", p, o),
    /** Emails the invoice to the customer. */
    send: async (id: string, o?: RequestOptions) => this.request<Invoice>("POST", `/invoices/${idPath(id, "inv")}/send`, { ...o, idempotent: true, idempotencyKey: o?.idempotencyKey ?? idempotencyKey() }),
  };

  readonly plans = {
    create: async (params: PlanCreateParams, o?: RequestOptions) => this.#create<Plan>("/plans", params, o),
    retrieve: async (id: string, o?: RequestOptions) => this.request<Plan>("GET", `/plans/${idPath(id, "plan")}`, o),
    list: async (p?: ListParams, o?: RequestOptions) => this.#list<Plan>("/plans", p, o),
    listAll: (p?: ListParams, o?: RequestOptions) => this.#listAll<Plan>("/plans", p, o),
  };

  readonly subscriptions = {
    create: async (params: SubscriptionCreateParams, o?: RequestOptions) => this.#create<Subscription>("/subscriptions", params, o),
    retrieve: async (id: string, o?: RequestOptions) => this.request<Subscription>("GET", `/subscriptions/${idPath(id, "sub")}`, o),
    list: async (p?: ListParams & { status?: string }, o?: RequestOptions) => this.#list<Subscription>("/subscriptions", p, o),
    listAll: (p?: ListParams & { status?: string }, o?: RequestOptions) => this.#listAll<Subscription>("/subscriptions", p, o),
    cancel: async (id: string, o?: RequestOptions) => this.request<Subscription>("POST", `/subscriptions/${idPath(id, "sub")}/cancel`, { ...o, idempotent: true, idempotencyKey: o?.idempotencyKey ?? idempotencyKey() }),
  };

  readonly webhookEndpoints = {
    /** The response carries `secret` (whsec_...) ONCE. Store it right away. */
    create: async (params: WebhookEndpointCreateParams, o?: RequestOptions) => this.#create<WebhookEndpoint>("/webhook_endpoints", params, o),
    retrieve: async (id: string, o?: RequestOptions) => this.request<WebhookEndpoint>("GET", `/webhook_endpoints/${idPath(id, "whe")}`, o),
    list: async (p?: ListParams, o?: RequestOptions) => this.#list<WebhookEndpoint>("/webhook_endpoints", p, o),
    listAll: (p?: ListParams, o?: RequestOptions) => this.#listAll<WebhookEndpoint>("/webhook_endpoints", p, o),
    del: async (id: string, o?: RequestOptions) => this.request<{ id: string; deleted: boolean }>("DELETE", `/webhook_endpoints/${idPath(id, "whe")}`, o),
  };

  #create<T>(path: string, body: unknown, o: RequestOptions = {}): Promise<T> {
    return this.request<T>("POST", path, { ...o, body, idempotent: true, idempotencyKey: o.idempotencyKey ?? idempotencyKey() });
  }

  async #list<T>(path: string, p: (ListParams & { status?: string }) | undefined, o?: RequestOptions): Promise<ListPage<T>> {
    if (p?.limit !== undefined && (!Number.isInteger(p.limit) || p.limit < 1 || p.limit > 100)) throw new RangeError("limit must be an integer from 1 to 100.");
    return this.request<ListPage<T>>("GET", path, { ...o, query: p as CallOptions["query"] });
  }

  async *#listAll<T>(path: string, p: (ListParams & { status?: string }) | undefined, o?: RequestOptions): AsyncGenerator<T, void, undefined> {
    let cursor = p?.starting_after;
    for (;;) {
      const page = await this.#list<T>(path, { ...p, limit: p?.limit ?? 100, ...(cursor ? { starting_after: cursor } : {}) }, o);
      yield* page.data;
      if (!page.has_more || !page.next_cursor) return;
      cursor = page.next_cursor;
    }
  }

  // ------------------------------------------------------------------ transport
  /** Low-level request against the API (path relative to /v1). */
  async request<T>(method: "GET" | "POST" | "DELETE" | "PATCH", path: string, o: CallOptions = {}): Promise<T> {
    const key = o.idempotencyKey;
    if (key !== undefined && (typeof key !== "string" || key.length < 8 || key.length > 128 || /[^\x21-\x7e]/.test(key))) {
      throw new RangeError("idempotencyKey must be 8 to 128 printable ASCII characters.");
    }
    // The secret key goes only to the configured API: a path can never change the host or leave the base path.
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//") || /[\s\u0000-\u001f\u007f\\]/.test(path)) {
      throw new TypeError("path must start with a single / (relative to the /v1 base URL).");
    }
    const url = new URL(this.baseUrl + path);
    if (url.origin !== this.#origin || !(url.pathname === this.#basePath || url.pathname.startsWith(`${this.#basePath}/`))) {
      throw new TypeError("path must stay under the base URL.");
    }
    for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#key}`,
      Accept: "application/json",
      "User-Agent": `terra-sdk-node/${VERSION}${typeof process !== "undefined" && process.version ? ` node/${process.version}` : ""}${this.#opts.appInfo ? ` ${this.#opts.appInfo}` : ""}`,
    };
    if (o.body !== undefined) headers["Content-Type"] = "application/json";
    if (key) headers["Idempotency-Key"] = key;
    const body = o.body === undefined ? undefined : JSON.stringify(o.body);
    // GET and DELETE are idempotent by definition; POST and PATCH only with an Idempotency-Key.
    const canRetry = method === "GET" || method === "DELETE" || (!!key && (o.idempotent ?? true));
    const maxRetries = canRetry ? Math.max(0, o.maxRetries ?? this.#opts.maxRetries ?? 2) : 0;
    const timeoutMs = o.timeoutMs ?? this.#opts.timeoutMs ?? 30_000;
    const doFetch = this.#opts.fetch ?? globalThis.fetch;
    const sleep = this.#opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const random = this.#opts.random ?? Math.random;

    // 409 IDEMPOTENCY_IN_PROGRESS: the first attempt (say, one that timed out here) is still running on the server.
    // Asking again with the SAME key returns its result once it finishes, so it is retried like a 503.
    const retryable = (status: number | undefined, code: string) => RETRY_STATUS.has(status ?? 0) || (status === 409 && code === "IDEMPOTENCY_IN_PROGRESS" && !!key);

    for (let attempt = 0; ; attempt++) {
      let retryAfterMs: number | undefined;
      let minDelayMs = 0;
      const ctrl = new AbortController();
      const onAbort = () => ctrl.abort(o.signal?.reason);
      o.signal?.addEventListener("abort", onAbort, { once: true });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        ctrl.abort();
      }, timeoutMs);
      try {
        if (o.signal?.aborted) throw o.signal.reason ?? new Error("Aborted");
        const res = await doFetch(url, { method, headers, body, signal: ctrl.signal });
        const requestId = res.headers.get("x-request-id") ?? undefined;
        const text = await res.text();
        let json: any = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        if (res.ok) return json as T;
        const e = json?.error ?? {};
        retryAfterMs = parseRetryAfter(res.headers.get("retry-after"));
        const error = errorForStatus(res.status, {
          code: typeof e.code === "string" ? e.code.slice(0, 100) : res.status === 429 ? "RATE_LIMITED" : res.status >= 500 ? "SERVER_ERROR" : "HTTP_ERROR",
          message: typeof e.message === "string" ? e.message.slice(0, 1000) : `Terra API returned HTTP ${res.status}.`,
          status: res.status,
          requestId: typeof e.requestId === "string" ? e.requestId : requestId,
          docUrl: typeof e.doc_url === "string" ? e.doc_url : undefined,
          retryAfterSec: retryAfterMs === undefined ? undefined : Math.ceil(retryAfterMs / 1000),
          idempotencyKey: key,
        });
        if (error.code === "IDEMPOTENCY_IN_PROGRESS") minDelayMs = 1000;
        if (!retryable(res.status, error.code) || attempt >= maxRetries) throw error;
      } catch (e) {
        if (e instanceof TerraApiError) {
          if (!retryable(e.status, e.code) || attempt >= maxRetries) throw e;
        } else {
          if (o.signal?.aborted) throw e;
          const error = new TerraConnectionError({
            code: timedOut ? "TIMEOUT" : "CONNECTION_ERROR",
            message: timedOut ? `Terra API did not answer within ${timeoutMs} ms.` : "Could not reach the Terra API.",
            cause: e,
            idempotencyKey: key,
          });
          if (attempt >= maxRetries) throw error;
        }
      } finally {
        clearTimeout(timer);
        o.signal?.removeEventListener("abort", onAbort);
      }
      // Exponential backoff with "equal jitter": half fixed, half random. Retry-After wins when present.
      const cap = Math.min(8_000, 500 * 2 ** attempt);
      const backoff = Math.max(minDelayMs, cap / 2 + random() * (cap / 2));
      await sleep(retryAfterMs !== undefined ? Math.min(MAX_RETRY_AFTER_MS, Math.max(retryAfterMs, backoff)) : backoff);
    }
  }
}

/** Alias, for readers who prefer the longer name. */
export { Terra as TerraClient };
