#!/usr/bin/env node
/**
 * Writes a CycloneDX 1.5 SBOM for one SDK package's npm artifact: dist/sbom.cdx.json, listing the exact installed
 * versions of its runtime dependency tree. Usage: node scripts/sbom.mjs <packageDir>
 * (`npm sbom` needs an npm lockfile; this repo uses pnpm, so the tree is read from node_modules directly.)
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ensureDir } from "./lib.mjs";
import { runtimeDependencyComponents, writeCycloneDx } from "./sbom-lib.mjs";

const pkgDir = resolve(process.argv[2] ?? ".");
const pkg = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
const components = runtimeDependencyComponents(pkgDir).filter((c) => !c.name.startsWith("@terrawallet/"));
const siblings = Object.keys(pkg.dependencies ?? {}).filter((n) => n.startsWith("@terrawallet/"));
ensureDir(join(pkgDir, "dist"));
writeCycloneDx(join(pkgDir, "dist", "sbom.cdx.json"), { name: pkg.name, version: pkg.version, components });
console.log(`${pkg.name}: dist/sbom.cdx.json with ${components.length} third-party runtime components${siblings.length ? ` (plus ${siblings.join(", ")})` : ""}`);
