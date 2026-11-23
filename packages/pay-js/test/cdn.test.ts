/** Checks the CDN build output (run after `pnpm build`): SRI manifest, no source maps, CSP and Trusted Types safe. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const dir = join(import.meta.dirname, "..", "dist", "cdn");
const built = existsSync(join(dir, "manifest.json"));

/** Sinks that need 'unsafe-eval', 'unsafe-inline' or a Trusted Types policy, or that can run text as code. */
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
  ["script element", /createElement\(\s*["']script["']/],
  ["source map", /sourceMappingURL/],
];

describe("pay-js CDN build", { skip: built ? false : "run the build first" }, () => {
  const manifest = built ? JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) : { files: {} };

  it("lists a correct sha384 SRI hash for every file and ships no source maps", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
    assert.deepEqual(Object.keys(manifest.files).sort(), files.sort());
    assert.ok(!readdirSync(dir).some((f) => f.endsWith(".map")));
    for (const f of files) {
      const sri = `sha384-${createHash("sha384").update(readFileSync(join(dir, f))).digest("base64")}`;
      assert.equal(manifest.files[f].integrity, sri, f);
    }
  });

  it("uses no eval, no HTML sinks and creates no scripts (works under Trusted Types with no policy)", () => {
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".js"))) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const [name, re] of FORBIDDEN) assert.ok(!re.test(src), `${f}: ${name}`);
    }
  });
});
