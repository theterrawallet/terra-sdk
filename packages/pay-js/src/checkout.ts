/**
 * TerraPay.open(): hosted checkout on https://pay.terrawallet.us, in a popup window or a sandboxed modal iframe.
 *
 * Mode "auto" (default): a popup (a new tab on phones) on every device. Browser wallet extensions (Terra Wallet
 * included) do not inject into iframes, and the hosted checkout does not allow framing yet (it sends
 * `frame-ancestors 'none'` until per-merchant framing ships), so a top-level checkout window is the one mode that
 * works everywhere today. A blocked popup falls back to the modal, and a checkout that never says "ready" is
 * reported through onError instead of spinning forever.
 */
import { CHECKOUT_CSS } from "./styles.js";
import { ICONS, adoptStyles, h, icon, isPhone } from "./dom.js";
import { TerraPayError, assertPublishableKey } from "./errors.js";
import { CHECKOUT_ORIGIN, buildCheckoutUrl, newSessionId, parseCheckoutMessage, type CheckoutMessage, type CheckoutMode, type CheckoutTarget } from "./protocol.js";

export type CheckoutStatus = "succeeded" | "processing" | "canceled" | "expired" | "error";

export interface CheckoutResult {
  status: CheckoutStatus;
  paymentIntentId?: string;
  subscriptionId?: string;
  invoiceId?: string;
  txHash?: string;
  chain?: string;
}

export interface OpenOptions extends CheckoutTarget {
  /** Your publishable key (tw_test_pk_... or tw_live_pk_...). Secret keys are refused. */
  publishableKey: string;
  mode?: "auto" | CheckoutMode;
  theme?: "light" | "dark" | "auto";
  /**
   * The payment went through on the checkout page. This is a UI signal only: fulfil orders from the
   * payment_intent.succeeded webhook (or by fetching the payment intent on your server), never from this callback.
   */
  onSuccess?(result: CheckoutResult): void;
  onCancel?(): void;
  onExpire?(result: CheckoutResult): void;
  onError?(error: TerraPayError): void;
  onReady?(): void;
  /** Always called last, once the checkout UI is gone. */
  onClose?(result: CheckoutResult): void;
  /**
   * How long to wait for the checkout's "ready" message before calling onError (the frame was refused, this page
   * is not an allowed origin of the publishable key, or the page is not https). Default 20000 ms.
   */
  readyTimeoutMs?: number;
}

export interface CheckoutHandle {
  readonly mode: CheckoutMode;
  /** Resolves with the final result when the checkout closes. */
  readonly closed: Promise<CheckoutResult>;
  close(): void;
  focus(): void;
}

/**
 * The sandbox for the embedded checkout, the smallest set the hosted checkout needs:
 * - allow-scripts: the checkout is an app;
 * - allow-same-origin: it calls its own same-origin API and runs Turnstile (an opaque origin would break both);
 * - allow-popups: explorer links and wallet app links open outside the frame (popups stay sandboxed: there is no
 *   allow-popups-to-escape-sandbox);
 * - allow-forms: its "I already paid" transaction-hash form (without it the submit event never fires).
 * Never granted: allow-top-navigation*, allow-modals, allow-downloads, allow-popups-to-escape-sandbox, so the
 * frame can never navigate or cover the merchant page.
 */
export const IFRAME_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-forms";

export const DEFAULT_READY_TIMEOUT_MS = 20_000;

let current: CheckoutHandle | null = null;

