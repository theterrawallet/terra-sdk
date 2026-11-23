// Builds @terrawallet/pay-js: npm ESM + types, and CDN files (IIFE + ESM) with an SRI manifest and SBOM.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildCdnFile, writeCdnManifest } from "../../scripts/cdn.mjs";
import { buildLibrary, clean, emitTypes } from "../../scripts/lib.mjs";

const pkgDir = dirname(fileURLToPath(import.meta.url));
clean(`${pkgDir}/dist`);
await buildLibrary(pkgDir, { entryPoints: { index: "src/index.ts" } });
emitTypes(pkgDir);
const results = [
  await buildCdnFile(pkgDir, { entry: "src/cdn.ts", outfile: "terra-pay.iife.js", format: "iife" }),
  await buildCdnFile(pkgDir, { entry: "src/cdn-esm.ts", outfile: "terra-pay.esm.js", format: "esm" }),
];
writeCdnManifest(pkgDir, "@terrawallet/pay-js", results);
for (const r of results) console.log(`  dist/cdn/${r.file}  ${r.bytes} B (${r.gzip} B gz)  ${r.integrity}`);
console.log("built @terrawallet/pay-js");
