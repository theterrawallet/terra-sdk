import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { Window } from "happy-dom";
import { installDom, type InstalledDom } from "../../../scripts/test-dom.js";
import { IFRAME_SANDBOX, TerraPay, type CheckoutResult } from "../src/index.js";
import { CHECKOUT_ORIGIN } from "../src/protocol.js";

let dom: InstalledDom<Window>;
let roots: ShadowRoot[];
let restoreShadow: () => void;
let handles: { close(): void }[] = [];
const PK = "tw_test_pk_ABCDEFGH12345678";

beforeEach(() => {
  dom = installDom(Window);
  // Capture closed shadow roots so the test can look inside (production code never exposes them).
  roots = [];
  const proto = (window as unknown as { Element: typeof Element }).Element.prototype;
  const orig = proto.attachShadow;
  proto.attachShadow = function (this: Element, init: ShadowRootInit) {
    const r = orig.call(this, init);
    roots.push(r);
    return r;
  };
  restoreShadow = () => (proto.attachShadow = orig);
});
afterEach(async () => {
  for (const h of handles) h.close();
  handles = [];
  restoreShadow();
  await dom.restore();
});

/** happy-dom does not load iframes here (no network in tests), so give the iframe a stand-in window. */
function frameWindowOf(iframe: HTMLIFrameElement): object {
  const fake = { stand: "in" };
  Object.defineProperty(iframe, "contentWindow", { value: fake, configurable: true });
  return fake;
}

function post(source: unknown, data: unknown, origin = CHECKOUT_ORIGIN) {
  window.dispatchEvent(new MessageEvent("message", { origin, data, source: source as MessageEventSource }));
}

describe("TerraPay.open in a sandboxed modal", () => {
  it("refuses a secret key before showing anything", () => {
    assert.throws(() => TerraPay.open({ paymentIntentId: "pi_ABCDEFGH", publishableKey: "tw_live_sk_ABCDEFGH12345678" }), /secret key/);
    assert.equal(document.querySelector("terra-pay-checkout"), null);
  });

  it("renders an iframe with the exact sandbox, and only trusts its own origin, window and session", async () => {
    const calls: string[] = [];
    let success: CheckoutResult | undefined;
    const handle = TerraPay.open({
      paymentIntentId: "pi_ABCDEFGH",
      publishableKey: PK,
      mode: "modal",
      onSuccess: (r) => {
        calls.push("success");
        success = r;
      },
      onCancel: () => calls.push("cancel"),
      onClose: (r) => calls.push(`close:${r.status}`),
    });
    handles.push(handle);
    assert.equal(handle.mode, "modal");
    const iframe = roots[0]!.querySelector("iframe")!;
    assert.equal(iframe.getAttribute("sandbox"), IFRAME_SANDBOX);
    assert.equal(IFRAME_SANDBOX, "allow-scripts allow-same-origin allow-popups allow-forms");
    for (const never of ["allow-top-navigation", "allow-top-navigation-by-user-activation", "allow-popups-to-escape-sandbox", "allow-modals", "allow-downloads"]) {
      assert.ok(!IFRAME_SANDBOX.split(" ").includes(never), never);
    }
    const src = new URL(iframe.src);
    assert.equal(src.origin, CHECKOUT_ORIGIN);
    assert.equal(src.searchParams.get("pk"), PK);
    assert.equal(src.searchParams.get("origin"), "https://shop.example");
    const sid = src.searchParams.get("sid")!;
    assert.match(sid, /^[0-9a-f]{32}$/);
    // The visible origin label is fixed text in the closed shadow root.
    assert.equal(roots[0]!.querySelector(".origin")?.textContent, "pay.terrawallet.us");

    const frameWin = frameWindowOf(iframe);
    post(frameWin, { terraPay: 1, sid, type: "success", paymentIntentId: "pi_ABCDEFGH" }, "https://evil.example");
    post({}, { terraPay: 1, sid, type: "success", paymentIntentId: "pi_ABCDEFGH" });
    post(frameWin, { terraPay: 1, sid: "0".repeat(32), type: "success", paymentIntentId: "pi_ABCDEFGH" });
    assert.deepEqual(calls, []);

    post(frameWin, { terraPay: 1, sid, type: "success", paymentIntentId: "pi_ABCDEFGH", chain: "base" });
    assert.deepEqual(success, { status: "succeeded", paymentIntentId: "pi_ABCDEFGH", chain: "base" });
    post(frameWin, { terraPay: 1, sid, type: "close" });
    assert.deepEqual(await handle.closed, { status: "succeeded", paymentIntentId: "pi_ABCDEFGH", chain: "base" });
    assert.deepEqual(calls, ["success", "close:succeeded"]);
    assert.equal(document.querySelector("terra-pay-checkout"), null);
  });

  it("Escape cancels; onExpire fires on an expiry message", async () => {
    const calls: string[] = [];
    const handle = TerraPay.open({ paymentIntentId: "pi_ABCDEFGH", publishableKey: PK, mode: "modal", onCancel: () => calls.push("cancel"), onExpire: () => calls.push("expire") });
    handles.push(handle);
    const iframe = roots[0]!.querySelector("iframe")!;
    const sid = new URL(iframe.src).searchParams.get("sid")!;
    post(frameWindowOf(iframe), { terraPay: 1, sid, type: "expire", paymentIntentId: "pi_ABCDEFGH" });
    roots[0]!.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true }));
    const r = await handle.closed;
    assert.equal(r.status, "expired");
    assert.deepEqual(calls, ["expire"]);
  });
});

