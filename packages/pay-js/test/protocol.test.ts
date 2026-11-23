import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { TerraPayError, assertPublishableKey } from "../src/errors.js";
import { CHECKOUT_ORIGIN, buildCheckoutUrl, checkoutPath, newSessionId, parseCheckoutMessage } from "../src/protocol.js";

const SID = "0123456789abcdef0123456789abcdef";
const SOURCE = { name: "the checkout window" };
const ok = (data: Record<string, unknown>, over: Partial<{ origin: string; source: unknown }> = {}) =>
  parseCheckoutMessage({ origin: over.origin ?? CHECKOUT_ORIGIN, source: "source" in over ? over.source : SOURCE, data: { terraPay: 1, sid: SID, ...data } }, { source: SOURCE, sid: SID });

describe("publishable keys only (pay-js)", () => {
  it("refuses secret keys and webhook secrets without echoing them", () => {
    for (const key of ["tw_live_sk_abcdefgh12345678", "tw_test_sk_abcdefgh12345678", "whsec_abc123"]) {
      assert.throws(() => assertPublishableKey(key), (e: unknown) => e instanceof TerraPayError && e.code === "SECRET_KEY_REFUSED" && !e.message.includes(key));
    }
    assertPublishableKey("tw_live_pk_abcdefgh12345678");
  });
});

describe("checkout URL", () => {
  it("accepts payment intents, plans and exact pay.terrawallet.us checkout URLs", () => {
    assert.equal(checkoutPath({ paymentIntentId: "pi_ABCDEFGH23456789" }), "/c/pi_ABCDEFGH23456789");
    assert.equal(checkoutPath({ planId: "plan_ABCDEFGH" }), "/s/plan_ABCDEFGH");
    assert.equal(checkoutPath({ checkoutUrl: "https://pay.terrawallet.us/l/plink_ABCDEFGH" }), "/l/plink_ABCDEFGH");
    assert.equal(checkoutPath({ checkoutUrl: "https://pay.terrawallet.us/i/inv_ABCDEFGH?x=1#y" }), "/i/inv_ABCDEFGH");
  });

  it("refuses look-alike origins, credentials, wrong id prefixes and ambiguous input", () => {
    const bad = [
      { checkoutUrl: "http://pay.terrawallet.us/c/pi_ABCDEFGH" },
      { checkoutUrl: "https://pay.terrawallet.us.evil.example/c/pi_ABCDEFGH" },
      { checkoutUrl: "https://pay.terrawallet.us@evil.example/c/pi_ABCDEFGH" },
      { checkoutUrl: "https://user:pw@pay.terrawallet.us/c/pi_ABCDEFGH" },
      { checkoutUrl: "https://pay.terrawallet.us:8443/c/pi_ABCDEFGH" },
      { checkoutUrl: "https://evil.example/c/pi_ABCDEFGH" },
      { checkoutUrl: "https://pay.terrawallet.us/c/plan_ABCDEFGH" },
      { checkoutUrl: "https://pay.terrawallet.us/c/../admin" },
      { checkoutUrl: "javascript:alert(1)" },
      { paymentIntentId: "pi_<script>" },
      { paymentIntentId: "plan_ABCDEFGH" },
      { paymentIntentId: "pi_ABCDEFGH", planId: "plan_ABCDEFGH" },
      {},
    ];
    for (const t of bad) assert.throws(() => checkoutPath(t), (e: unknown) => (e as TerraPayError).code === "INVALID_CHECKOUT", JSON.stringify(t));
  });

  it("adds the embed mode, publishable key, session id and parent origin", () => {
    const u = new URL(buildCheckoutUrl({ paymentIntentId: "pi_ABCDEFGH" }, { publishableKey: "tw_test_pk_12345678", mode: "modal", sid: SID, parentOrigin: "https://shop.example", theme: "dark" }));
    assert.equal(u.origin, CHECKOUT_ORIGIN);
    assert.equal(u.pathname, "/c/pi_ABCDEFGH");
    assert.deepEqual(Object.fromEntries(u.searchParams), { embed: "modal", pk: "tw_test_pk_12345678", sid: SID, origin: "https://shop.example", theme: "dark" });
  });
});

