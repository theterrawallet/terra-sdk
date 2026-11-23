// Builds @terrawallet/react: index (hooks + components, marked "use client" for React Server Components) and the
// wagmi connector (no directive: wagmi configs are often imported on the server for SSR), plus types.
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLibrary, clean, emitTypes } from "../../scripts/lib.mjs";

const pkgDir = dirname(fileURLToPath(import.meta.url));
clean(`${pkgDir}/dist`);
await buildLibrary(pkgDir, { entryPoints: { index: "src/index.ts" }, banner: '"use client";' });
await buildLibrary(pkgDir, { entryPoints: { wagmi: "src/wagmi.ts" } });
emitTypes(pkgDir);
console.log("built @terrawallet/react");
