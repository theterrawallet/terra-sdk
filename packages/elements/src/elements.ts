/**
 * <terra-connect-button> and <terra-pay-button>.
 *
 * Classes are created inside factories (never at module load), so importing this package during server rendering
 * is safe: nothing touches HTMLElement until defineTerraElements() runs in a browser.
 *
 * Both render into a CLOSED shadow root. Host CSS cannot reach inside, attributes are read as plain text (never
 * HTML), and theme values are validated before use (see theme.ts).
 */
import { getChain, looksLikeSecretKey, toTerraError, type TerraConnect, type TerraState } from "@terrawallet/connect";
import { TerraPay, type CheckoutHandle, type CheckoutResult } from "@terrawallet/pay-js";
import { getConfig, getDefaultClient, onDefaultClientChange } from "./client.js";
import { adoptStyles, avatarGradient, h, icon, logoSrc, sheetFor, shortAddress } from "./dom.js";
import { TERRA_LOGO } from "./logos.js";
import { connectWithModal, openWalletModal } from "./modal.js";
import { BUTTON_CSS, TOKENS_CSS } from "./styles.js";
import { applyTheme, themeFromElement } from "./theme.js";

const THEME_ATTRS = ["theme", "accent", "radius", "font", "size", "block", "label"];

const text = (v: string | null, max: number, fallback: string) => {
  const s = (v ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return s ? s.slice(0, max) : fallback;
};

function emit(el: HTMLElement, name: string, detail: unknown) {
  el.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
}

function rerenderKeepingFocus(root: ShadowRoot, wrap: HTMLElement, nodes: Node[]) {
  const hadFocus = !!root.activeElement;
  wrap.replaceChildren(...nodes);
  if (hadFocus) wrap.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
}

export function createConnectButtonClass(): CustomElementConstructor {
  return class TerraConnectButton extends HTMLElement {
    static observedAttributes = THEME_ATTRS;
    #root: ShadowRoot;
    #wrap: HTMLElement;
    #client: TerraConnect | null = null;
    #unsub: (() => void) | null = null;
    #offDefault: (() => void) | null = null;
    #setupError = "";

    constructor() {
      super();
      this.#root = this.attachShadow({ mode: "closed" });
      adoptStyles(this.#root, sheetFor(TOKENS_CSS));
      adoptStyles(this.#root, sheetFor(BUTTON_CSS));
      this.#wrap = h("div", { class: "t" });
      this.#root.append(this.#wrap);
    }

    /** The Terra Connect client this button drives. Defaults to the page-wide client. */
    get client(): TerraConnect {
      return this.#client ?? getDefaultClient(this);
    }
    set client(c: TerraConnect | null) {
      this.#client = c;
      if (this.isConnected) this.#bind();
    }

    connectedCallback() {
      // A `client` set before this element was upgraded (React, other frameworks) is an own property that would
      // shadow the accessor: move it into the private field.
      if (Object.prototype.hasOwnProperty.call(this, "client")) {
        const early = (this as unknown as { client: TerraConnect | null }).client;
        delete (this as unknown as { client?: unknown }).client;
        this.#client = early;
      }
      this.#offDefault ??= onDefaultClientChange(() => {
        if (!this.#client && this.isConnected) this.#bind();
      });
      this.#bind();
    }
    disconnectedCallback() {
      this.#unsub?.();
      this.#unsub = null;
      this.#offDefault?.();
      this.#offDefault = null;
    }
    attributeChangedCallback() {
      if (this.isConnected) this.#render();
    }

    /** Opens the wallet modal (connect, or the account view when connected). */
    open() {
      this.#click();
    }

    #bind() {
      this.#unsub?.();
      this.#unsub = null;
      let c: TerraConnect;
      try {
        c = this.client;
        this.#setupError = "";
      } catch (e) {
        this.#setupError = toTerraError(e).message;
        console.error("[Terra] <terra-connect-button> setup error:", this.#setupError);
        this.#render();
        return;
      }
      const offState = c.subscribe((s: TerraState, p: TerraState) => {
        if (s.status !== p.status || s.address !== p.address || s.chainId !== p.chainId) this.#render();
        if (s.status === "connected" && p.status !== "connected") emit(this, "terra-connect", { address: s.address, chainId: s.chainId, connector: s.connector });
        else if (s.status !== "connected" && p.status === "connected") emit(this, "terra-disconnect", {});
        else if (s.status === "connected" && s.chainId !== p.chainId) emit(this, "terra-chain-changed", { chainId: s.chainId });
        else if (s.status === "connected" && s.address !== p.address) emit(this, "terra-account-changed", { address: s.address });
      });
      const offError = c.on("error", (error) => emit(this, "terra-error", { code: error.code, message: error.message }));
      this.#unsub = () => {
        offState();
        offError();
      };
      this.#render();
    }

    #click() {
      if (this.#setupError) return;
      const c = this.client;
      const theme = { ...getConfig().theme, ...themeFromElement(this, getConfig().theme) };
      if (c.getState().status === "connected") openWalletModal(c, { theme });
      else connectWithModal(c, { theme }).catch(() => {});
    }

    #render() {
      applyTheme(this.#wrap, themeFromElement(this, getConfig().theme));
      if (this.#setupError) {
        const b = h("button", { class: "btn primary", type: "button", disabled: true }, "Connect Terra Wallet");
        rerenderKeepingFocus(this.#root, this.#wrap, [b, h("span", { class: "err", role: "alert" }, this.#setupError)]);
        return;
      }
      const c = this.client;
      const s = c.getState();
      let btn: HTMLButtonElement;
      if (s.status === "connected" && s.address) {
        const chain = getChain(s.chainId ?? 0, c.chains);
        const ava = h("span", { class: "ava", "aria-hidden": "true" });
        ava.style.setProperty("background", avatarGradient(s.address));
        const logo = logoSrc(chain?.logo);
        if (logo) ava.append(h("img", { src: logo, alt: "" }));
        btn = h(
          "button",
          { class: "btn chip", type: "button", "aria-haspopup": "dialog", "aria-label": `Terra Wallet account ${shortAddress(s.address)}${chain ? ` on ${chain.name}` : ""}. Open account` },
          ava,
          h("span", { class: "addr" }, shortAddress(s.address)),
          h("span", { class: "chev" }, icon("down", 16)),
        );
      } else if (s.status === "connecting" || s.status === "reconnecting") {
        btn = h("button", { class: "btn primary", type: "button", "aria-busy": "true", "aria-haspopup": "dialog" }, h("span", { class: "spin" }), s.status === "reconnecting" ? "Reconnecting" : "Connecting");
      } else {
        btn = h(
          "button",
          { class: "btn primary", type: "button", "aria-haspopup": "dialog" },
          h("img", { class: "mark", src: TERRA_LOGO, alt: "", width: 24, height: 24, draggable: "false" }),
          text(this.getAttribute("label"), 40, "Connect Terra Wallet"),
        );
      }
      btn.addEventListener("click", () => this.#click());
      rerenderKeepingFocus(this.#root, this.#wrap, [btn]);
    }
  };
}

export function createPayButtonClass(): CustomElementConstructor {
  return class TerraPayButton extends HTMLElement {
    static observedAttributes = [...THEME_ATTRS, "payment-intent", "checkout-url", "plan", "publishable-key", "mode"];
    #root: ShadowRoot;
    #wrap: HTMLElement;
    #handle: CheckoutHandle | null = null;
    #error = "";

    constructor() {
      super();
      this.#root = this.attachShadow({ mode: "closed" });
      adoptStyles(this.#root, sheetFor(TOKENS_CSS));
      adoptStyles(this.#root, sheetFor(BUTTON_CSS));
      this.#wrap = h("div", { class: "t" });
      this.#root.append(this.#wrap);
    }

    connectedCallback() {
      this.#validate();
      this.#render();
    }
    attributeChangedCallback(name: string) {
      if (name === "publishable-key") this.#validate();
      if (this.isConnected) this.#render();
    }

    /** Opens checkout. Same as a click. */
    open(): CheckoutHandle | null {
      return this.#open();
    }

    #validate() {
      const pk = this.getAttribute("publishable-key") ?? "";
      // A secret key in page markup is already public: refuse it loudly and never use it.
      if (looksLikeSecretKey(pk)) {
        this.#error = "Setup error: a secret key was used here. Use your publishable key (tw_test_pk_ or tw_live_pk_) and rotate the secret key now.";
        console.error(`[Terra] <terra-pay-button>: ${this.#error}`);
      } else this.#error = "";
    }

    #open(): CheckoutHandle | null {
      if (this.#handle || this.#error) return this.#handle;
      const mode = this.getAttribute("mode");
      const theme = this.getAttribute("theme");
      try {
        const target = this.getAttribute("checkout-url")
          ? { checkoutUrl: this.getAttribute("checkout-url")! }
          : this.getAttribute("plan")
            ? { planId: this.getAttribute("plan")! }
            : { paymentIntentId: this.getAttribute("payment-intent") ?? "" };
        this.#handle = TerraPay.open({
          ...target,
          publishableKey: this.getAttribute("publishable-key") ?? getConfig().publishableKey ?? "",
          mode: mode === "popup" || mode === "modal" ? mode : "auto",
          theme: theme === "light" || theme === "dark" ? theme : "auto",
          onReady: () => emit(this, "terra-pay-ready", {}),
          onSuccess: (r: CheckoutResult) => emit(this, "terra-pay-success", r),
          onCancel: () => emit(this, "terra-pay-cancel", {}),
          onExpire: (r: CheckoutResult) => emit(this, "terra-pay-expire", r),
          onError: (e) => emit(this, "terra-pay-error", { code: e.code, message: e.message }),
          onClose: (r: CheckoutResult) => {
            this.#handle = null;
            emit(this, "terra-pay-close", r);
            this.#render();
          },
        });
      } catch (e) {
        const err = e as { code?: string; message?: string };
        this.#error = err.message ?? "Checkout could not open.";
        emit(this, "terra-pay-error", { code: err.code ?? "CHECKOUT_ERROR", message: this.#error });
        this.#render();
        return null;
      }
      this.#render();
      return this.#handle;
    }

    #render() {
      applyTheme(this.#wrap, themeFromElement(this, getConfig().theme));
      const plan = !!this.getAttribute("plan");
      const label = text(this.getAttribute("label"), 40, plan ? "Subscribe with Terra" : "Pay with Terra");
      const busy = !!this.#handle;
      const btn = h(
        "button",
        { class: "btn primary", type: "button", disabled: !!this.#error, "aria-busy": busy ? "true" : undefined, "aria-haspopup": "dialog", "aria-describedby": "note" },
        busy ? h("span", { class: "spin" }) : icon("lock", 18),
        busy ? "Checkout open" : label,
      );
      btn.addEventListener("click", () => {
        if (this.#handle) this.#handle.focus();
        else this.#open();
      });
      const nodes: Node[] = [btn, h("span", { class: "note", id: "note" }, icon("shield", 12), "Secure checkout on pay.terrawallet.us")];
      if (this.#error) nodes.push(h("span", { class: "err", role: "alert" }, this.#error));
      rerenderKeepingFocus(this.#root, this.#wrap, nodes);
    }
  };
}