export function openCheckout(opts: OpenOptions): CheckoutHandle {
  if (typeof window === "undefined" || typeof document === "undefined") throw new TerraPayError("UNSUPPORTED_ENVIRONMENT");
  assertPublishableKey(opts.publishableKey);
  if (current) {
    current.focus();
    return current;
  }
  const sid = newSessionId();
  const theme = opts.theme ?? "auto";
  const wanted = opts.mode ?? "auto";
  const make = (mode: CheckoutMode) => buildCheckoutUrl(opts, { publishableKey: opts.publishableKey, mode, sid, parentOrigin: location.origin, theme });
  make("modal"); // validates the target before any UI appears

  let mode: CheckoutMode = wanted === "auto" ? "popup" : wanted;
  let popup: Window | null = null;
  if (mode === "popup") {
    const w = 460;
    const hgt = 760;
    const left = Math.max(0, Math.round((window.screenX ?? 0) + ((window.outerWidth ?? w) - w) / 2));
    const top = Math.max(0, Math.round((window.screenY ?? 0) + ((window.outerHeight ?? hgt) - hgt) / 2));
    // The window keeps `opener` (the checkout posts its messages there, to this exact origin only). Its name is
    // random and unrelated to the session id: a window name stays readable by every later page in that window.
    popup = window.open(make("popup"), `terra_pay_${newSessionId().slice(0, 12)}`, `popup=yes,width=${w},height=${hgt},left=${left},top=${top}`);
    if (!popup) {
      if (wanted === "popup") throw new TerraPayError("POPUP_BLOCKED");
      mode = "modal";
    }
  }

  let resolveClosed!: (r: CheckoutResult) => void;
  const closed = new Promise<CheckoutResult>((r) => (resolveClosed = r));
  let outcome: CheckoutResult | null = null;
  let finished = false;
  const trigger = document.activeElement as HTMLElement | null;

  // ---- UI: a closed shadow root host appended to <body>, with a native <dialog> in the top layer ----
  const host = document.createElement("terra-pay-checkout");
  const root = host.attachShadow({ mode: "closed" });
  adoptStyles(root, CHECKOUT_CSS);
  const dialog = h("dialog", { "aria-labelledby": "t", "aria-describedby": "d" });
  const wrap = h("div", { class: "t", "data-theme": theme });
  const closeBtn = h("button", { class: "x", type: "button", "aria-label": "Close checkout" }, icon(ICONS.close, 20));
  let iframe: HTMLIFrameElement | null = null;
  let loading: HTMLElement | null = null;

  if (mode === "modal") {
    loading = h("div", { class: "loading", role: "status" }, h("span", { class: "spin" }), "Loading secure checkout");
    iframe = h("iframe", { title: "Terra Pay checkout", sandbox: IFRAME_SANDBOX, allow: "clipboard-write", referrerpolicy: "strict-origin-when-cross-origin" });
    iframe.src = make("modal");
    const panel = h(
      "div",
      { class: "panel" },
      h(
        "header",
        { class: "bar" },
        h("span", { class: "lock" }, icon(ICONS.lock, 18)),
        h("div", { class: "who" }, h("strong", { id: "t" }, "Secure checkout"), h("span", { class: "origin", id: "d" }, "pay.terrawallet.us")),
        closeBtn,
      ),
      h("div", { class: "frame" }, loading, iframe),
    );
    wrap.append(h("div", { class: "scrim" }), panel);
  } else {
    const show = h("button", { class: "btn primary", type: "button" }, icon(ICONS.external, 18), "Show window");
    const cancel = h("button", { class: "btn secondary", type: "button" }, "Cancel payment");
    show.addEventListener("click", () => popup?.focus());
    cancel.addEventListener("click", () => finish({ status: "canceled" }, true));
    wrap.append(
      h("div", { class: "scrim" }),
      h(
        "div",
        { class: "card", role: "document" },
        h("span", { class: "lock" }, icon(ICONS.lock, 18)),
        h("h2", { id: "t" }, "Finish paying in the Terra Pay window"),
        h("p", { id: "d" }, "Secure checkout opened on pay.terrawallet.us. Your payment continues there."),
        h("div", { class: "row" }, cancel, show),
      ),
    );
  }
  dialog.append(wrap);
  root.append(dialog);
  document.body.append(host);

  const prevOverflow = document.documentElement.style.getPropertyValue("overflow");
  document.documentElement.style.setProperty("overflow", "hidden");
  if (typeof dialog.showModal === "function") {
    try {
      dialog.showModal();
    } catch {
      dialog.setAttribute("open", "");
    }
  } else dialog.setAttribute("open", "");
  (mode === "modal" ? closeBtn : (wrap.querySelector(".primary") as HTMLElement | null))?.focus();

  closeBtn.addEventListener("click", () => finish(outcome ?? { status: "canceled" }, true));
  // The backdrop never closes a payment in progress (only the close button or Escape do); with a popup it brings
  // the checkout window back to the front.
  wrap.querySelector(".scrim")?.addEventListener("click", () => (popup && !popup.closed ? popup.focus() : undefined));
  dialog.addEventListener("cancel", (e) => {
    e.preventDefault();
    finish(outcome ?? { status: "canceled" }, true);
  });
  dialog.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    // Keep focus inside the dialog (native modal dialogs already do; this covers engines without showModal).
    const items = [...root.querySelectorAll<HTMLElement>("button, iframe")];
    const first = items[0];
    const last = items[items.length - 1];
    const active = root.activeElement;
    if (!first || !last) return;
    if (e.shiftKey && (active === first || !active)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // ---- messages from the checkout: exact origin, exact source window, this call's session id ----
  const source = () => (mode === "modal" ? iframe?.contentWindow ?? null : popup);
  const onMessage = (ev: MessageEvent) => {
    const msg = parseCheckoutMessage(ev, { source: source(), sid });
    if (msg) handle(msg);
  };
  window.addEventListener("message", onMessage);

  const poll = mode === "popup" ? setInterval(() => popup?.closed && finish(outcome ?? { status: "canceled" }, false), 400) : undefined;

  // No "ready" in time: say why instead of leaving the shopper and the merchant guessing.
  let ready = false;
  const readyMs = typeof opts.readyTimeoutMs === "number" && Number.isFinite(opts.readyTimeoutMs) && opts.readyTimeoutMs > 0 ? opts.readyTimeoutMs : DEFAULT_READY_TIMEOUT_MS;
  const watchdog = setTimeout(() => {
    if (finished || ready) return;
    const why =
      location.protocol !== "https:"
        ? "The checkout sends its messages only to https pages."
        : mode === "modal"
          ? "The checkout could not load in a frame on this page, or this site is not an allowed origin of the publishable key."
          : "Check that this site is an allowed origin of the publishable key (dashboard, project settings).";
    loading?.replaceChildren("The secure checkout did not load here. Close this window and try again.");
    opts.onError?.(new TerraPayError("CHECKOUT_ERROR", `The checkout did not connect to this page. ${why}`));
  }, readyMs);

  function resultOf(m: CheckoutMessage, status: CheckoutStatus): CheckoutResult {
    const r: CheckoutResult = { status };
    for (const k of ["paymentIntentId", "subscriptionId", "invoiceId", "txHash", "chain"] as const) if (m[k]) r[k] = m[k];
    return r;
  }

  function handle(m: CheckoutMessage) {
    switch (m.type) {
      case "ready":
        ready = true;
        clearTimeout(watchdog);
        loading?.setAttribute("hidden", "");
        opts.onReady?.();
        break;
      case "resize":
        if (iframe && m.height && !isPhone()) iframe.style.setProperty("min-height", `${Math.min(m.height, window.innerHeight - 120)}px`);
        break;
      case "success":
        outcome = resultOf(m, m.status ?? "succeeded");
        opts.onSuccess?.(outcome);
        break;
      case "expire":
        outcome = resultOf(m, "expired");
        opts.onExpire?.(outcome);
        break;
      case "error":
        opts.onError?.(new TerraPayError("CHECKOUT_ERROR", m.errorMessage ? `Checkout: ${m.errorMessage}` : undefined));
        break;
      case "cancel":
        finish({ status: "canceled" }, true);
        break;
      case "close":
        finish(outcome ?? { status: "canceled" }, true);
        break;
    }
  }

  function finish(result: CheckoutResult, closeWindow: boolean) {
    if (finished) return;
    finished = true;
    window.removeEventListener("message", onMessage);
    if (poll) clearInterval(poll);
    clearTimeout(watchdog);
    if (closeWindow && popup && !popup.closed) popup.close();
    try {
      dialog.close();
    } catch {
      /* already closed */
    }
    host.remove();
    if (prevOverflow) document.documentElement.style.setProperty("overflow", prevOverflow);
    else document.documentElement.style.removeProperty("overflow");
    if (trigger && document.contains(trigger)) trigger.focus({ preventScroll: true });
    current = null;
    if (result.status === "canceled") opts.onCancel?.();
    opts.onClose?.(result);
    resolveClosed(result);
  }

  const handle_: CheckoutHandle = {
    mode,
    closed,
    close: () => finish(outcome ?? { status: "canceled" }, true),
    focus: () => (popup && !popup.closed ? popup.focus() : closeBtn.focus()),
  };
  current = handle_;
  return handle_;
}

export { CHECKOUT_ORIGIN };
