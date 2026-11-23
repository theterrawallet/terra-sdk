#!/usr/bin/env node
/**
 * Zero-dependency local server for this example. Serves the page under a STRICT Content Security Policy with
 * Trusted Types enforced, to show the elements need no inline scripts, no eval and no unsafe styles.
 *   node serve.mjs            then open http://localhost:5174
 * Optional: WALLETCONNECT_PROJECT_ID=<32 hex> node serve.mjs
 */
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const cdn = join(here, "..", "..", "packages", "elements", "dist", "cdn");
const port = Number(process.env.PORT ?? 5174);
const manifestPath = join(cdn, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error("Build the elements package first: pnpm --filter @terrawallet/elements build");
  process.exit(1);
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "frame-src https://pay.terrawallet.us https://verify.walletconnect.org https://verify.walletconnect.com",
  "connect-src 'self' https://*.walletconnect.org wss://*.walletconnect.org https://*.walletconnect.com wss://*.walletconnect.com https://ethereum-rpc.publicnode.com https://mainnet.base.org https://polygon-bor-rpc.publicnode.com",
  "require-trusted-types-for 'script'",
  "trusted-types terra-sdk",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join("; ");

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };

createServer((req, res) => {
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  let file;
  if (path.startsWith("/cdn/")) file = normalize(join(cdn, path.slice(5)));
  else file = normalize(join(here, path === "/" ? "index.html" : path));
  if ((!file.startsWith(cdn) && !file.startsWith(here)) || !existsSync(file) || file.endsWith(".mjs")) {
    res.writeHead(404).end("Not found");
    return;
  }
  let body = readFileSync(file);
  if (file.endsWith("index.html")) {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const projectId = /^[0-9a-f]{32}$/i.test(process.env.WALLETCONNECT_PROJECT_ID ?? "") ? process.env.WALLETCONNECT_PROJECT_ID : "";
    body = Buffer.from(
      body
        .toString("utf8")
        .replace("__TERRA_ELEMENTS_SRI__", manifest.files["terra-elements.iife.js"].integrity)
        .replace("__WALLETCONNECT_PROJECT_ID__", projectId),
    );
  }
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "content-security-policy": CSP,
    "cross-origin-resource-policy": "same-origin",
    "x-content-type-options": "nosniff",
    "cache-control": "no-store",
  });
  res.end(body);
}).listen(port, () => console.log(`Terra elements example: http://localhost:${port}`));