describe("TerraPay.open in a popup", () => {
  it("trusts only the popup it opened and treats a closed window as a cancel", async () => {
    const popup = { closed: false, focus() {}, close() { this.closed = true; } };
    let openedUrl = "";
    (window as unknown as { open: unknown }).open = (url: string) => {
      openedUrl = url;
      return popup;
    };
    const calls: string[] = [];
    const handle = TerraPay.open({ planId: "plan_ABCDEFGH", publishableKey: PK, mode: "popup", onCancel: () => calls.push("cancel"), onSuccess: () => calls.push("success") });
    handles.push(handle);
    assert.equal(handle.mode, "popup");
    const u = new URL(openedUrl);
    assert.equal(u.origin + u.pathname, `${CHECKOUT_ORIGIN}/s/plan_ABCDEFGH`);
    assert.equal(u.searchParams.get("embed"), "popup");
    const sid = u.searchParams.get("sid")!;
    post({}, { terraPay: 1, sid, type: "success" });
    assert.deepEqual(calls, []);
    popup.closed = true;
    const r = await handle.closed;
    assert.equal(r.status, "canceled");
    assert.deepEqual(calls, ["cancel"]);
  });

  it("falls back to the modal when the popup is blocked in auto mode", () => {
    (window as unknown as { open: unknown }).open = () => null;
    const handle = TerraPay.open({ paymentIntentId: "pi_ABCDEFGH", publishableKey: PK });
    assert.equal(handle.mode, "modal");
    handle.close();
  });
});

