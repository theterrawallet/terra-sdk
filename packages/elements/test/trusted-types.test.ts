/**
 * Trusted Types: the CDN bundles load exactly one script (the WalletConnect add-on), through a policy named
 * "terra-sdk" that blesses that one URL and nothing else, with the SRI hash baked in at build time.
 * happy-dom has no Trusted Types, so a recording stand-in for `trustedTypes` plays the browser's part.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { setupDom, tick, type Env } from "./helpers.js";

const ADDON = { file: "terra-walletconnect.iife.js", integrity: "sha384-baked-in-at-build-time" };
(globalThis as Record<string, unknown>).__TERRA_WC_ADDON__ = ADDON;

const BASE = "https://cdn.terrawallet.us/sdk/0.1.0/terra-elements.iife.js";
const ADDON_URL = "https://cdn.terrawallet.us/sdk/0.1.0/terra-walletconnect.iife.js";

interface Rules {
  createScriptURL(u: string): string;
}

let env: Env | undefined;
afterEach(async () => {
  delete (globalThis as Record<string, unknown>).trustedTypes;
  await env?.restore();
  env = undefined;
});

describe("Trusted Types: the WalletConnect add-on loader", () => {
  it("uses one terra-sdk policy that blesses only the add-on URL, and loads it with SRI and CORS", async () => {
    env = setupDom();
    const policies: { name: string; rules: Rules }[] = [];
    const blessed: string[] = [];
    (globalThis as Record<string, unknown>).trustedTypes = {
      createPolicy(name: string, rules: Rules) {
        policies.push({ name, rules });
        return {
          createScriptURL(u: string) {
            const out = rules.createScriptURL(u);
            blessed.push(out);
            return { toString: () => out };
          },
        };
      },
    };
    const loader = await import("../src/cdn/wc-loader.js");
    loader.setAddonBase(BASE);
    void loader.SignClient.init({}).catch(() => {});
    await tick(5);

    assert.deepEqual(policies.map((p) => p.name), ["terra-sdk"]);
    assert.deepEqual(blessed, [ADDON_URL]);
    const scripts = [...document.querySelectorAll("script")];
    assert.equal(scripts.length, 1);
    const s = scripts[0]!;
    assert.equal(s.getAttribute("src"), ADDON_URL);
    assert.equal(s.getAttribute("integrity"), ADDON.integrity);
    assert.equal(s.getAttribute("crossorigin"), "anonymous");

    const rules = policies[0]!.rules;
    for (const other of ["https://evil.example/x.js", `${ADDON_URL}?v=2`, "javascript:alert(1)", "data:text/javascript,alert(1)", ADDON_URL.replace("https:", "http:")]) {
      assert.throws(() => rules.createScriptURL(other), TypeError, other);
    }
  });
});
