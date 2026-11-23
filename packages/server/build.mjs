// Builds @terrawallet/server: ESM + CommonJS for Node 18+, with .d.ts and .d.cts declarations.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLibrary, clean, emitTypes } from "../../scripts/lib.mjs";

const pkgDir = dirname(fileURLToPath(import.meta.url));
const dist = join(pkgDir, "dist");
clean(dist);
await buildLibrary(pkgDir, { entryPoints: { index: "src/index.ts" }, platform: "node", formats: ["esm", "cjs"] });
emitTypes(pkgDir);
// CommonJS consumers resolve ./dist/index.d.cts; relative imports are rewritten to the .cjs twins.
for (const f of readdirSync(dist).filter((f) => f.endsWith(".d.ts"))) {
  const src = readFileSync(join(dist, f), "utf8").replace(/(from\s+["']\.\/[^"']+)\.js(["'])/g, "$1.cjs$2");
  writeFileSync(join(dist, f.replace(/\.d\.ts$/, ".d.cts")), src);
}
console.log("built @terrawallet/server");
