import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { randomBytes } from "node:crypto";
import { TerraWebhookSignatureError, generateTestHeader, parseSignatureHeader, safeVerifyWebhook, verifyWebhook } from "../src/webhooks.js";

// Known-answer vectors computed independently with Python's hmac module:
//   hmac.new(secret, f"{t}.{body}", sha256).hexdigest()
const SECRET = "whsec_test_5WbX2kq9N1yRr7Lp";
const ROTATED = "whsec_rotated_secret_2";
const T = 1763884800;
const BODY =
  '{"id":"evt_01JDBQ2X7P9F3K4M6N8R0T2V4W","type":"payment_intent.succeeded","data":{"object":{"id":"pi_01JDBQ2X7P9F3K4M6N8R0T2V","status":"succeeded","amount":"120.00","currency":"USD"}}}';
const SIG = "9964999aefbc7be05226e61975f4b6b8f9e450b63b4b090c6bebc8d8c36fc42b";
const SIG_ROTATED = "4c6e9214e02890039b34bc44d9ed1eb861472ada7600635cbffd81b1f7b6f430";
const HEADER = `t=${T},v1=${SIG}`;

const code = (c: string) => (e: unknown) => e instanceof TerraWebhookSignatureError && e.code === c;

describe("verifyWebhook vectors", () => {
  it("valid: accepts the known-answer signature and returns the parsed event", () => {
    const evt = verifyWebhook(BODY, HEADER, SECRET, 300, T + 10);
    assert.equal(evt.type, "payment_intent.succeeded");
    assert.equal(evt.id, "evt_01JDBQ2X7P9F3K4M6N8R0T2V4W");
  });

  it("valid: raw Buffer bodies, header arrays, extra spaces and unknown schemes are fine", () => {
    assert.ok(verifyWebhook(Buffer.from(BODY), [` t=${T} `, ` v0=dead, v1=${SIG.toUpperCase()}`], SECRET, 300, T));
  });

  it("valid: during a rotation either secret, or either of two v1 signatures, verifies", () => {
    assert.ok(verifyWebhook(BODY, `t=${T},v1=${SIG_ROTATED}`, [SECRET, ROTATED], 300, T));
    assert.ok(verifyWebhook(BODY, `t=${T},v1=${"0".repeat(64)},v1=${SIG}`, SECRET, 300, T));
  });

  it("tampered: any change to the body fails", () => {
    const tampered = BODY.replace('"120.00"', '"1.00"');
    assert.throws(() => verifyWebhook(tampered, HEADER, SECRET, 300, T), code("SIGNATURE_MISMATCH"));
    assert.throws(() => verifyWebhook(`${BODY} `, HEADER, SECRET, 300, T), code("SIGNATURE_MISMATCH"));
    // Re-serialised JSON is a different byte string: always verify the raw body.
    assert.throws(() => verifyWebhook(JSON.stringify(JSON.parse(BODY), null, 1), HEADER, SECRET, 300, T), code("SIGNATURE_MISMATCH"));
  });

  it("tampered: a signature replayed with a new timestamp fails", () => {
    assert.throws(() => verifyWebhook(BODY, `t=${T + 60},v1=${SIG}`, SECRET, 300, T + 60), code("SIGNATURE_MISMATCH"));
  });

  it("old timestamp: outside the tolerance is refused (replay), inside is accepted", () => {
    assert.throws(() => verifyWebhook(BODY, HEADER, SECRET, 300, T + 301), code("TIMESTAMP_OUT_OF_TOLERANCE"));
    assert.throws(() => verifyWebhook(BODY, HEADER, SECRET, 300, T - 301), code("TIMESTAMP_OUT_OF_TOLERANCE"));
    assert.ok(verifyWebhook(BODY, HEADER, SECRET, 300, T + 300));
    assert.throws(() => verifyWebhook(BODY, HEADER, SECRET, 60, T + 61), code("TIMESTAMP_OUT_OF_TOLERANCE"));
    // Default tolerance is 300 s against the real clock: a 2025 vector is long expired.
    assert.throws(() => verifyWebhook(BODY, HEADER, SECRET), code("TIMESTAMP_OUT_OF_TOLERANCE"));
  });

  it("wrong secret: fails, even with a fresh timestamp", () => {
    assert.throws(() => verifyWebhook(BODY, HEADER, "whsec_wrong", 300, T), code("SIGNATURE_MISMATCH"));
    assert.throws(() => verifyWebhook(BODY, HEADER, ROTATED, 300, T), code("SIGNATURE_MISMATCH"));
  });

  it("missing or malformed headers fail clearly", () => {
    assert.throws(() => verifyWebhook(BODY, undefined, SECRET, 300, T), code("NO_SIGNATURE_HEADER"));
    assert.throws(() => verifyWebhook(BODY, "", SECRET, 300, T), code("NO_SIGNATURE_HEADER"));
    for (const h of [`v1=${SIG}`, `t=${T}`, `t=abc,v1=${SIG}`, `t=${T},v1=${SIG.slice(2)}`, "garbage", `t=${T},v1=${"z".repeat(64)}`]) {
      assert.throws(() => verifyWebhook(BODY, h, SECRET, 300, T), code("MALFORMED_SIGNATURE_HEADER"), h);
    }
  });

  it("refuses parsed objects instead of the raw body", () => {
    assert.throws(() => verifyWebhook(JSON.parse(BODY), HEADER, SECRET, 300, T), TypeError);
    assert.throws(() => verifyWebhook(BODY, HEADER, "", 300, T), TypeError);
  });

  it("generateTestHeader produces headers verifyWebhook accepts", () => {
    assert.equal(generateTestHeader({ payload: BODY, secret: SECRET, timestamp: T }), HEADER);
    const now = Math.floor(Date.now() / 1000);
    assert.ok(verifyWebhook(BODY, generateTestHeader({ payload: BODY, secret: SECRET }), SECRET));
    assert.deepEqual(parseSignatureHeader(HEADER), { timestamp: T, signatures: [SIG] });
    assert.ok(now > T);
  });
});

