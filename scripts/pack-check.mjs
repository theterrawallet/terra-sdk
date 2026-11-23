#!/usr/bin/env node
/**
 * Packs every package exactly as it will be published and refuses anything that should not ship.
 *
 *   node scripts/pack-check.mjs                    # pack into a temp dir, check, print the file list
 *   node scripts/pack-check.mjs --out artifacts    # also keep the tarballs (the release workflow publishes these)
 *
 * Run after `pnpm build` (and `pnpm sbom`). `pnpm pack` turns `workspace:*` into the exact sibling version; npm does
 * not understand `workspace:`, which is why the release publishes these tarballs instead of running `npm publish`
 * inside the package folders. For every tarball it checks:
 * - files: only package.json, README.md, LICENSE, NOTICE and dist/ (.js, .cjs, .d.ts, .d.cts, .json); never source
 *   maps, sources, tests, configs, .env files or tarballs; the same list `npm pack --dry-run` reports;
 * - the manifest: public name, the shared version, Apache-2.0, the GitHub repository and directory, no `workspace:`
 *   or ranges in dependencies, no install scripts;
 * - the contents: no source map references, no absolute or internal paths, nothing shaped like a real secret key.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLISH_ORDER = ["connect", "server", "pay-js", "elements", "react"];
const REPO_URL = "git+https://github.com/theterrawallet/terra-sdk.git";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const outArg = args.includes("--out") ? args[args.indexOf("--out") + 1] : undefined;
const outDir = outArg ? resolve(outArg) : mkdtempSync(join(tmpdir(), "terra-pack-"));
mkdirSync(outDir, { recursive: true });

const ALLOWED = [/^package\.json$/, /^README\.md$/, /^LICENSE$/, /^NOTICE$/, /^dist\/[A-Za-z0-9._/-]+\.(js|cjs|d\.ts|d\.cts|json)$/];
const FORBIDDEN_FILES = [/\.map$/, /(^|\/)(src|test|tests|__tests__)\//, /\.env(\.|$)/, /\.tgz$/, /tsconfig/, /(^|\/)build\.mjs$/, /\.test\./];
const FORBIDDEN_TEXT = [
  ["source map reference", /sourceMappingURL/],
  ["absolute path", /(?:\/Users\/|\/home\/runner\/|\/private\/(?:tmp|var)\/|[A-Z]:\\\\(?:Users|a)\\\\)/],
  ["internal package name", /@terra\/sdk-/],
  ["monorepo path", /packages\/sdk\//],
  ["workspace protocol", /workspace:/],
  ["real-shaped secret key", /tw_(?:test|live)_sk_[A-Za-z0-9_-]{40,}/],
  ["real-shaped webhook secret", /whsec_[A-Za-z0-9_-]{40,}/],
];
const INSTALL_SCRIPTS = ["preinstall", "install", "postinstall", "prepare", "prepack", "postpack", "prepublish"];

const sh = (cmd, argv, cwd) => execFileSync(cmd, argv, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const failures = [];
const fail = (pkg, msg) => failures.push(`${pkg}: ${msg}`);
const versions = PUBLISH_ORDER.map((d) => JSON.parse(readFileSync(join(root, "packages", d, "package.json"), "utf8")).version);
const version = versions[0];
const report = [];

for (const dir of PUBLISH_ORDER) {
  const pkgDir = join(root, "packages", dir);
  const src = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  const name = src.name;
  try {
    statSync(join(pkgDir, "dist"));
  } catch {
    fail(name, "dist/ is missing: run pnpm build first");
    continue;
  }
  const packed = sh("pnpm", ["pack", "--pack-destination", outDir], pkgDir).trim().split("\n").pop().trim();
  const tarball = resolve(pkgDir, packed);
  const unpack = mkdtempSync(join(tmpdir(), "terra-unpack-"));
  sh("tar", ["-xzf", tarball, "-C", unpack]);
  const base = join(unpack, "package");
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else files.push(relative(base, p).split("\\").join("/"));
    }
  };
  walk(base);
  files.sort();

  for (const f of files) {
    if (!ALLOWED.some((re) => re.test(f))) fail(name, `unexpected file ${f}`);
    if (FORBIDDEN_FILES.some((re) => re.test(f))) fail(name, `forbidden file ${f}`);
    const text = readFileSync(join(base, f), "utf8");
    for (const [what, re] of FORBIDDEN_TEXT) if (re.test(text)) fail(name, `${f} contains a ${what}`);
  }

  // The same list npm itself would publish from the folder (both read the "files" whitelist).
  const npmList = JSON.parse(sh("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], pkgDir))[0].files.map((f) => f.path).sort();
  if (JSON.stringify(npmList) !== JSON.stringify(files)) fail(name, `npm pack --dry-run lists different files:\n  npm:  ${npmList.join(", ")}\n  pnpm: ${files.join(", ")}`);

  const m = JSON.parse(readFileSync(join(base, "package.json"), "utf8"));
  if (m.name !== `@terrawallet/${dir}`) fail(name, `packed name is ${m.name}`);
  if (m.version !== version) fail(name, `packed version ${m.version} is not ${version}`);
  if (m.private) fail(name, "packed manifest is private");
  if (m.license !== "Apache-2.0") fail(name, `license is ${m.license}`);
  if (m.repository?.url !== REPO_URL || m.repository?.directory !== `packages/${dir}`) fail(name, `repository is ${JSON.stringify(m.repository)}`);
  if (m.publishConfig?.access !== "public" || m.publishConfig?.provenance !== true) fail(name, "publishConfig must be { access: public, provenance: true }");
  for (const s of INSTALL_SCRIPTS) if (m.scripts?.[s]) fail(name, `has a "${s}" script`);
  for (const [dep, spec] of Object.entries(m.dependencies ?? {})) {
    if (!/^\d+\.\d+\.\d+$/.test(String(spec))) fail(name, `dependency ${dep}@${spec} is not an exact version`);
    if (dep.startsWith("@terrawallet/") && spec !== version) fail(name, `sibling ${dep}@${spec} is not ${version}`);
  }

  const size = statSync(tarball).size;
  report.push({ name, version: m.version, tarball: relative(process.cwd(), tarball), bytes: size, files: files.map((f) => ({ path: f, bytes: statSync(join(base, f)).size })) });
  rmSync(unpack, { recursive: true, force: true });
}

for (const r of report) {
  console.log(`\n${r.name}@${r.version}  ${r.tarball}  (${(r.bytes / 1024).toFixed(1)} KB packed, ${r.files.length} files)`);
  for (const f of r.files) console.log(`  ${String(f.bytes).padStart(8)}  ${f.path}`);
}
if (!outArg) rmSync(outDir, { recursive: true, force: true });
if (failures.length) {
  console.error(`\npack-check: ${failures.length} problem(s)`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`\npack-check: ${report.length} packages OK${outArg ? `, tarballs in ${relative(process.cwd(), outDir) || "."}` : ""}`);
