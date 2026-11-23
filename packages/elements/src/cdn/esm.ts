/** CDN entry for <script type="module">: import { configure } from "<pinned URL>/terra-elements.esm.js". */
import { defineTerraElements } from "../index.js";
import { setAddonBase } from "./wc-loader.js";

setAddonBase(import.meta.url);
defineTerraElements();

export * from "../index.js";
export { TerraPay } from "@terrawallet/pay-js";