describe("verifyWebhook: hostile headers", () => {
  it("refuses a header with two different timestamps (the sender must not pick which one is checked)", () => {
    assert.throws(() => verifyWebhook(BODY, `t=${T + 999},${HEADER}`, SECRET, 300, T), code("MALFORMED_SIGNATURE_HEADER"));
    assert.throws(() => verifyWebhook(BODY, [`t=${T}`, `t=${T + 1}`, `v1=${SIG}`], SECRET, 300, T), code("MALFORMED_SIGNATURE_HEADER"));
    assert.ok(verifyWebhook(BODY, `t=${T},t=${T},v1=${SIG}`, SECRET, 300, T), "a repeated identical t is harmless");
  });

  it("only ever throws TerraWebhookSignatureError for sender-controlled input (fuzzed)", () => {
    const alphabet = ["t", "v1", "v0", "=", ",", " ", "\t", "0", "9", "a", "f", "z", "-", "\u0000", "\u2028", ";", String(T), SIG];
    const pick = () => alphabet[randomBytes(1)[0]! % alphabet.length]!;
    const weird: unknown[] = [null, undefined, 0, 42, {}, [], [1, 2], [Symbol("x")], [{ toString: () => { throw new Error("boom"); } }], new Date(), "x".repeat(5000), `t=${"9".repeat(13)},v1=${SIG}`, `t=-1,v1=${SIG}`, `t=${T},v1=${SIG}0`];
    for (let i = 0; i < 3000; i++) weird.push(Array.from({ length: 1 + (i % 12) }, pick).join(""));
    for (const h of weird) {
      try {
        verifyWebhook(BODY, h as string, SECRET, 300, T);
      } catch (e) {
        assert.ok(e instanceof TerraWebhookSignatureError, `${String(e)} for ${typeof h === "symbol" ? "symbol" : JSON.stringify(h)}`);
      }
      const r = safeVerifyWebhook(BODY, h as string, SECRET, 300, T);
      if (!r.ok) assert.ok(["NO_SIGNATURE_HEADER", "MALFORMED_SIGNATURE_HEADER", "SIGNATURE_MISMATCH", "TIMESTAMP_OUT_OF_TOLERANCE"].includes(r.code));
    }
  });

  it("safeVerifyWebhook returns a result instead of throwing, and still throws on setup mistakes", () => {
    assert.deepEqual(safeVerifyWebhook(BODY, HEADER, SECRET, 300, T), { ok: true, event: JSON.parse(BODY) });
    const cases: [string | undefined, number, string][] = [
      [undefined, T, "NO_SIGNATURE_HEADER"],
      ["garbage", T, "MALFORMED_SIGNATURE_HEADER"],
      [`t=${T},v1=${"0".repeat(64)}`, T, "SIGNATURE_MISMATCH"],
      [HEADER, T + 301, "TIMESTAMP_OUT_OF_TOLERANCE"],
    ];
    for (const [h, now, c] of cases) {
      const r = safeVerifyWebhook(BODY, h, SECRET, 300, now);
      assert.equal(r.ok, false);
      assert.equal(!r.ok && r.code, c);
    }
    const notJson = "not json";
    assert.deepEqual(safeVerifyWebhook(notJson, generateTestHeader({ payload: notJson, secret: SECRET, timestamp: T }), SECRET, 300, T).ok, false);
    assert.throws(() => safeVerifyWebhook(BODY, HEADER, "", 300, T), TypeError);
    assert.throws(() => safeVerifyWebhook(JSON.parse(BODY), HEADER, SECRET, 300, T), TypeError);
  });

  it("matches the API's signer byte for byte (HMAC-SHA256 over t + '.' + raw body, keyed by the full whsec_ string)", async () => {
    const { createHmac } = await import("node:crypto");
    const secret = `whsec_${randomBytes(32).toString("base64url")}`;
    const body = JSON.stringify({ id: "evt_0123456789abcdefghjkmnpq", type: "invoice.paid", data: { object: { note: "caf\u00e9 \u2713" } } });
    const t = Math.floor(Date.now() / 1000);
    const apiHeader = `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex")}`;
    assert.equal(apiHeader, generateTestHeader({ payload: body, secret, timestamp: t }));
    assert.ok(verifyWebhook(Buffer.from(body, "utf8"), apiHeader, secret));
  });
});
