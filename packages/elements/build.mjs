// Builds @terrawallet/elements:
// - npm: ESM (index + auto entries, shared chunk), type declarations;
// - CDN: terra-walletconnect.iife.js (lazy add-on) first, then terra-elements.iife.js and terra-elements.esm.js
//   with the add-on's SRI hash baked in; a manifest with every file's SRI hash, and a CycloneDX SBOM.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCdnFile, writeCdnManifest } from "../../scripts/cdn.mjs";
import { buildLibrary, clean, emitTypes } from "../../scripts/lib.mjs";

const pkgDir = dirname(fileURLToPath(import.meta.url));
clean(join(pkgDir, "dist"));
await buildLibrary(pkgDir, { entryPoints: { index: "src/index.ts", auto: "src/auto.ts" }, splitting: true });
emitTypes(pkgDir);

const addon = await buildCdnFile(pkgDir, { entry: "src/cdn/wc-addon.ts", outfile: "terra-walletconnect.iife.js", format: "iife" });

// Inside the CDN bundles, the WalletConnect import resolves to the SRI-checked add-on loader.
const loader = join(pkgDir, "src/cdn/wc-loader.ts");
const wcAlias = {
  name: "terra-wc-addon",
  setup(build) {
    build.onResolve({ filter: /^@walletconnect\/sign-client$/ }, () => ({ path: loader }));
  },
};
const define = { __TERRA_WC_ADDON__: JSON.stringify({ file: addon.file, integrity: addon.integrity }) };
const iife = await buildCdnFile(pkgDir, { entry: "src/cdn/iife.ts", outfile: "terra-elements.iife.js", format: "iife", define, plugins: [wcAlias] });
const esm = await buildCdnFile(pkgDir, { entry: "src/cdn/esm.ts", outfile: "terra-elements.esm.js", format: "esm", define, plugins: [wcAlias] });

const results = [iife, esm, addon];
writeCdnManifest(pkgDir, "@terrawallet/elements", results);
for (const r of results) console.log(`  dist/cdn/${r.file}  ${r.bytes} B (${r.gzip} B gz)  ${r.integrity}`);
console.log("built @terrawallet/elements");
