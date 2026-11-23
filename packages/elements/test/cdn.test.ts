/** Checks the CDN build output (run after `pnpm build`): SRI manifest, baked-in add-on hash, no source maps. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const dir = join(import.meta.dirname, "..", "dist", "cdn");
const built = existsSync(join(dir, "manifest.json"));

describe("CDN build", { skip: built ? false : "run the build first" }, () => {
  const manifest = built ? JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) : { files: {} };

  it("lists a correct sha384 SRI hash for every file", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
    assert.deepEqual(Object.keys(manifest.files).sort(), files.sort());
    for (const f of files) {
      const sri = `sha384-${createHash("sha384").update(readFileSync(join(dir, f))).digest("base64")}`;
      assert.equal(manifest.files[f].integrity, sri, f);
    }
  });

  it("bakes the WalletConnect add-on's SRI hash into both main bundles", () => {
    const addon = manifest.files["terra-walletconnect.iife.js"].integrity;
    for (const f of ["terra-elements.iife.js", "terra-elements.esm.js"]) assert.ok(readFileSync(join(dir, f), "utf8").includes(addon), f);
  });

  it("ships no source maps and no eval", () => {
    assert.ok(!readdirSync(dir).some((f) => f.endsWith(".map")));
    for (const f of ["terra-elements.iife.js", "terra-elements.esm.js"]) {
      const src = readFileSync(join(dir, f), "utf8");
      assert.ok(!src.includes("sourceMappingURL"), f);
      assert.ok(!/\beval\(|new Function\(|\.innerHTML\s*=/.test(src), f);
    }
  });

  it("is CSP and Trusted Types safe: no eval or HTML sinks anywhere, one script element, behind the terra-sdk policy", () => {
    const FORBIDDEN: [string, RegExp][] = [
      ["eval", /\beval\s*\(/],
      ["new Function", /\bnew Function\s*\(/],
      ["string timer", /\bset(?:Timeout|Interval)\s*\(\s*["'`]/],
      ["innerHTML", /\.innerHTML\s*=/],
      ["outerHTML", /\.outerHTML\s*=/],
      ["insertAdjacentHTML", /insertAdjacentHTML/],
      ["document.write", /document\.write/],
      ["srcdoc", /srcdoc/],
      ["javascript: URL", /["'`]javascript:/i],
      ["style attribute", /setAttribute\(\s*["']style["']/],
      ["source map", /sourceMappingURL/],
    ];
    // The WalletConnect add-on is third-party code: the same rules apply, so an upgrade that adds eval fails here.
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".js"))) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const [name, re] of FORBIDDEN) assert.ok(!re.test(src), `${f}: ${name}`);
    }
    for (const f of ["terra-elements.iife.js", "terra-elements.esm.js"]) {
      const src = readFileSync(join(dir, f), "utf8");
      assert.equal(src.match(/createElement\(\s*["']script["']/g)?.length, 1, `${f}: exactly one script element (the SRI-checked add-on)`);
      assert.deepEqual([...src.matchAll(/createPolicy\(\s*["']([^"']+)["']/g)].map((m) => m[1]), ["terra-sdk"], f);
    }
    assert.ok(!/createElement\(\s*["']script["']/.test(readFileSync(join(dir, "terra-walletconnect.iife.js"), "utf8")));
  });

  it("has a CycloneDX SBOM naming the bundled WalletConnect packages", () => {
    const sbom = JSON.parse(readFileSync(join(dir, "sbom.cdx.json"), "utf8"));
    assert.equal(sbom.bomFormat, "CycloneDX");
    const names = sbom.components.map((c: { name: string }) => c.name);
    assert.ok(names.includes("@walletconnect/sign-client"));
    assert.ok(names.includes("@terrawallet/connect"));
  });
});
