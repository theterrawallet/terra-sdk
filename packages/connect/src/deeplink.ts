/**
 * Deep links into the Terra Wallet mobile app.
 *
 * The app registers the `terrawallet` scheme (and `wc`). It understands:
 *   terrawallet://wc?uri=<encoded wc: pairing URI>          pair with a dApp
 *   terrawallet://wc?requestId=<id>&sessionTopic=<topic>    bring the app forward for a pending request
 * On Android we use an `intent:` URL so Chrome opens Google Play when the app is not installed.
 */
import { TerraError } from "./errors.js";

export const TERRA_APP_SCHEME = "terrawallet";
export const TERRA_ANDROID_PACKAGE = "com.terrawallet.app";
export const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.terrawallet.app";
export const CHROME_STORE_URL = "https://chromewebstore.google.com/detail/terra-wallet/koncjgjnhmhpmonlonaonjpmeghjfdbn";
/** There is no App Store listing yet. Set this when the iOS app is live. */
export const APP_STORE_URL: string | null = null;

export type Platform = "android" | "ios" | "desktop";

/** Platform from the user agent. iPadOS reports a desktop Safari UA, so touch support is checked too. */
export function detectPlatform(ua?: string, maxTouchPoints?: number): Platform {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const agent = ua ?? nav?.userAgent ?? "";
  const touch = maxTouchPoints ?? nav?.maxTouchPoints ?? 0;
  if (/android/i.test(agent)) return "android";
  if (/iphone|ipad|ipod/i.test(agent) || (/macintosh/i.test(agent) && touch > 1)) return "ios";
  return "desktop";
}

/**
 * A WalletConnect v2 pairing URI: wc:<64 hex topic>@2?<URLSearchParams with relay-protocol and a 64 hex symKey>.
 * The query alphabet is exactly what URLSearchParams produces, so nothing else can ride along.
 */
const WC_PAIRING =
  /^wc:[0-9a-f]{64}@2\?(?=(?:[^#]*&)?symKey=[0-9a-f]{64}(?:&|$))(?=(?:[^#]*&)?relay-protocol=[a-z]+(?:&|$))[A-Za-z0-9=&._~%+*-]+$/i;

export const isWalletConnectPairingUri = (uri: unknown): uri is string => typeof uri === "string" && uri.length < 2048 && WC_PAIRING.test(uri);

/**
 * The link that opens Terra Wallet with a WalletConnect pairing request. Refuses anything that is not a valid v2
 * pairing URI, so a crafted string can never be smuggled into the app link.
 */
export function buildPairingDeepLink(wcUri: string, opts: { platform?: Platform } = {}): string {
  if (!isWalletConnectPairingUri(wcUri)) throw new TerraError("INVALID_PARAMS", "Not a WalletConnect v2 pairing URI.");
  const platform = opts.platform ?? detectPlatform();
  const query = `uri=${encodeURIComponent(wcUri)}`;
  if (platform === "android") {
    return `intent://wc?${query}#Intent;scheme=${TERRA_APP_SCHEME};package=${TERRA_ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`;
  }
  return `${TERRA_APP_SCHEME}://wc?${query}`;
}

/** The link that brings the app forward for a pending WalletConnect request (no pairing data). */
export function buildWakeDeepLink(sessionTopic?: string, requestId?: string | number): string {
  const q: string[] = [];
  if (requestId !== undefined && /^\d{1,24}$/.test(String(requestId))) q.push(`requestId=${requestId}`);
  if (sessionTopic && /^[0-9a-f]{64}$/i.test(sessionTopic)) q.push(`sessionTopic=${sessionTopic}`);
  return `${TERRA_APP_SCHEME}://wc${q.length ? `?${q.join("&")}` : ""}`;
}

/** Where to install Terra Wallet on this platform (null on iOS until the App Store listing exists). */
export function installUrl(platform: Platform = detectPlatform()): string | null {
  return platform === "android" ? PLAY_STORE_URL : platform === "ios" ? APP_STORE_URL : CHROME_STORE_URL;
}

/**
 * The only links the SDK ever navigates to:
 * - `terrawallet://...` (the app),
 * - the Android `intent://...#Intent;scheme=terrawallet;package=com.terrawallet.app;...;end` form of it,
 * - `https://...` (store pages).
 * Whitespace and control characters (CR, LF, tab, NUL) are refused outright, so nothing can be split or smuggled,
 * and `javascript:`, `data:`, `vbscript:`, `file:` or any other scheme never reaches `location`.
 */
const SAFE_LINK = {
  app: new RegExp(`^${TERRA_APP_SCHEME}://[\\x21-\\x7e]*$`),
  // Exactly one "#" (Android parses the LAST fragment), our scheme and package, an optional percent-encoded https
  // fallback, then "end".
  intent: new RegExp(
    `^intent://[\\x21\\x22\\x24-\\x7e]*#Intent;scheme=${TERRA_APP_SCHEME};package=${TERRA_ANDROID_PACKAGE.replace(/\./g, "\\.")};(?:S\\.browser_fallback_url=https%3A%2F%2F[A-Za-z0-9%._~-]+;)?end$`,
  ),
  https: /^https:\/\/[\x21-\x7e]+$/,
};

/** True for a link `openAppLink` will navigate to (see SAFE_LINK). */
export function isSafeAppLink(url: unknown): url is string {
  if (typeof url !== "string" || url.length > 4096) return false;
  if (SAFE_LINK.app.test(url) || SAFE_LINK.intent.test(url)) return true;
  if (!SAFE_LINK.https.test(url)) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password;
  } catch {
    return false;
  }
}

/**
 * Navigates to an app link built by `buildPairingDeepLink`, `buildWakeDeepLink` or `installUrl`. Anything else
 * (a `javascript:` URL, another scheme, a string with CR/LF) throws INVALID_PARAMS and navigates nowhere.
 * Kept in one place so tests and SSR can stub it.
 */
export function openAppLink(url: string): void {
  if (!isSafeAppLink(url)) throw new TerraError("INVALID_PARAMS", "openAppLink only opens terrawallet:// links, their Android intent form, or https store pages.");
  if (typeof window === "undefined") return;
  window.location.href = url;
}