describe("postMessage origin checks", () => {
  it("accepts a message from the exact checkout origin, the opened window and this session", () => {
    assert.deepEqual(ok({ type: "success", paymentIntentId: "pi_ABCDEFGH", txHash: `0x${"a".repeat(64)}`, chain: "base" }), {
      type: "success",
      status: "succeeded",
      paymentIntentId: "pi_ABCDEFGH",
      txHash: `0x${"a".repeat(64)}`,
      chain: "base",
    });
  });

  it("ignores other origins, including look-alikes and http", () => {
    for (const origin of ["https://evil.example", "http://pay.terrawallet.us", "https://pay.terrawallet.us:443.evil.example", "https://pay.terrawallet.us.evil.example", "https://PAY.terrawallet.us", "null", ""]) {
      assert.equal(ok({ type: "success" }, { origin }), null, origin);
    }
  });

  it("ignores messages from any other window, even on the right origin", () => {
    assert.equal(ok({ type: "success" }, { source: { name: "another frame" } }), null);
    assert.equal(ok({ type: "success" }, { source: null }), null);
    assert.equal(parseCheckoutMessage({ origin: CHECKOUT_ORIGIN, source: null, data: { terraPay: 1, sid: SID, type: "success" } }, { source: null, sid: SID }), null);
  });

  it("ignores a wrong session id, unknown types and non-object data", () => {
    assert.equal(ok({ type: "success", sid: "f".repeat(32) }), null);
    assert.equal(ok({ type: "navigate" }), null);
    assert.equal(ok({ type: "success", terraPay: 2 }), null);
    assert.equal(parseCheckoutMessage({ origin: CHECKOUT_ORIGIN, source: SOURCE, data: "success" }, { source: SOURCE, sid: SID }), null);
    assert.equal(parseCheckoutMessage({ origin: CHECKOUT_ORIGIN, source: SOURCE, data: [1] }, { source: SOURCE, sid: SID }), null);
  });

  it("drops unknown and malformed fields and caps text", () => {
    const m = ok({ type: "error", errorCode: "QUOTE_EXPIRED", errorMessage: `<img src=x onerror=alert(1)>\u0000${"x".repeat(400)}`, paymentIntentId: "javascript:x", evil: { __proto__: 1 }, height: 1e9 });
    assert.ok(m);
    assert.equal(m.errorCode, "QUOTE_EXPIRED");
    assert.equal(m.paymentIntentId, undefined);
    assert.equal(m.errorMessage!.length, 300);
    assert.ok(!m.errorMessage!.includes("\u0000"));
    assert.equal(m.height, 4000);
    assert.ok(!("evil" in m));
  });
});

describe("contract with the hosted checkout (pay.terrawallet.us)", () => {
  // The checkout page's own validators for the embed parameters (its readEmbed()): anything else and it treats the
  // visit as a normal one and never posts a message.
  const CHECKOUT_SID = /^[A-Za-z0-9_-]{16,64}$/;
  const CHECKOUT_PK = /^tw_(test|live)_pk_[A-Za-z0-9_-]{8,128}$/;
  const mintedPk = () => {
    for (;;) {
      const k = `tw_live_pk_${randomBytes(32).toString("base64url")}`;
      if (!/(^|_)sk_|whsec_/i.test(k)) return k;
    }
  };

  it("accepts publishable keys as the API mints them (base64url with - and _)", () => {
    const fixed = "tw_test_pk_Ab-_9xYzQ1w2E3r4T5y6U7i8O9p0-LkJhGfDsA_zXcVb";
    assertPublishableKey(fixed);
    for (let i = 0; i < 200; i++) assertPublishableKey(mintedPk());
    assert.throws(() => assertPublishableKey(`tw_test_pk_${"A".repeat(10)}_sk_${"B".repeat(29)}`), (e: unknown) => (e as TerraPayError).code === "SECRET_KEY_REFUSED");
    assert.throws(() => assertPublishableKey(`tw_test_pk_AAAAwhsec_${"B".repeat(34)}`), (e: unknown) => (e as TerraPayError).code === "SECRET_KEY_REFUSED");
  });

  it("builds URLs whose embed, pk, sid and origin pass the checkout's checks", () => {
    for (let i = 0; i < 50; i++) {
      const pk = mintedPk();
      const sid = newSessionId();
      const u = new URL(buildCheckoutUrl({ paymentIntentId: "pi_0123456789abcdefghjkmnpq" }, { publishableKey: pk, mode: i % 2 ? "popup" : "modal", sid, parentOrigin: "https://shop.example" }));
      assert.match(u.searchParams.get("sid")!, CHECKOUT_SID);
      assert.match(u.searchParams.get("pk")!, CHECKOUT_PK);
      assert.equal(u.searchParams.get("pk"), pk, "the key survives URL encoding unchanged");
      assert.ok(["popup", "modal"].includes(u.searchParams.get("embed")!));
      assert.equal(new URL(u.searchParams.get("origin")!).origin, u.searchParams.get("origin"));
    }
  });

  it("parses every message exactly as the checkout posts it", () => {
    const tx = `0x${"ab".repeat(32)}`;
    const posted: Record<string, unknown>[] = [
      { type: "ready" },
      { type: "resize", height: 640 },
      { type: "success", status: "succeeded", paymentIntentId: "pi_0123456789abcdefghjkmnpq", txHash: tx, chain: "base" },
      { type: "success", status: "processing", paymentIntentId: "pi_0123456789abcdefghjkmnpq", txHash: null, chain: null },
      { type: "expire", paymentIntentId: "pi_0123456789abcdefghjkmnpq" },
      { type: "error", errorCode: "QUOTE_FAILED", errorMessage: "No quote for this asset right now." },
      { type: "cancel" },
      { type: "close" },
    ];
    for (const m of posted) {
      const out = ok(m);
      assert.ok(out, JSON.stringify(m));
      assert.equal(out.type, m.type);
    }
    assert.deepEqual(ok(posted[3]!), { type: "success", status: "processing", paymentIntentId: "pi_0123456789abcdefghjkmnpq" });
    assert.equal(ok(posted[1]!)!.height, 640);
  });
});
