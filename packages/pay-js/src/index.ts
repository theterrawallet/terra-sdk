/**
 * @terrawallet/pay-js: open Terra Pay hosted checkout from any page.
 *
 *   import { TerraPay } from "@terrawallet/pay-js";
 *   TerraPay.open({ paymentIntentId: "pi_...", publishableKey: "tw_test_pk_...", onSuccess, onCancel, onExpire });
 */
import { BUTTON_CSS } from "./styles.js";
import { adoptStyles, h, icon } from "./dom.js";
import { openCheckout, type CheckoutHandle, type OpenOptions } from "./checkout.js";
import { TerraPayError, assertPublishableKey } from "./errors.js";
import { CHECKOUT_ORIGIN } from "./protocol.js";

declare const __TERRA_SDK_VERSION__: string;
export const VERSION: string = typeof __TERRA_SDK_VERSION__ === "string" ? __TERRA_SDK_VERSION__ : "0.0.0-dev";

export type SubscribeOptions = Omit<OpenOptions, "checkoutUrl" | "paymentIntentId" | "planId"> & { planId: string };

export interface ButtonOptions extends Omit<OpenOptions, "theme"> {
  /** Button text. Defaults to "Pay with Terra" or "Subscribe with Terra" for plans. */
  label?: string;
  /** Corner radius in px (0 to 24). */
  radius?: number;
}

/** Opens a subscription checkout for a plan (pay.terrawallet.us/s/plan_...). */
function subscribe(opts: SubscribeOptions): CheckoutHandle {
  return openCheckout(opts);
}

/**
 * Renders a self-contained Terra Pay button (closed shadow root, so host CSS cannot restyle or hide its text) into
 * `target`. Returns a function that removes it. For a themable button use <terra-pay-button> from the elements
 * package.
 */
function mountButton(target: Element, opts: ButtonOptions): () => void {
  assertPublishableKey(opts.publishableKey);
  const host = document.createElement("terra-pay-js-button");
  const root = host.attachShadow({ mode: "closed" });
  adoptStyles(root, BUTTON_CSS);
  if (typeof opts.radius === "number") host.style.setProperty("--terra-radius", `${Math.min(24, Math.max(0, opts.radius))}px`);
  const label = (opts.label ?? (opts.planId ? "Subscribe with Terra" : "Pay with Terra")).slice(0, 60);
  const button = h("button", { type: "button" }, icon(["M7 11V8a5 5 0 0 1 10 0v3", "M5 11h14v10H5z"], 18), label);
  button.addEventListener("click", () => {
    button.disabled = true;
    const handle = openCheckout(opts);
    void handle.closed.finally(() => (button.disabled = false));
  });
  root.append(button);
  target.append(host);
  return () => host.remove();
}

/** A subscribe button for a plan. */
function mountSubscribeButton(target: Element, opts: Omit<ButtonOptions, "checkoutUrl" | "paymentIntentId"> & { planId: string }): () => void {
  return mountButton(target, opts);
}

export const TerraPay = Object.freeze({
  open: openCheckout,
  subscribe,
  mountButton,
  mountSubscribeButton,
  CHECKOUT_ORIGIN,
  VERSION,
});

export { openCheckout, subscribe, mountButton, mountSubscribeButton, CHECKOUT_ORIGIN, TerraPayError, assertPublishableKey };
export { IFRAME_SANDBOX, DEFAULT_READY_TIMEOUT_MS, type CheckoutHandle, type CheckoutResult, type CheckoutStatus, type OpenOptions } from "./checkout.js";
export { buildCheckoutUrl, checkoutPath, parseCheckoutMessage, type CheckoutMessage, type CheckoutMode, type CheckoutTarget } from "./protocol.js";
export type { TerraPayErrorCode } from "./errors.js";
