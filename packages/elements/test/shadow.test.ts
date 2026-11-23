import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createTerraConnect } from "@terrawallet/connect";
import { contrast, parseColor, resolveAccent } from "../src/theme.js";
import { setupDom, tick, type Env } from "./helpers.js";

let env: Env;
beforeEach(async () => {
  env = setupDom();
  const { defineTerraElements, setDefaultClient } = await import("../src/index.js");
  setDefaultClient(createTerraConnect({ discoveryTimeoutMs: 10, autoReconnect: false }));
  defineTerraElements();
});
afterEach(async () => {
  document.body.replaceChildren();
  await env.restore();
});

function mount(html: string): HTMLElement {
  const tpl = document.createElement("template");
  tpl.innerHTML = html; // test fixture markup only
  const el = tpl.content.firstElementChild as HTMLElement;
  document.body.append(el);
  return el;
}

describe("Shadow DOM isolation", () => {
  it("uses a closed shadow root: page scripts and selectors cannot reach inside", () => {
    const el = mount("<terra-connect-button></terra-connect-button>");
    assert.equal(el.shadowRoot, null);
    const root = env.roots.get(el)!;
    assert.ok(root.querySelector("button"), "rendered internally");
    assert.equal(document.querySelectorAll("button").length, 0);
    assert.equal(document.querySelector("terra-connect-button button"), null);
  });

  it("host page CSS cannot hide or restyle the internals", () => {
    const style = document.createElement("style");
    style.textContent = "button{display:none!important;visibility:hidden!important;color:red!important} *{opacity:0!important} .btn,.note{display:none!important}";
    document.head.append(style);
    const el = mount('<terra-pay-button payment-intent="pi_ABCDEFGH" publishable-key="tw_test_pk_ABCDEFGH1234"></terra-pay-button>');
    const root = env.roots.get(el)!;
    const btn = root.querySelector("button")!;
    const note = root.querySelector(".note") as HTMLElement;
    assert.equal(getComputedStyle(btn).display, "inline-flex");
    assert.notEqual(getComputedStyle(btn).visibility, "hidden");
    assert.notEqual(getComputedStyle(btn).color, "rgb(255, 0, 0)");
    assert.equal(getComputedStyle(note).display, "inline-flex");
    assert.equal(note.textContent, "Secure checkout on pay.terrawallet.us");
  });

  it("renders attribute text as text, never as HTML", () => {
    const el = mount("<terra-connect-button></terra-connect-button>");
    el.setAttribute("label", '<img src=x onerror="alert(1)">Connect');
    const root = env.roots.get(el)!;
    assert.equal(root.querySelector("img[src=x]"), null);
    assert.ok(root.querySelector("button")!.textContent!.includes('<img src=x onerror="alert(1)">Connect'));
  });

  it("refuses CSS injection through the accent attribute and custom properties", () => {
    for (const bad of ["red;background:url(https://evil.example/x)", "url(https://evil.example)", "var(--x)", "expression(alert(1))", "#12345g", "rgb(300,0,0)"]) {
      assert.equal(parseColor(bad), null, bad);
    }
    const el = mount('<terra-connect-button accent="red;background:url(https://evil.example/x)"></terra-connect-button>');
    el.style.setProperty("--terra-accent", "url(https://evil.example/y)");
    el.setAttribute("radius", "999px;x:y");
    const wrap = env.roots.get(el)!.querySelector(".t") as HTMLElement;
    assert.equal(wrap.style.getPropertyValue("--_accent"), "#0a5bff");
    assert.equal(wrap.style.getPropertyValue("--_radius"), "14px");
  });

  it("keeps AA contrast for any accent (text colour flips, or the accent darkens)", () => {
    for (const accent of ["#FFFF00", "#808080", "#00FF00", "#0A5BFF", "#FF0066", "#777777", "#ffffff", "#000000"]) {
      const a = resolveAccent(accent);
      assert.ok(contrast(parseColor(a.accent)!, parseColor(a.onAccent)!) >= 4.5, `${accent} -> ${a.accent}/${a.onAccent}`);
    }
    assert.equal(resolveAccent("#FFFF00").onAccent, "#0b1221");
  });

  it("theme attributes switch light, dark and auto", () => {
    const el = mount('<terra-connect-button theme="light"></terra-connect-button>');
    const wrap = env.roots.get(el)!.querySelector(".t")!;
    assert.equal(wrap.getAttribute("data-theme"), "light");
    el.setAttribute("theme", "nonsense");
    assert.equal(wrap.getAttribute("data-theme"), "auto");
  });
});

