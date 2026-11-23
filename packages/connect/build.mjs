// Builds @terrawallet/connect: one ESM entry plus a lazily loaded WalletConnect chunk, and type declarations.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLibrary, clean, emitTypes } from "../../scripts/lib.mjs";

const pkgDir = dirname(fileURLToPath(import.meta.url));
clean(`${pkgDir}/dist`);
await buildLibrary(pkgDir, { entryPoints: { index: "src/index.ts" }, splitting: true });
emitTypes(pkgDir);
console.log("built @terrawallet/connect");
