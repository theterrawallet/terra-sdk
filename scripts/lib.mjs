/**
 * Shared build helpers for the Terra SDK packages.
 *
 * - JavaScript is bundled with esbuild (exact version pinned per package).
 * - Type declarations come from `tsc -p tsconfig.build.json` (emitDeclarationOnly).
 * - npm builds keep every package dependency external; the CDN builds (elements, pay-js) bundle everything into
 *   single files, are minified, ship WITHOUT source maps, and get an SRI manifest (see sri.mjs).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

export function clean(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

/** esbuild, resolved from the calling package so every package uses its own pinned version. */
export async function loadEsbuild(pkgDir) {
  const req = createRequire(join(pkgDir, "package.json"));
  return import(req.resolve("esbuild"));
}

/** Library (npm) build: readable ESM, dependencies external, no source maps, no minification. */
export async function buildLibrary(pkgDir, { entryPoints, platform = "browser", splitting = false, banner, formats = ["esm"], define = {} }) {
  const esbuild = await loadEsbuild(pkgDir);
  const common = {
    absWorkingDir: pkgDir,
    entryPoints,
    bundle: true,
    packages: "external",
    platform,
    target: platform === "node" ? "node18" : "es2020",
    sourcemap: false,
    minify: false,
    legalComments: "none",
    charset: "utf8",
    logLevel: "warning",
    define: { __TERRA_SDK_VERSION__: JSON.stringify(readVersion(pkgDir)), ...define },
    banner: banner ? { js: banner } : undefined,
  };
  for (const format of formats) {
    await esbuild.build({
      ...common,
      format,
      outdir: join(pkgDir, "dist"),
      splitting: format === "esm" ? splitting : false,
      chunkNames: "chunks/[name]-[hash]",
      outExtension: format === "cjs" ? { ".js": ".cjs" } : { ".js": ".js" },
    });
  }
}

/** Declarations via tsc. Fails the build on any type error. */
export function emitTypes(pkgDir) {
  const req = createRequire(join(pkgDir, "package.json"));
  const tsc = join(dirname(req.resolve("typescript/package.json")), "bin", "tsc");
  const res = spawnSync(process.execPath, [tsc, "-p", join(pkgDir, "tsconfig.build.json")], { stdio: "inherit", cwd: pkgDir });
  if (res.status !== 0) throw new Error(`tsc failed in ${pkgDir}`);
}

export function readVersion(pkgDir) {
  const req = createRequire(join(pkgDir, "package.json"));
  return req(join(pkgDir, "package.json")).version;
}

export function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}