/** A phone: narrow viewport, touch, iPhone user agent (the closed shadow roots are captured again). */
async function asPhone() {
  await dom.restore();
  restoreShadow();
  dom = installDom(Window, { width: 390, maxTouchPoints: 5, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1" });
  const proto = (window as unknown as { Element: typeof Element }).Element.prototype;
  const orig = proto.attachShadow;
  proto.attachShadow = function (this: Element, init: ShadowRootInit) {
    const r = orig.call(this, init);
    roots.push(r);
    return r;
  };
  restoreShadow = () => (proto.attachShadow = orig);
  assert.equal(matchMedia("(max-width: 640px)").matches, true, "phone-sized viewport");
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("TerraPay.open against the live hosted checkout", () => {
  it("auto mode opens the sandboxed modal on phones (the checkout allows framing per merchant origin)", async () => {
    await asPhone();
    let opened = 0;
    (window as unknown as { open: unknown }).open = () => (opened++, null);
    const handle = TerraPay.open({ paymentIntentId: "pi_ABCDEFGH", publishableKey: PK });
    handles.push(handle);
    assert.equal(handle.mode, "modal");
    assert.equal(opened, 0, "no window is opened");
    const iframe = roots[0]!.querySelector("iframe")!;
    assert.equal(iframe.getAttribute("sandbox"), IFRAME_SANDBOX);
    const src = new URL(iframe.src);
    assert.equal(src.searchParams.get("embed"), "modal");
    assert.equal(src.searchParams.get("origin"), "https://shop.example");
  });

  it("auto mode opens a popup on desktops (wallet extensions do not inject into frames), with a name unrelated to the session", () => {
    const popup = { closed: false, focus() {}, close() { this.closed = true; } };
    let name = "";
    let url = "";
    (window as unknown as { open: unknown }).open = (u: string, n: string) => ((url = u), (name = n), popup);
    const handle = TerraPay.open({ paymentIntentId: "pi_ABCDEFGH", publishableKey: PK });
    handles.push(handle);
    assert.equal(handle.mode, "popup");
    const sid = new URL(url).searchParams.get("sid")!;
    // The window name is readable by every later page in that window: it must not carry the session id.
    assert.match(name, /^terra_pay_[0-9a-f]{12}$/);
    assert.ok(!name.includes(sid) && !sid.includes(name.slice(10)));
  });

  it("reports a checkout that never says ready (refused frame, origin not allowed) through onError", async () => {
    const errors: { code: string; message: string }[] = [];
    const handle = TerraPay.open({ paymentIntentId: "pi_ABCDEFGH", publishableKey: PK, mode: "modal", readyTimeoutMs: 20, onError: (e) => errors.push({ code: e.code, message: e.message }) });
    handles.push(handle);
    await wait(40);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.code, "CHECKOUT_ERROR");
    assert.match(errors[0]!.message, /did not connect/);
    assert.match(errors[0]!.message, /allowed origin of the publishable key/);
    assert.match(errors[0]!.message, /new window/);
    assert.match(roots[0]!.querySelector(".loading")!.textContent!, /could not open here/);
  });

  it("on a phone, a modal with no ready in time falls back to a popup from the shopper's tap, same session", async () => {
    await asPhone();
    const errors: string[] = [];
    const calls: string[] = [];
    let opens = 0;
    let url = "";
    const popup = { closed: false, focus() {}, close() { this.closed = true; } };
    (window as unknown as { open: unknown }).open = (u: string) => (opens++, (url = u), popup);
    const handle = TerraPay.open({
      paymentIntentId: "pi_ABCDEFGH",
      publishableKey: PK,
      readyTimeoutMs: 20,
      onError: (e) => errors.push(e.code),
      onSuccess: () => calls.push("success"),
      onReady: () => calls.push("ready"),
    });
    handles.push(handle);
    assert.equal(handle.mode, "modal");
    const iframe = roots[0]!.querySelector("iframe")!;
    const sid = new URL(iframe.src).searchParams.get("sid")!;
    const frameWin = frameWindowOf(iframe);
    await wait(40);
    assert.deepEqual(errors, ["CHECKOUT_ERROR"]);
    assert.equal(opens, 0, "never opened from a timer (a popup needs the shopper's gesture)");
    const go = [...roots[0]!.querySelectorAll("button")].find((b) => /new window/.test(b.textContent ?? ""))!;
    assert.ok(go, "a Continue in a new window button");
    go.click();
    assert.equal(opens, 1);
    assert.equal(handle.mode, "popup");
    const u = new URL(url);
    assert.equal(u.searchParams.get("embed"), "popup");
    assert.equal(u.searchParams.get("sid"), sid, "the same session continues");
    assert.equal(roots[0]!.querySelector("iframe"), null, "the refused frame is gone");
    assert.match(roots[0]!.querySelector("h2")!.textContent!, /Terra Pay window/);
    // From now on only the popup is trusted.
    post(frameWin, { terraPay: 1, sid, type: "success", paymentIntentId: "pi_ABCDEFGH" });
    assert.deepEqual(calls, []);
    post(popup, { terraPay: 1, sid, type: "ready" });
    post(popup, { terraPay: 1, sid, type: "success", paymentIntentId: "pi_ABCDEFGH" });
    assert.deepEqual(calls, ["ready", "success"]);
    await wait(40);
    assert.deepEqual(errors, ["CHECKOUT_ERROR"], "the popup said ready in time");
    popup.closed = true;
    assert.equal((await handle.closed).status, "succeeded");
  });

  it("a blocked fallback popup is reported and the shopper can tap again", async () => {
    await asPhone();
    const errors: string[] = [];
    let allow = false;
    const popup = { closed: false, focus() {}, close() { this.closed = true; } };
    (window as unknown as { open: unknown }).open = () => (allow ? popup : null);
    const handle = TerraPay.open({ paymentIntentId: "pi_ABCDEFGH", publishableKey: PK, readyTimeoutMs: 20, onError: (e) => errors.push(e.code) });
    handles.push(handle);
    await wait(40);
    const go = () => [...roots[0]!.querySelectorAll("button")].find((b) => /new window/.test(b.textContent ?? ""));
    go()!.click();
    assert.deepEqual(errors, ["CHECKOUT_ERROR", "POPUP_BLOCKED"]);
    assert.equal(handle.mode, "modal");
    allow = true;
    go()!.click();
    assert.equal(handle.mode, "popup");
  });

  it("on a phone, a ready message in time keeps the modal (no error, no fallback)", async () => {
    await asPhone();
    const errors: unknown[] = [];
    const handle = TerraPay.open({ paymentIntentId: "pi_ABCDEFGH", publishableKey: PK, readyTimeoutMs: 30, onError: (e) => errors.push(e) });
    handles.push(handle);
    const iframe = roots[0]!.querySelector("iframe")!;
    post(frameWindowOf(iframe), { terraPay: 1, sid: new URL(iframe.src).searchParams.get("sid")!, type: "ready" });
    await wait(60);
    assert.deepEqual(errors, []);
    assert.equal(handle.mode, "modal");
    assert.ok(![...roots[0]!.querySelectorAll("button")].some((b) => /new window/.test(b.textContent ?? "")));
  });

  it("a ready message in time cancels the watchdog", async () => {
    const errors: unknown[] = [];
    let readyCalls = 0;
    const handle = TerraPay.open({ paymentIntentId: "pi_ABCDEFGH", publishableKey: PK, mode: "modal", readyTimeoutMs: 30, onError: (e) => errors.push(e), onReady: () => readyCalls++ });
    handles.push(handle);
    const iframe = roots[0]!.querySelector("iframe")!;
    const sid = new URL(iframe.src).searchParams.get("sid")!;
    post(frameWindowOf(iframe), { terraPay: 1, sid, type: "ready" });
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(readyCalls, 1);
    assert.deepEqual(errors, []);
    assert.ok(roots[0]!.querySelector(".loading")!.hasAttribute("hidden"));
  });

  it("ignores every message once the checkout has closed", async () => {
    const calls: string[] = [];
    const popup = { closed: false, focus() {}, close() { this.closed = true; } };
    let url = "";
    (window as unknown as { open: unknown }).open = (u: string) => ((url = u), popup);
    const handle = TerraPay.open({ paymentIntentId: "pi_ABCDEFGH", publishableKey: PK, mode: "popup", onSuccess: () => calls.push("success") });
    const sid = new URL(url).searchParams.get("sid")!;
    handle.close();
    await handle.closed;
    post(popup, { terraPay: 1, sid, type: "success", paymentIntentId: "pi_ABCDEFGH" });
    assert.deepEqual(calls, []);
    assert.equal(popup.closed, true, "the SDK closes the window it opened");
  });
});
