import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import { createTerraConnect } from "../src/client.js";
import { TerraError } from "../src/errors.js";
import { assertPublishableKey, keyEnvironment, looksLikeSecretKey } from "../src/keys.js";

/** A key exactly as the API mints it: the type prefix plus 32 random bytes in base64url. */
const minted = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;

const SECRETS = ["tw_test_sk_9f8e7d6c5b4a3f2e1d0c", "tw_live_sk_AbCdEf0123456789", "whsec_0123456789abcdef", "sk_live_51Habc"];

describe("publishable keys only", () => {
  it("refuses secret keys with SECRET_KEY_REFUSED and never echoes the key", () => {
    for (const key of SECRETS) {
      assert.throws(
        () => assertPublishableKey(key),
        (e: unknown) => e instanceof TerraError && e.code === "SECRET_KEY_REFUSED" && !e.message.includes(key) && /rotate/i.test(e.message),
        key,
      );
    }
  });

  it("refuses a secret key passed to createTerraConnect", () => {
    assert.throws(() => createTerraConnect({ publishableKey: SECRETS[0] }), (e: unknown) => (e as TerraError).code === "SECRET_KEY_REFUSED");
  });

  it("accepts publishable keys and reports their environment", () => {
    assertPublishableKey("tw_test_pk_12345678abcd");
    assertPublishableKey("tw_live_pk_ABCDEFGH1234");
    assert.equal(keyEnvironment("tw_live_pk_ABCDEFGH1234"), "live");
    assert.equal(keyEnvironment("tw_test_pk_12345678abcd"), "test");
  });

  it("rejects malformed keys as INVALID_PUBLISHABLE_KEY", () => {
    for (const key of ["", "pk_test_123", "tw_prod_pk_12345678", "tw_test_pk_<script>", 42, null]) {
      assert.throws(() => assertPublishableKey(key), (e: unknown) => (e as TerraError).code === "INVALID_PUBLISHABLE_KEY");
    }
  });
});

describe("real key formats (base64url, as the API mints them)", () => {
  it("accepts publishable keys whose secret part contains - and _", () => {
    for (const key of ["tw_test_pk_Ab-_9xYzQ1w2E3r4T5y6U7i8O9p0-LkJhGfDsA_zXcVb", "tw_live_pk_-_-_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_A"]) {
      assertPublishableKey(key);
    }
    let checked = 0;
    for (let i = 0; i < 300; i++) {
      const key = minted("tw_test_pk_");
      if (looksLikeSecretKey(key)) continue; // about 3 in 100 000 random keys contain "sk_" (the API should re-roll those)
      assertPublishableKey(key);
      checked++;
    }
    assert.ok(checked > 290);
  });

  it("refuses secret material anywhere in the string, in any case", () => {
    const bad = [
      minted("tw_test_sk_"),
      minted("tw_live_sk_"),
      `tw_test_pk_${minted("tw_live_sk_")}`, // a secret glued onto a publishable-looking prefix
      `Bearer ${minted("tw_live_sk_")}`,
      minted("whsec_"),
      `tw_test_pk_AAAAAAAAwhsec_${"B".repeat(30)}`,
      "TW_LIVE_SK_ABCDEFGH12345678",
      "x_SK_abcdefgh",
    ];
    for (const key of bad) {
      assert.equal(looksLikeSecretKey(key), true, key);
      assert.throws(() => assertPublishableKey(key), (e: unknown) => (e as TerraError).code === "SECRET_KEY_REFUSED" && !(e as Error).message.includes(key), key);
    }
    assert.equal(looksLikeSecretKey("tw_test_pk_ABCDEFGH12345678"), false);
    assert.equal(looksLikeSecretKey(undefined), false);
  });
});
