/**
 * The page-wide default Terra Connect client used by elements that were not given one (`el.client = ...`).
 * Configure it once with `configure({...})` or with attributes on the first element (project-id, app-name,
 * chains, publishable-key).
 */
import { assertPublishableKey, createTerraConnect, type TerraConnect, type TerraConnectOptions } from "@terrawallet/connect";
import type { ThemeOptions } from "./theme.js";

export type ElementsConfig = TerraConnectOptions & { theme?: ThemeOptions };

let config: ElementsConfig = {};
let client: TerraConnect | null = null;
const listeners = new Set<() => void>();

/** Elements bound to the default client re-bind when configure() replaces it. */
export function onDefaultClientChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => void listeners.delete(cb);
}

/**
 * Sets options for the default client. Secret keys are refused. Elements on the page may already have created the
 * default client (a script tag upgrades them at once): if it is idle, it is rebuilt with the new options and the
 * elements re-bind; once a wallet is connected the options apply from the next page load.
 */
export function configure(options: ElementsConfig): void {
  if (options.publishableKey !== undefined) assertPublishableKey(options.publishableKey);
  config = { ...config, ...options };
  if (!client) return;
  const status = client.getState().status;
  if (status === "connected" || status === "connecting") {
    console.warn("[Terra] configure() ran while a wallet is connected; the new options apply from the next page load.");
    return;
  }
  client.destroy();
  client = null;
  for (const cb of [...listeners]) cb();
}

export const getConfig = (): Readonly<ElementsConfig> => config;

/** Reads client options from an element's attributes (validated; unknown values are ignored). */
export function optionsFromAttributes(el: Element): TerraConnectOptions {
  const out: TerraConnectOptions = {};
  const pid = el.getAttribute("project-id");
  if (pid && /^[0-9a-f]{32}$/i.test(pid)) out.walletConnectProjectId = pid;
  const name = el.getAttribute("app-name");
  if (name) out.appName = name.slice(0, 80);
  const chains = el.getAttribute("chains");
  if (chains) {
    const ids = chains.split(/[\s,]+/).map(Number).filter((n) => Number.isSafeInteger(n) && n > 0);
    if (ids.length) out.chains = ids;
  }
  const pk = el.getAttribute("publishable-key");
  if (pk) {
    assertPublishableKey(pk);
    out.publishableKey = pk;
  }
  return out;
}

export function getDefaultClient(from?: Element): TerraConnect {
  if (!client) client = createTerraConnect({ deepLink: "manual", ...(from ? optionsFromAttributes(from) : {}), ...config });
  return client;
}

/** Replaces the default client (for example with one your app already created). */
export function setDefaultClient(c: TerraConnect): void {
  if (client === c) return;
  client = c;
  for (const cb of [...listeners]) cb();
}
