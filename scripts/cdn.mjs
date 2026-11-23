/**
 * CDN builds: single self-contained files for a <script> tag (IIFE) or <script type="module"> (ESM).
 * Minified, NO source maps, license comments kept at the end of each file. Writes an SRI manifest and a
 * CycloneDX SBOM of exactly what was bundled (from esbuild's metafile).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { gzipSync } from "node:zlib";
import { ensureDir, loadEsbuild, readVersion } from "./lib.mjs";
import { componentsFromMetafile, writeCycloneDx } from "./sbom-lib.mjs";

export const sri = (buf) => `sha384-${createHash("sha384").update(buf).digest("base64")}`;

/**
 * @param {string} pkgDir
 * @param {{ entry: string, outfile: string, format: "iife" | "esm", globalName?: string, define?: Record<string,string>, plugins?: any[] }} b
 * @returns {Promise<{ file: string, integrity: string, bytes: number, gzip: number, metafile: any }>}
 */
export async function buildCdnFile(pkgDir, b) {
  const esbuild = await loadEsbuild(pkgDir);
  const outDir = join(pkgDir, "dist", "cdn");
  ensureDir(outDir);
  const outPath = join(outDir, b.outfile);
  const res = await esbuild.build({
    absWorkingDir: pkgDir,
    entryPoints: [b.entry],
    outfile: outPath,
    bundle: true,
    format: b.format,
    globalName: b.globalName,
    platform: "browser",
    target: "es2020",
    minify: true,
    sourcemap: false,
    legalComments: "eof",
    charset: "utf8",
    metafile: true,
    logLevel: "warning",
    define: { __TERRA_SDK_VERSION__: JSON.stringify(readVersion(pkgDir)), "process.env.NODE_ENV": '"production"', global: "globalThis", ...(b.define ?? {}) },
    plugins: b.plugins ?? [],
  });
  const buf = readFileSync(outPath);
  return { file: b.outfile, integrity: sri(buf), bytes: buf.length, gzip: gzipSync(buf, { level: 9 }).length, metafile: res.metafile };
}

/** Writes dist/cdn/manifest.json (SRI per file) and dist/cdn/sbom.cdx.json (bundled components). */
export function writeCdnManifest(pkgDir, pkgName, results) {
  const outDir = join(pkgDir, "dist", "cdn");
  const version = readVersion(pkgDir);
  const manifest = {
    package: pkgName,
    version,
    generated: "build",
    note: "Pin the exact versioned URL and add integrity + crossorigin=\"anonymous\" to the script tag.",
    files: Object.fromEntries(
      results.map((r) => [r.file, { integrity: r.integrity, bytes: r.bytes, gzipBytes: r.gzip, format: r.file.includes(".iife.") ? "iife" : "esm" }]),
    ),
  };
  writeFileSync(join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  const components = new Map();
  for (const r of results) for (const c of componentsFromMetafile(pkgDir, r.metafile)) components.set(c["bom-ref"], c);
  writeCycloneDx(join(outDir, "sbom.cdx.json"), {
    name: `${pkgName} (CDN bundles)`,
    version,
    components: [...components.values()],
    files: results.map((r) => ({ name: basename(r.file), integrity: r.integrity })),
  });
  return manifest;
}
