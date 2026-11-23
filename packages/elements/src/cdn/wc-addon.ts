/**
 * CDN add-on: the WalletConnect sign client as its own pinned file (terra-walletconnect.iife.js). The main CDN
 * bundle loads it lazily, only for the QR / app deep-link fallback, through a <script> tag carrying its SRI hash,
 * so a modified file is refused by the browser.
 */
import { SignClient } from "@walletconnect/sign-client";

const g = globalThis as Record<string, unknown>;
if (!("__terraWalletConnect" in g)) {
  Object.defineProperty(g, "__terraWalletConnect", { value: Object.freeze({ SignClient }), writable: false, configurable: false, enumerable: false });
}
