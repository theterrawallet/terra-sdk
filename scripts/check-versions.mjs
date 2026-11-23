#!/usr/bin/env node
/**
 * Release guard: every published package has the same version, and it equals the git tag being released.
 *
 *   node scripts/check-versions.mjs            # all packages agree
 *   node scripts/check-versions.mjs v0.1.0     # ...and equal the tag (the release workflow passes GITHUB_REF_NAME)
 *
 * Also checks that sibling dependencies use `workspace:*` (pnpm pack turns them into the exact version) and that no
 * package is marked private. Exits 1 on any mismatch.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PUBLISH_ORDER = ["connect", "server", "pay-js", "elements", "react"];

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tag = process.argv[2];
const errors = [];
const pkgs = PUBLISH_ORDER.map((dir) => ({ dir, pkg: JSON.parse(readFileSync(join(root, "packages", dir, "package.json"), "utf8")) }));
const names = new Set(pkgs.map((p) => p.pkg.name));
const versions = new Set(pkgs.map((p) => p.pkg.version));

if (versions.size !== 1) errors.push(`packages disagree on the version: ${pkgs.map((p) => `${p.pkg.name}@${p.pkg.version}`).join(", ")}`);
const [version] = versions;
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(String(version))) errors.push(`not a semver version: ${version}`);
if (tag !== undefined && tag !== `v${version}`) errors.push(`the tag ${tag} does not match the package version ${version} (expected v${version})`);
for (const { dir, pkg } of pkgs) {
  if (pkg.private) errors.push(`${pkg.name}: marked private`);
  if (pkg.name !== `@terrawallet/${dir}`) errors.push(`${dir}: unexpected name ${pkg.name}`);
  for (const [dep, spec] of Object.entries(pkg.dependencies ?? {})) {
    if (names.has(dep) && spec !== "workspace:*") errors.push(`${pkg.name}: ${dep} must be "workspace:*" (got ${spec})`);
    if (!names.has(dep) && !/^\d+\.\d+\.\d+$/.test(String(spec))) errors.push(`${pkg.name}: ${dep}@${spec} is not an exact version`);
  }
  for (const [dep, spec] of Object.entries(pkg.devDependencies ?? {})) {
    if (!/^\d+\.\d+\.\d+$/.test(String(spec)) && spec !== "workspace:*") errors.push(`${pkg.name}: dev dependency ${dep}@${spec} is not an exact version`);
  }
}

if (errors.length) {
  for (const e of errors) console.error(`check-versions: ${e}`);
  process.exit(1);
}
console.log(`check-versions: ${pkgs.length} packages at ${version}${tag ? `, matching ${tag}` : ""}`);
