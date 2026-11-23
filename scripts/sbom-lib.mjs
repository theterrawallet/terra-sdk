/**
 * Minimal CycloneDX 1.5 JSON writer (no dependencies).
 * - npm SBOM: the package's runtime dependency tree, resolved from node_modules (exact installed versions).
 * - CDN SBOM: exactly the third-party packages esbuild put into the bundle (from its metafile).
 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";

const purl = (name, version) => `pkg:npm/${name.startsWith("@") ? `%40${name.slice(1)}` : name}@${version}`;

function licenseOf(pkg) {
  const l = typeof pkg.license === "string" ? pkg.license : pkg.license?.type;
  if (!l) return undefined;
  if (/^SEE LICENSE IN/i.test(l)) return [{ license: { name: l } }];
  return [{ license: { id: l } }];
}

function component(pkg, dir) {
  const c = { type: "library", "bom-ref": purl(pkg.name, pkg.version), name: pkg.name, version: pkg.version, purl: purl(pkg.name, pkg.version) };
  const lic = licenseOf(pkg);
  if (lic) c.licenses = lic;
  const integrity = pkg._integrity;
  if (integrity) c.hashes = [{ alg: "SHA-512", content: Buffer.from(integrity.replace(/^sha512-/, ""), "base64").toString("hex") }];
  if (dir) c.properties = [{ name: "terra:resolvedFrom", value: "node_modules" }];
  return c;
}

/** Walks `dependencies` (not dev) from node_modules, following pnpm symlinks. */
export function runtimeDependencyComponents(pkgDir) {
  const seen = new Map();
  const visit = (fromDir, deps) => {
    for (const name of Object.keys(deps ?? {})) {
      let dir = null;
      for (let d = fromDir; ; d = dirname(d)) {
        const cand = join(d, "node_modules", ...name.split("/"));
        if (existsSync(join(cand, "package.json"))) {
          dir = realpathSync(cand);
          break;
        }
        if (dirname(d) === d) break;
      }
      if (!dir) continue;
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      const ref = purl(pkg.name, pkg.version);
      if (seen.has(ref)) continue;
      seen.set(ref, component(pkg, dir));
      visit(dir, pkg.dependencies);
    }
  };
  const self = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));
  visit(pkgDir, self.dependencies);
  return [...seen.values()];
}

/** Packages that contributed bytes to a bundle, from an esbuild metafile. */
export function componentsFromMetafile(pkgDir, metafile) {
  const out = new Map();
  for (const output of Object.values(metafile.outputs)) {
    for (const [input, info] of Object.entries(output.inputs ?? {})) {
      if (!info.bytesInOutput) continue;
      const abs = resolve(pkgDir, input);
      const idx = abs.lastIndexOf(`${sep}node_modules${sep}`);
      if (idx < 0) continue;
      const rest = abs.slice(idx + 14).split(sep);
      const name = rest[0]?.startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];
      const root = abs.slice(0, idx + 14) + name.split("/").join(sep);
      const pj = join(root, "package.json");
      if (!existsSync(pj)) continue;
      const pkg = JSON.parse(readFileSync(pj, "utf8"));
      out.set(purl(pkg.name, pkg.version), component(pkg));
    }
  }
  // Workspace siblings bundled from source (e.g. @terrawallet/connect inside the elements CDN file).
  for (const output of Object.values(metafile.outputs)) {
    for (const input of Object.keys(output.inputs ?? {})) {
      const m = /(?:^|\/)packages\/([a-z-]+)\/(?:src|dist)\//.exec(resolve(pkgDir, input).split(sep).join("/"));
      if (!m) continue;
      const pj = join(pkgDir, "..", m[1], "package.json");
      if (!existsSync(pj)) continue;
      const pkg = JSON.parse(readFileSync(pj, "utf8"));
      out.set(purl(pkg.name, pkg.version), component(pkg));
    }
  }
  return [...out.values()];
}

export function writeCycloneDx(file, { name, version, components, files = [] }) {
  const doc = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: { components: [{ type: "application", name: "terra-sdk-sbom", version: "1" }] },
      component: { type: "library", name, version, "bom-ref": `terra-sdk:${name}@${version}` },
      properties: files.map((f) => ({ name: `terra:cdnFile:${f.name}`, value: f.integrity })),
    },
    components: components.sort((a, b) => a.name.localeCompare(b.name)),
  };
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  return createHash("sha256").update(JSON.stringify(doc.components)).digest("hex");
}
