#!/usr/bin/env node
/**
 * Bundle-size gate for @terrawallet/connect.
 *
 * Bundles the public entry the way an app bundler would (minified ESM, code splitting on), then measures only the
 * code that loads EAGERLY: the entry chunk and everything it imports statically. The WalletConnect connector and
 * the WalletConnect sign client are dynamic imports, so they are excluded (they load only for the QR / deep-link
 * fallback). Fails with exit code 1 when the eager core is over the budget.
 *
 * Also prints informational sizes for the CDN builds when they exist.
 */
import { existsSync, readFileSync, readdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const BUDGET = 15 * 1024; // 15 KB gzipped
const sdkDir = join(dirname(fileURLToPath(import.meta.url)), "..", "packages");
const connectDir = join(sdkDir, "connect");
const req = createRequire(join(connectDir, "package.json"));
const esbuild = await import(req.resolve("esbuild"));

const out = mkdtempSync(join(tmpdir(), "terra-size-"));
try {
  const result = await esbuild.build({
    absWorkingDir: connectDir,
    entryPoints: { index: "src/index.ts" },
    bundle: true,
    splitting: true,
    format: "esm",
    minify: true,
    platform: "browser",
    target: "es2020",
    outdir: out,
    metafile: true,
    external: ["@walletconnect/*"],
    define: { __TERRA_SDK_VERSION__: '"0.0.0"' },
    logLevel: "error",
  });
  const outputs = result.metafile.outputs;
  const entryKey = Object.keys(outputs).find((k) => outputs[k].entryPoint === "src/index.ts");
  const eager = new Set();
  const walk = (key) => {
    if (eager.has(key) || !outputs[key]) return;
    eager.add(key);
    for (const imp of outputs[key].imports) if (imp.kind === "import-statement" && !imp.external) walk(imp.path);
  };
  walk(entryKey);
  const read = (k) => readFileSync(join(connectDir, k));
  const eagerBytes = Buffer.concat([...eager].map(read));
  const gz = gzipSync(eagerBytes, { level: 9 }).length;
  const lazy = Object.keys(outputs).filter((k) => k.endsWith(".js") && !eager.has(k));
  const lazyGz = lazy.reduce((n, k) => n + gzipSync(read(k), { level: 9 }).length, 0);

  const kb = (n) => `${(n / 1024).toFixed(2)} KB`;
  console.log(`@terrawallet/connect core (eager, minified): ${kb(eagerBytes.length)} raw, ${kb(gz)} gzipped (budget ${kb(BUDGET)})`);
  console.log(`  lazy WalletConnect connector chunk: ${kb(lazyGz)} gzipped (plus @walletconnect/sign-client, loaded only for the QR / deep-link fallback)`);

  for (const pkg of ["elements", "pay-js"]) {
    const dir = join(sdkDir, pkg, "dist", "cdn");
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".js")).sort()) {
      const buf = readFileSync(join(dir, f));
      console.log(`  ${relative(sdkDir, join(dir, f))}: ${kb(buf.length)} raw, ${kb(gzipSync(buf, { level: 9 }).length)} gzipped`);
    }
  }

  if (gz > BUDGET) {
    console.error(`FAIL: the connect core is ${kb(gz)} gzipped, over the ${kb(BUDGET)} budget.`);
    process.exit(1);
  }
  console.log("OK: connect core is within budget.");
} finally {
  rmSync(out, { recursive: true, force: true });
}
