import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { inspect } from "node:util";
import { describe, it } from "node:test";
import { Terra, idempotencyKey } from "../src/client.js";
import { TerraApiError, TerraConfigError, TerraConnectionError, TerraConflictError, TerraInvalidRequestError, TerraRateLimitError, TerraServerError } from "../src/errors.js";

const KEY = "tw_test_sk_ABCDEFGH12345678";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

/** A scripted fetch: each entry answers one attempt (a Response, an Error to throw, or "hang" until aborted). */
function scripted(steps: (Response | Error | "hang")[]) {
  const calls: Call[] = [];
  const fetch = (async (input: URL | string, init: RequestInit) => {
    calls.push({ url: String(input), method: String(init.method), headers: { ...(init.headers as Record<string, string>) }, body: init.body as string | undefined });
    const step = steps.shift();
    if (!step) throw new Error("unexpected extra request");
    if (step === "hang") {
      return new Promise((_r, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))));
    }
    if (step instanceof Error) throw step;
    return step;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const PI = { id: "pi_ABCDEFGH12345678", status: "requires_payment", checkout_url: "https://pay.terrawallet.us/c/pi_ABCDEFGH12345678", amount: "120.00", currency: "USD", quotes: [] };
const CREATE = { amount: "120.00", currency: "USD", accepted_assets: [{ chain: "base", symbol: "USDC" }] };

function client(steps: (Response | Error | "hang")[], extra: Partial<ConstructorParameters<typeof Terra>[1]> = {}) {
  const f = scripted(steps);
  const sleeps: number[] = [];
  const terra = new Terra(KEY, { fetch: f.fetch, sleep: async (ms) => void sleeps.push(ms), random: () => 0.5, ...extra });
  return { terra, calls: f.calls, sleeps };
}

describe("server client: idempotency", () => {
  it("sends a generated Idempotency-Key on creates and reuses the SAME key on every retry", async () => {
    const { terra, calls } = client([json(503, { error: { code: "UNAVAILABLE", message: "busy" } }), new TypeError("fetch failed"), json(200, PI)]);
    const pi = await terra.paymentIntents.create(CREATE);
    assert.equal(pi.id, PI.id);
    assert.equal(calls.length, 3);
    const keys = calls.map((c) => c.headers["Idempotency-Key"]);
    assert.match(keys[0]!, /^idk_[A-Za-z0-9_-]{32}$/);
    assert.ok(keys.every((k) => k === keys[0]));
    assert.equal(calls[0]!.headers.Authorization, `Bearer ${KEY}`);
    assert.equal(calls[0]!.url, "https://terrawallet.us/api/v1/payment_intents");
    assert.deepEqual(JSON.parse(calls[0]!.body!), CREATE);
  });

  it("uses the caller's idempotency key verbatim, and a new call gets a new generated key", async () => {
    const { terra, calls } = client([json(200, PI), json(200, PI), json(200, PI)]);
    await terra.paymentIntents.create(CREATE, { idempotencyKey: "order-1042-checkout" });
    await terra.paymentIntents.create(CREATE);
    await terra.paymentIntents.create(CREATE);
    assert.equal(calls[0]!.headers["Idempotency-Key"], "order-1042-checkout");
    assert.notEqual(calls[1]!.headers["Idempotency-Key"], calls[2]!.headers["Idempotency-Key"]);
  });

  it("rejects idempotency keys outside 8..128 printable characters before sending", async () => {
    const { terra, calls } = client([]);
    for (const k of ["short", "x".repeat(129), "has space key", "tab\tkey12345"]) {
      await assert.rejects(terra.paymentIntents.create(CREATE, { idempotencyKey: k }), RangeError);
    }
    assert.equal(calls.length, 0);
  });

  it("surfaces IDEMPOTENCY_KEY_REUSED as a conflict, without retrying", async () => {
    const { terra, calls } = client([json(409, { error: { code: "IDEMPOTENCY_KEY_REUSED", message: "Same key, different body.", requestId: "req_abc12345" } })]);
    await assert.rejects(terra.paymentIntents.create(CREATE, { idempotencyKey: "order-1042-checkout" }), (e: unknown) => e instanceof TerraConflictError && e.code === "IDEMPOTENCY_KEY_REUSED");
    assert.equal(calls.length, 1);
  });

  it("idempotencyKey() makes unique, valid keys", () => {
    const a = idempotencyKey();
    const b = idempotencyKey();
    assert.notEqual(a, b);
    assert.ok(a.length >= 8 && a.length <= 128);
  });
});

describe("server client: retries", () => {
  it("retries 429 honouring Retry-After, and 5xx with exponential backoff and jitter", async () => {
    const { terra, calls, sleeps } = client([
      json(429, { error: { code: "RATE_LIMITED", message: "slow down" } }, { "retry-after": "3" }),
      json(502, { error: { code: "BAD_GATEWAY", message: "bad gateway" } }),
      json(200, PI),
    ]);
    await terra.paymentIntents.retrieve(PI.id);
    assert.equal(calls.length, 3);
    assert.equal(calls[0]!.method, "GET");
    // attempt 0: Retry-After 3 s wins over the 250..500 ms backoff; attempt 1: cap 1000 ms -> 500 + 0.5 * 500
    assert.deepEqual(sleeps, [3000, 750]);
  });

  it("keeps jittered delays inside [cap/2, cap] and caps Retry-After at 20 s", async () => {
    for (const r of [0, 0.999]) {
      const { terra, sleeps } = client([json(500, {}), json(500, {}), json(200, PI)], { random: () => r, maxRetries: 2 });
      await terra.paymentIntents.retrieve(PI.id);
      assert.ok(sleeps[0]! >= 250 && sleeps[0]! <= 500, String(sleeps[0]));
      assert.ok(sleeps[1]! >= 500 && sleeps[1]! <= 1000, String(sleeps[1]));
    }
    const { terra, sleeps } = client([json(429, {}, { "retry-after": "3600" }), json(200, PI)]);
    await terra.paymentIntents.retrieve(PI.id);
    assert.deepEqual(sleeps, [20000]);
  });

  it("gives up after maxRetries with a typed error exposing code, requestId and doc_url", async () => {
    const { terra, calls } = client([json(503, {}, { "x-request-id": "req_first123" }), json(503, {}), json(503, { error: { code: "UNAVAILABLE", message: "Maintenance.", requestId: "req_last1234" } })]);
    await assert.rejects(terra.paymentIntents.retrieve(PI.id), (e: unknown) => {
      assert.ok(e instanceof TerraServerError);
      assert.equal(e.status, 503);
      assert.equal(e.code, "UNAVAILABLE");
      assert.equal(e.requestId, "req_last1234");
      assert.equal(e.doc_url, "https://developers.terrawallet.us/docs/errors#unavailable");
      assert.equal(e.docUrl, e.doc_url);
      return true;
    });
    assert.equal(calls.length, 3);
  });

  it("does not retry client errors, and takes requestId from the header when the body has none", async () => {
    const { terra, calls } = client([json(400, { error: { code: "INVALID_REQUEST", message: "amount must be a decimal string" } }, { "x-request-id": "req_hdr12345" })]);
    await assert.rejects(terra.paymentIntents.create(CREATE), (e: unknown) => e instanceof TerraInvalidRequestError && e.code === "INVALID_REQUEST" && e.requestId === "req_hdr12345");
    assert.equal(calls.length, 1);
  });

  it("times out each attempt and retries; the final error is TIMEOUT", async () => {
    const { terra, calls } = client(["hang", "hang"], { timeoutMs: 20, maxRetries: 1 });
    await assert.rejects(terra.paymentIntents.retrieve(PI.id), (e: unknown) => e instanceof TerraConnectionError && e.code === "TIMEOUT");
    assert.equal(calls.length, 2);
  });

  it("never retries a POST that has no idempotency key", async () => {
    const { terra, calls } = client([json(503, {})]);
    await assert.rejects(terra.request("POST", "/payment_intents", { body: CREATE }), TerraServerError);
    assert.equal(calls.length, 1);
  });

  it("rate-limit errors report retryAfterSec", async () => {
    const { terra } = client([json(429, { error: { code: "RATE_LIMITED", message: "Too many requests." } }, { "retry-after": "7" })], { maxRetries: 0 });
    await assert.rejects(terra.paymentIntents.list(), (e: unknown) => e instanceof TerraRateLimitError && e.retryAfterSec === 7);
  });
});

describe("server client: configuration and paths", () => {
  it("refuses publishable keys, malformed keys, browsers and non-https base URLs; never echoes the key", () => {
    const check = (fn: () => unknown, codeName: string) =>
      assert.throws(fn, (e: unknown) => e instanceof TerraConfigError && e.code === codeName && !e.message.includes("ABCDEFGH12345678"));
    check(() => new Terra("tw_test_pk_ABCDEFGH12345678"), "PUBLISHABLE_KEY_ON_SERVER");
    check(() => new Terra("sk_ABCDEFGH12345678"), "INVALID_SECRET_KEY");
    check(() => new Terra(KEY, { baseUrl: "http://api.example.com/v1" }), "INSECURE_BASE_URL");
    const g = globalThis as Record<string, unknown>;
    g.window = {};
    g.document = {};
    try {
      check(() => new Terra(KEY), "BROWSER_NOT_ALLOWED");
    } finally {
      delete g.window;
      delete g.document;
    }
    assert.equal(new Terra(KEY, { baseUrl: "http://localhost:4000/api/v1" }).environment, "test");
  });

  it("validates ids before building paths (no path injection)", async () => {
    const { terra, calls } = client([]);
    for (const bad of ["../keys", "pi_../../x", "plan_ABCDEFGH", "pi_ABC"]) await assert.rejects(terra.paymentIntents.retrieve(bad), TypeError);
    assert.equal(calls.length, 0);
  });

  it("lists with cursor params and auto-paginates with listAll", async () => {
    const page1 = { data: [{ ...PI, id: "pi_AAAAAAAA" }, { ...PI, id: "pi_BBBBBBBB" }], has_more: true, next_cursor: "pi_BBBBBBBB" };
    const page2 = { data: [{ ...PI, id: "pi_CCCCCCCC" }], has_more: false, next_cursor: null };
    const { terra, calls } = client([json(200, page1), json(200, page2)]);
    const ids: string[] = [];
    for await (const pi of terra.paymentIntents.listAll({ limit: 2 })) ids.push(pi.id);
    assert.deepEqual(ids, ["pi_AAAAAAAA", "pi_BBBBBBBB", "pi_CCCCCCCC"]);
    assert.equal(new URL(calls[1]!.url).searchParams.get("starting_after"), "pi_BBBBBBBB");
    await assert.rejects(terra.paymentIntents.list({ limit: 500 }), RangeError);
  });

  it("every error is a TerraApiError subclass", async () => {
    const { terra } = client([json(404, { error: { code: "NOT_FOUND", message: "No such payment intent." } })]);
    await assert.rejects(terra.paymentIntents.retrieve(PI.id), (e: unknown) => e instanceof TerraApiError && e.status === 404);
  });
});

/** A secret key exactly as the API mints it: type prefix + 32 random bytes in base64url (often with - and _). */
const mintedSecret = () => `tw_test_sk_${randomBytes(32).toString("base64url")}`;

describe("server client: real keys and TLS", () => {
  it("accepts secret keys as the API mints them (base64url with - and _)", () => {
    for (const k of ["tw_live_sk_Ab-_9xYzQ1w2E3r4T5y6U7i8O9p0-LkJhGfDsA_zXcVb", ...Array.from({ length: 200 }, mintedSecret)]) {
      assert.ok(["test", "live"].includes(new Terra(k).environment), k);
    }
  });

  it("sends the key only over https (http only for localhost), with no credentials, query or fragment", () => {
    const code = (baseUrl: string) => {
      try {
        new Terra(KEY, { baseUrl });
        return "OK";
      } catch (e) {
        return (e as TerraConfigError).code;
      }
    };
    for (const u of ["http://api.example.com/v1", "http://localhost.evil.example/v1", "http://127.0.0.1.nip.io/v1", "http://10.0.0.5/v1", "ftp://terrawallet.us/v1", "javascript:alert(1)", "//terrawallet.us/api/v1", "terrawallet.us/api/v1", "https://terrawallet.us/api/v1\r\nX: y"]) {
      assert.equal(code(u), "INSECURE_BASE_URL", u);
    }
    for (const u of ["https://user:pw@terrawallet.us/api/v1", "https://terrawallet.us/api/v1?x=1", "https://terrawallet.us/api/v1#frag"]) assert.equal(code(u), "INVALID_BASE_URL", u);
    for (const u of ["https://terrawallet.us/api/v1", "HTTPS://TerraWallet.us/api/v1/", "http://localhost:4000/api/v1", "http://127.0.0.1:4000/v1", "http://[::1]:4000/v1"]) assert.equal(code(u), "OK", u);
    assert.equal(new Terra(KEY, { baseUrl: "HTTPS://TerraWallet.us/api/v1/" }).baseUrl, "https://terrawallet.us/api/v1");
  });

  it("a request path can never move the key to another host or out of the base path", async () => {
    const f = scripted([json(200, PI)]);
    const terra = new Terra(KEY, { baseUrl: "https://api.example", fetch: f.fetch });
    for (const bad of [".evil.example/x", "@evil.example/x", "//evil.example/x", "evil", "/\\evil.example", "/a b", "/x\r\nHost: evil"]) {
      await assert.rejects(terra.request("GET", bad), TypeError, bad);
    }
    const nested = new Terra(KEY, { baseUrl: "https://api.example/api/v1", fetch: f.fetch });
    await assert.rejects(nested.request("GET", "/../../admin"), TypeError);
    assert.equal(f.calls.length, 0);
    await nested.request("GET", "/payment_intents/pi_ABCDEFGH12345678");
    assert.equal(f.calls[0]!.url, "https://api.example/api/v1/payment_intents/pi_ABCDEFGH12345678");
  });

  it("refuses an appInfo that could not be sent as a header", () => {
    for (const appInfo of ["shop/1.0\r\nX-Evil: 1", "", "x".repeat(201), "caf\u00e9/1"]) {
      assert.throws(() => new Terra(KEY, { appInfo }), (e: unknown) => (e as TerraConfigError).code === "INVALID_APP_INFO", JSON.stringify(appInfo));
    }
  });
});

describe("server client: no double creates after a timeout", () => {
  it("retries 409 IDEMPOTENCY_IN_PROGRESS with the same key, waiting at least a second", async () => {
    const inProgress = json(409, { error: { code: "IDEMPOTENCY_IN_PROGRESS", message: "A request with this Idempotency-Key is still being processed." } });
    const { terra, calls, sleeps } = client(["hang", inProgress, json(200, PI)], { timeoutMs: 20 });
    const pi = await terra.paymentIntents.create(CREATE);
    assert.equal(pi.id, PI.id);
    assert.equal(calls.length, 3);
    assert.equal(new Set(calls.map((c) => c.headers["Idempotency-Key"])).size, 1, "one key for the whole call");
    assert.ok(sleeps[1]! >= 1000, String(sleeps));
  });

  it("does not retry IDEMPOTENCY_KEY_REUSED, nor IN_PROGRESS on a request without a key", async () => {
    const reused = json(409, { error: { code: "IDEMPOTENCY_KEY_REUSED", message: "x" } });
    const a = client([reused]);
    await assert.rejects(a.terra.paymentIntents.create(CREATE), TerraConflictError);
    assert.equal(a.calls.length, 1);
    const b = client([json(409, { error: { code: "IDEMPOTENCY_IN_PROGRESS", message: "x" } })]);
    await assert.rejects(b.terra.request("POST", "/payment_intents", { body: CREATE }), TerraConflictError);
    assert.equal(b.calls.length, 1);
  });

  it("every failure of a create carries its idempotency key, so the caller retries with the same one", async () => {
    const { terra, calls } = client(["hang", "hang", "hang", json(200, PI)], { timeoutMs: 10 });
    let first: TerraConnectionError | undefined;
    await assert.rejects(terra.paymentIntents.create(CREATE), (e: unknown) => {
      first = e as TerraConnectionError;
      return e instanceof TerraConnectionError && e.code === "TIMEOUT";
    });
    const sent = calls[0]!.headers["Idempotency-Key"];
    assert.equal(first!.idempotencyKey, sent);
    await terra.paymentIntents.create(CREATE, { idempotencyKey: first!.idempotencyKey });
    assert.equal(calls[3]!.headers["Idempotency-Key"], sent);

    const s = client([json(503, {}), json(503, {}), json(503, {})]);
    await assert.rejects(s.terra.subscriptions.create({ plan: "plan_ABCDEFGH", customer_email: "a@example.com" }), (e: unknown) => (e as TerraServerError).idempotencyKey === s.calls[0]!.headers["Idempotency-Key"]);
  });
});

describe("server client: secrets never reach errors or logs", () => {
  const SECRET = mintedSecret();
  const WHSEC = `whsec_${randomBytes(32).toString("base64url")}`;

  it("redacts keys from a custom fetch's errors (and their causes) and from API error messages", async () => {
    const leaky = new Error(`proxy refused POST with Authorization: Bearer ${SECRET}`, { cause: Object.assign(new Error(`upstream said ${WHSEC} and ${SECRET}`), { code: "ECONNRESET" }) });
    const f = scripted([leaky, json(400, { error: { code: "INVALID_REQUEST", message: `bad key ${SECRET}` } })]);
    const terra = new Terra(SECRET, { fetch: f.fetch, maxRetries: 0 });
    const errors: unknown[] = [];
    await terra.paymentIntents.retrieve("pi_ABCDEFGH12345678").catch((e) => errors.push(e));
    await terra.paymentIntents.retrieve("pi_ABCDEFGH12345678").catch((e) => errors.push(e));
    assert.equal(errors.length, 2);
    const conn = errors[0] as TerraConnectionError;
    assert.equal(conn.code, "CONNECTION_ERROR");
    assert.equal((conn.cause as { code?: string }).code, undefined, "the wrapper error had no code");
    assert.equal(((conn.cause as Error).cause as { code?: string }).code, "ECONNRESET", "useful details survive");
    assert.notEqual(conn.cause, leaky, "the raw error is never attached");
    for (const e of errors) {
      const text = [inspect(e, { depth: 10, showHidden: true }), String((e as Error).stack), JSON.stringify(e)].join("\n");
      assert.ok(!text.includes(SECRET) && !text.includes(SECRET.slice(11)), "secret key leaked");
      assert.ok(!text.includes(WHSEC.slice(6)), "webhook secret leaked");
    }
    assert.match((errors[1] as Error).message, /tw_test_sk_\[redacted\]/);
  });

  it("keeps the key out of inspect() and JSON of the client, and writes nothing to the console", async () => {
    const out: unknown[][] = [];
    const saved = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
    for (const k of Object.keys(saved) as (keyof typeof saved)[]) console[k] = (...a: unknown[]) => void out.push(a);
    try {
      const f = scripted([json(200, PI), json(500, { error: { code: "X", message: "boom" } })]);
      const terra = new Terra(SECRET, { fetch: f.fetch, maxRetries: 0 });
      await terra.paymentIntents.create(CREATE);
      await terra.paymentIntents.retrieve(PI.id).catch(() => {});
      for (const text of [inspect(terra, { depth: 10, showHidden: true }), JSON.stringify(terra)]) assert.ok(!text.includes(SECRET.slice(11)), text.slice(0, 200));
    } finally {
      Object.assign(console, saved);
    }
    assert.deepEqual(out, []);
  });
});
