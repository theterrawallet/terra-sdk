/**
 * @terrawallet/elements: <terra-connect-button> and <terra-pay-button> Web Components.
 *
 *   import { defineTerraElements, configure } from "@terrawallet/elements";
 *   configure({ walletConnectProjectId: "...", appName: "My shop" });
 *   defineTerraElements();
 *
 * Or import "@terrawallet/elements/auto" (registers on import), or use the CDN script tag (see README).
 */
import { createConnectButtonClass, createPayButtonClass } from "./elements.js";

declare const __TERRA_SDK_VERSION__: string;
export const VERSION: string = typeof __TERRA_SDK_VERSION__ === "string" ? __TERRA_SDK_VERSION__ : "0.0.0-dev";

/** Registers <terra-connect-button> and <terra-pay-button>. Safe to call more than once, and a no-op on servers. */
export function defineTerraElements(): void {
  if (typeof window === "undefined" || typeof customElements === "undefined") return;
  if (!customElements.get("terra-connect-button")) customElements.define("terra-connect-button", createConnectButtonClass());
  if (!customElements.get("terra-pay-button")) customElements.define("terra-pay-button", createPayButtonClass());
}

export { configure, getDefaultClient, setDefaultClient, onDefaultClientChange, type ElementsConfig } from "./client.js";
export { openWalletModal, connectWithModal, closeWalletModal, isWalletModalOpen, type ModalHandle, type ModalOptions } from "./modal.js";
export { encodeQr, renderQrSvg, type QrMatrix, type Ecc } from "./qr.js";
export { resolveAccent, resolveRadius, resolveMode, parseColor, contrast, DEFAULT_ACCENT, type ThemeOptions, type ThemeMode } from "./theme.js";
export { TERRA_LOGO, CHAIN_LOGOS } from "./logos.js";
