/**
 * CDN entry for <script src="terra-elements.iife.js" integrity="sha384-..." crossorigin="anonymous">.
 *
 * Optional zero-JavaScript setup through the script tag's own attributes:
 *   data-project-id="<WalletConnect project id>" data-app-name="My shop" data-chains="8453,1"
 */
import { TerraPay } from "@terrawallet/pay-js";
import * as api from "../index.js";
import { setAddonBase } from "./wc-loader.js";

const script = typeof document !== "undefined" ? (document.currentScript as HTMLScriptElement | null) : null;
if (script?.src) setAddonBase(script.src);
if (script) {
  const d = script.dataset;
  const chains = (d.chains ?? "").split(/[\s,]+/).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
  api.configure({
    ...(d.projectId && /^[0-9a-f]{32}$/i.test(d.projectId) ? { walletConnectProjectId: d.projectId } : {}),
    ...(d.appName ? { appName: d.appName.slice(0, 80) } : {}),
    ...(chains.length ? { chains } : {}),
  });
}
api.defineTerraElements();

const g = globalThis as { TerraElements?: unknown };
if (!g.TerraElements) g.TerraElements = Object.freeze({ ...api, TerraPay });
