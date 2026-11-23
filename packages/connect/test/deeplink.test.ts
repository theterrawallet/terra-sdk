import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Window } from "happy-dom";
import { installDom } from "../../../scripts/test-dom.js";
import { CHROME_STORE_URL, PLAY_STORE_URL, buildPairingDeepLink, buildWakeDeepLink, detectPlatform, installUrl, isSafeAppLink, isWalletConnectPairingUri, openAppLink } from "../src/deeplink.js";
import { TerraError } from "../src/errors.js";

const TOPIC = "a".repeat(64);
const SYMKEY = "b".repeat(64);
const URI = `wc:${TOPIC}@2?expiryTimestamp=1763884800&relay-protocol=irn&symKey=${SYMKEY}`;

describe("deep-link URL builder", () => {
  it("builds the terrawallet:// pairing link on iOS and desktop", () => {
    const link = buildPairingDeepLink(URI, { platform: "ios" });
    assert.equal(link, `terrawallet://wc?uri=${encodeURIComponent(URI)}`);
    assert.equal(buildPairingDeepLink(URI, { platform: "desktop" }), link);
    // The app reads the inner URI back with decodeURIComponent.
    const inner = decodeURIComponent(new URL(link.replace("terrawallet://", "https://x/")).searchParams.get("uri")!);
    assert.equal(inner, URI);
  });

  it("builds an Android intent URL that falls back to Google Play", () => {
    const link = buildPairingDeepLink(URI, { platform: "android" });
    assert.ok(link.startsWith(`intent://wc?uri=${encodeURIComponent(URI)}#Intent;`));
    assert.ok(link.includes(";scheme=terrawallet;"));
    assert.ok(link.includes(";package=com.terrawallet.app;"));
    assert.ok(link.includes(`;S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};`));
    assert.ok(link.endsWith(";end"));
  });

  it("refuses anything that is not a WalletConnect v2 pairing URI", () => {
    const bad = [
      "",
      "https://evil.example",
      "javascript:alert(1)",
      `wc:${TOPIC}@1?bridge=https://x&key=${SYMKEY}`, // v1
      `wc:${TOPIC}@2?relay-protocol=irn`, // no symKey
      `wc:${TOPIC}@2?symKey=${SYMKEY}`, // no relay protocol
      `wc:${TOPIC}@2?relay-protocol=irn&symKey=${SYMKEY}#Intent;scheme=evil;end`, // smuggled intent
      `wc:${TOPIC}@2?relay-protocol=irn&symKey=${SYMKEY}&x=<script>`,
      `wc:short@2?relay-protocol=irn&symKey=${SYMKEY}`,
    ];
    for (const uri of bad) {
      assert.equal(isWalletConnectPairingUri(uri), false, uri);
      assert.throws(() => buildPairingDeepLink(uri, { platform: "ios" }), (e: unknown) => e instanceof TerraError && e.code === "INVALID_PARAMS");
    }
    assert.equal(isWalletConnectPairingUri(URI), true);
    assert.equal(isWalletConnectPairingUri(`wc:${TOPIC}@2?methods=wc_sessionAuthenticate%2Cwc_sessionPropose&relay-protocol=irn&symKey=${SYMKEY}`), true);
  });

  it("builds wake links the app accepts, dropping malformed parts", () => {
    assert.equal(buildWakeDeepLink(TOPIC, 1763884800123456), `terrawallet://wc?requestId=1763884800123456&sessionTopic=${TOPIC}`);
    assert.equal(buildWakeDeepLink(TOPIC), `terrawallet://wc?sessionTopic=${TOPIC}`);
    assert.equal(buildWakeDeepLink("not-a-topic&x=1", "1; drop"), "terrawallet://wc");
  });

  it("detects the platform, including iPadOS which reports a Mac user agent", () => {
    assert.equal(detectPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/131 Mobile", 5), "android");
    assert.equal(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari", 5), "ios");
    assert.equal(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605", 5), "ios");
    assert.equal(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/131", 0), "desktop");
    assert.equal(detectPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131", 0), "desktop");
  });

  it("points installs to the right store", () => {
    assert.equal(installUrl("android"), PLAY_STORE_URL);
    assert.match(installUrl("desktop")!, /^https:\/\/chromewebstore\.google\.com\//);
    assert.equal(installUrl("ios"), null);
  });
});

describe("openAppLink only navigates to Terra app links and https", () => {
  const good = [
    buildPairingDeepLink(URI, { platform: "ios" }),
    buildPairingDeepLink(URI, { platform: "android" }),
    buildWakeDeepLink(TOPIC, 42),
    buildWakeDeepLink(),
    PLAY_STORE_URL,
    CHROME_STORE_URL,
  ];
  const bad = [
    "javascript:alert(1)",
    "JavaScript:alert(document.domain)",
    " javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    "file:///etc/passwd",
    "http://play.google.com/store",
    "https://user:pw@evil.example/",
    "terrawallet://wc?uri=x\r\nSet-Cookie:a=b",
    "terrawallet://wc?uri=a b",
    "terrawallet://wc\u0000",
    "wc:abc@2?relay-protocol=irn",
    "intent://wc#Intent;scheme=evil;package=com.evil;end",
    "intent://wc#Intent;scheme=terrawallet;package=com.terrawallet.app.evil;end",
    // Android reads the LAST fragment: a second #Intent must not ride along behind a valid one
    "intent://wc#Intent;scheme=terrawallet;package=com.terrawallet.app;end#Intent;scheme=javascript;end",
    "intent://wc#Intent;scheme=terrawallet;package=com.terrawallet.app;S.browser_fallback_url=javascript%3Aalert(1);end",
    "",
  ];

  it("accepts exactly what the builders produce", () => {
    for (const link of good) assert.equal(isSafeAppLink(link), true, link);
    for (const link of bad) assert.equal(isSafeAppLink(link), false, JSON.stringify(link));
  });

  it("throws INVALID_PARAMS and leaves the page where it is for anything else", async () => {
    const dom = installDom(Window);
    try {
      const before = window.location.href;
      for (const link of bad) {
        assert.throws(() => openAppLink(link), (e: unknown) => e instanceof TerraError && e.code === "INVALID_PARAMS", JSON.stringify(link));
      }
      assert.equal(window.location.href, before);
    } finally {
      await dom.restore();
    }
    // Without a window (server rendering) a valid link is a no-op and a bad one still throws.
    assert.doesNotThrow(() => openAppLink(good[0]!));
    assert.throws(() => openAppLink("javascript:alert(1)"), TerraError);
  });
});