describe("security prompts", () => {
  it("the connect modal always shows the requesting origin and the recovery-phrase warning, whatever the theme", async () => {
    const el = mount('<terra-connect-button theme="light" accent="#ff0066" radius="0"></terra-connect-button>');
    env.roots.get(el)!.querySelector("button")!.click();
    await tick(40);
    const root = env.roots.get(document.querySelector("terra-wallet-modal")!)!;
    assert.match(root.querySelector(".origin")!.textContent!, /^shop\.example wants to connect/);
    assert.match(root.querySelector(".foot")!.textContent!, /never asks for your recovery phrase/);
    root.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true }));
  });

  it("a pay button given a secret key is disabled, says why, and never opens checkout", () => {
    const errors: unknown[][] = [];
    const orig = console.error;
    console.error = (...a: unknown[]) => void errors.push(a);
    let opened = false;
    (window as unknown as { open: unknown }).open = () => ((opened = true), null);
    try {
      const el = mount('<terra-pay-button payment-intent="pi_ABCDEFGH" publishable-key="tw_live_sk_ABCDEFGH1234"></terra-pay-button>');
      const root = env.roots.get(el)!;
      const btn = root.querySelector("button")!;
      assert.ok(btn.disabled);
      btn.click();
      assert.equal(opened, false);
      assert.equal(document.querySelector("terra-pay-checkout"), null);
      assert.match(root.querySelector(".err")!.textContent!, /secret key/);
      assert.ok(!root.textContent!.includes("tw_live_sk_ABCDEFGH1234"));
      assert.ok(errors.length >= 1);
    } finally {
      console.error = orig;
    }
  });
});

describe("attribute and key hygiene", () => {
  it("a pay button accepts a publishable key as the API mints it (base64url with - and _)", () => {
    let opened = "";
    (window as unknown as { open: unknown }).open = (u: string) => ((opened = u), { closed: false, focus() {}, close() {} });
    const pk = "tw_test_pk_Ab-_9xYzQ1w2E3r4T5y6U7i8O9p0-LkJhGfDsA_zXcVb";
    const el = mount(`<terra-pay-button payment-intent="pi_ABCDEFGH" publishable-key="${pk}"></terra-pay-button>`);
    const root = env.roots.get(el)!;
    const btn = root.querySelector("button")!;
    assert.equal(btn.disabled, false);
    btn.click();
    assert.equal(new URL(opened).searchParams.get("pk"), pk);
    assert.equal(root.querySelector(".err"), null);
    // open() on a button whose checkout is already open hands back that checkout: close it (stops its timers).
    (el as unknown as { open(): { close(): void } | null }).open()?.close();
    assert.equal(document.querySelector("terra-pay-checkout"), null);
  });

  it("refuses secret material anywhere in publishable-key, not only at the start", () => {
    const orig = console.error;
    console.error = () => {};
    try {
      for (const pk of ["tw_test_pk_AAAAwhsec_BBBBBBBBBBBBBBBB", "tw_test_pk_tw_live_sk_ABCDEFGH1234", "TW_LIVE_SK_ABCDEFGH1234"]) {
        const el = mount(`<terra-pay-button payment-intent="pi_ABCDEFGH" publishable-key="${pk}"></terra-pay-button>`);
        const root = env.roots.get(el)!;
        assert.ok(root.querySelector("button")!.disabled, pk);
        assert.ok(!root.textContent!.includes(pk));
        el.remove();
      }
    } finally {
      console.error = orig;
    }
  });

  it("chain logos come only from the bundled marks (no prototype keys)", async () => {
    const { logoSrc } = await import("../src/dom.js");
    const { chainLogo } = await import("../src/modal.js");
    assert.match(logoSrc("base")!, /^data:image\//);
    for (const k of ["constructor", "__proto__", "toString", "hasOwnProperty", "", undefined]) assert.equal(logoSrc(k), undefined, String(k));
    const custom = chainLogo({ id: 777, name: "Custom", symbol: "C", decimals: 18, rpcUrls: ["https://rpc.example"], logo: "constructor" });
    assert.equal(custom.tagName, "SPAN");
    assert.equal(custom.textContent, "C");
  });
});
