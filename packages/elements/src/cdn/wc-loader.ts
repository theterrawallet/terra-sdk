/**
 * Stands in for "@walletconnect/sign-client" inside the CDN bundles (wired by an esbuild alias in build.mjs).
 * Loads terra-walletconnect.iife.js from the same pinned directory as the main script, with the integrity hash
 * that was computed at build time and baked in below. Trusted Types aware (policy name "terra-sdk").
 */
declare const __TERRA_WC_ADDON__: { file: string; integrity: string };

interface SignClientStatic {
  init(opts: Record<string, unknown>): Promise<unknown>;
}

let base = "";
let loaded: Promise<SignClientStatic> | null = null;
let policy: { createScriptURL(u: string): unknown } | null | undefined;

/** Called by the CDN entry with its own script URL (document.currentScript.src or import.meta.url). */
export function setAddonBase(url: string): void {
  base = url;
}

function addonUrl(): string {
  if (!base) throw new Error("Terra: the CDN script URL is unknown, so the WalletConnect add-on cannot be located.");
  return new URL(__TERRA_WC_ADDON__.file, base).href;
}

function trustedUrl(url: string): unknown {
  const tt = (globalThis as { trustedTypes?: { createPolicy(n: string, p: object): { createScriptURL(u: string): unknown } } }).trustedTypes;
  if (!tt?.createPolicy) return url;
  if (policy === undefined) {
    try {
      policy = tt.createPolicy("terra-sdk", {
        createScriptURL: (u: string) => {
          if (u !== addonUrl()) throw new TypeError("Terra: unexpected script URL.");
          return u;
        },
      });
    } catch {
      policy = null;
    }
  }
  return policy ? policy.createScriptURL(url) : url;
}

function load(): Promise<SignClientStatic> {
  if (!loaded) {
    loaded = new Promise<SignClientStatic>((resolve, reject) => {
      const s = document.createElement("script");
      (s as unknown as { src: unknown }).src = trustedUrl(addonUrl());
      s.integrity = __TERRA_WC_ADDON__.integrity;
      s.crossOrigin = "anonymous";
      s.async = true;
      s.onload = () => {
        const mod = (globalThis as { __terraWalletConnect?: { SignClient?: SignClientStatic } }).__terraWalletConnect;
        if (mod?.SignClient && typeof mod.SignClient.init === "function") resolve(mod.SignClient);
        else reject(new Error("Terra: the WalletConnect add-on did not initialise."));
      };
      s.onerror = () => reject(new Error("Terra: could not load the WalletConnect add-on (offline, blocked by CSP, or integrity mismatch)."));
      document.head.append(s);
    });
    loaded.catch(() => (loaded = null));
  }
  return loaded;
}

export const SignClient: SignClientStatic = {
  init: async (opts) => (await load()).init(opts),
};
export default SignClient;
