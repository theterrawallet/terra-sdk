/**
 * The Terra Wallet modal: connect (extension, app QR code, app deep link), approval, errors and the account view
 * (address, network switcher, disconnect). One instance per page, in a closed shadow root, shown with the native
 * <dialog>.showModal(): it sits in the browser's top layer, so page CSS and z-index can neither cover nor restyle
 * it, the rest of the page is inert, and Escape closes it.
 *
 * Security prompts that theming can never hide: the requesting origin (with an http warning) and the
 * recovery-phrase warning in the footer.
 */
import {
  APP_STORE_URL,
  CHROME_STORE_URL,
  PLAY_STORE_URL,
  TerraError,
  buildPairingDeepLink,
  openAppLink,
  toTerraError,
  type ConnectResult,
  type Detection,
  type TerraChain,
  type TerraConnect,
} from "@terrawallet/connect";
import { avatarGradient, h, icon, logoSrc, sheetFor, adoptStyles, shortAddress } from "./dom.js";
import { TERRA_LOGO } from "./logos.js";
import { renderQrSvg } from "./qr.js";
import { MODAL_CSS, TOKENS_CSS } from "./styles.js";
import { applyTheme, type ThemeOptions } from "./theme.js";

type View = "start" | "qr" | "mobile" | "connecting" | "error" | "account";

export interface ModalOptions {
  theme?: ThemeOptions;
}

export interface ModalHandle {
  close(): void;
  /** Resolves when the modal closes. */
  readonly closed: Promise<void>;
}

const RECOVERY_NOTE = "Terra Wallet never asks for your recovery phrase. Only approve requests you started.";

export function chainLogo(chain: TerraChain | undefined, size = 24): HTMLElement {
  const src = logoSrc(chain?.logo);
  if (src) return h("img", { class: "logo", src, alt: "", width: size, height: size, draggable: "false" });
  return h("span", { class: "mono", "aria-hidden": "true" }, (chain?.name ?? "?").slice(0, 1).toUpperCase());
}

function originInfo(): { host: string; secure: boolean } {
  try {
    const { protocol, host, hostname } = location;
    const local = hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
    return { host: host || "this page", secure: protocol === "https:" || local };
  } catch {
    return { host: "this page", secure: false };
  }
}

class WalletModal {
  private host: HTMLElement;
  private root: ShadowRoot;
  private dialog: HTMLDialogElement;
  private panel: HTMLElement;
  private live: HTMLElement;
  private client: TerraConnect | null = null;
  private view: View = "start";
  private detection: Detection | null = null;
  private error: TerraError | null = null;
  private lastMethod: "injected" | "walletconnect" = "injected";
  private busyChain: number | null = null;
  private chainError = "";
  private copied = false;
  private tapped = false;
  private unsub: (() => void) | null = null;
  private onConnected: ((r: ConnectResult) => void) | null = null;
  private onDismiss: ((e: TerraError) => void) | null = null;
  private closedResolve: (() => void) | null = null;
  private trigger: HTMLElement | null = null;
  private prevOverflow = "";
  private renderedView: View | null = null;
  private lastUri: string | null = null;
  /** Bumped whenever the user abandons an attempt (Back, Close), so its late result is ignored. */
  private attemptId = 0;
  isOpen = false;
  readonly doc: Document = document;

  constructor() {
    this.host = document.createElement("terra-wallet-modal");
    this.root = this.host.attachShadow({ mode: "closed" });
    adoptStyles(this.root, sheetFor(TOKENS_CSS));
    adoptStyles(this.root, sheetFor(MODAL_CSS));
    this.dialog = h("dialog", { "aria-labelledby": "terra-title", "aria-describedby": "terra-desc" });
    this.panel = h("div", { class: "panel" });
    this.live = h("p", { class: "sr", "aria-live": "polite", "aria-atomic": "true" });
    const t = h("div", { class: "t" }, h("div", { class: "scrim" }), this.panel, this.live);
    this.dialog.append(t);
    this.root.append(this.dialog);
    this.dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.close();
    });
    this.dialog.addEventListener("keydown", (e) => this.onKey(e));
    t.querySelector(".scrim")?.addEventListener("click", () => this.close());
  }

  open(client: TerraConnect, opts: ModalOptions = {}): ModalHandle {
    if (this.isOpen && this.client !== client) this.close();
    this.client = client;
    applyTheme(this.dialog.firstElementChild as HTMLElement, opts.theme ?? {});
    const closed = new Promise<void>((r) => (this.closedResolve = r));
    if (!this.isOpen) {
      this.isOpen = true;
      this.trigger = document.activeElement as HTMLElement | null;
      document.body.append(this.host);
      this.prevOverflow = document.documentElement.style.getPropertyValue("overflow");
      document.documentElement.style.setProperty("overflow", "hidden");
      try {
        if (typeof this.dialog.showModal === "function") this.dialog.showModal();
        else this.dialog.setAttribute("open", "");
      } catch {
        this.dialog.setAttribute("open", "");
      }
      this.unsub = client.subscribe((s, prev) => {
        if (s.pairingUri !== prev.pairingUri || s.chainId !== prev.chainId || s.address !== prev.address || s.status !== prev.status) this.onState();
      });
    }
    this.error = null;
    this.view = client.getState().status === "connected" ? "account" : "start";
    this.render();
    if (this.view === "start") void this.runDetection();
    return { close: () => this.close(), closed };
  }

  /** Opens and resolves once connected; rejects with USER_REJECTED when the user closes it first. */
  connect(client: TerraConnect, opts: ModalOptions = {}): Promise<ConnectResult> {
    const s = client.getState();
    if (s.status === "connected" && s.address && s.chainId && s.connector) return Promise.resolve({ address: s.address, chainId: s.chainId, connector: s.connector });
    return new Promise((resolve, reject) => {
      this.onDismiss?.(new TerraError("USER_REJECTED", "The wallet modal was closed."));
      this.onConnected = resolve;
      this.onDismiss = reject;
      this.open(client, opts);
    });
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.attemptId++;
    const client = this.client;
    if (client && (this.view === "qr" || this.view === "mobile" || this.view === "connecting") && client.getState().status === "connecting") client.cancel();
    this.unsub?.();
    this.unsub = null;
    try {
      this.dialog.close();
    } catch {
      this.dialog.removeAttribute("open");
    }
    this.host.remove();
    if (this.prevOverflow) document.documentElement.style.setProperty("overflow", this.prevOverflow);
    else document.documentElement.style.removeProperty("overflow");
    if (this.trigger && document.contains(this.trigger)) this.trigger.focus({ preventScroll: true });
    const reject = this.onDismiss;
    this.onConnected = this.onDismiss = null;
    reject?.(new TerraError("USER_REJECTED", "The wallet modal was closed."));
    this.renderedView = null;
    this.lastUri = null;
    this.closedResolve?.();
    this.closedResolve = null;
  }

  // ------------------------------------------------------------------ flow
  private async runDetection() {
    const client = this.client!;
    this.detection = null;
    const d = await client.detect().catch((): Detection => ({ injected: false, solana: false, platform: client.platform, walletConnect: false }));
    if (!this.isOpen || this.client !== client || this.view !== "start") return;
    this.detection = d;
    if (!d.injected && d.walletConnect) this.startWalletConnect();
    else this.render();
  }

  private async startInjected() {
    this.lastMethod = "injected";
    this.go("connecting");
    await this.attempt(() => this.client!.connect({ method: "injected" }));
  }

  private startWalletConnect() {
    const client = this.client!;
    this.lastMethod = "walletconnect";
    this.tapped = false;
    this.go(client.platform === "desktop" ? "qr" : "mobile");
    void this.attempt(() => client.connect({ method: "walletconnect" }));
    const id = this.attemptId;
    // No pairing link after 15 s: the relay is unreachable (offline, blocked by a firewall or the page's CSP).
    setTimeout(() => {
      if (!this.isOpen || this.attemptId !== id || client.getState().pairingUri || (this.view !== "qr" && this.view !== "mobile")) return;
      this.attemptId++;
      client.cancel();
      this.error = new TerraError("TIMEOUT", "Could not reach WalletConnect. Check your connection and try again.");
      this.go("error");
    }, 15_000);
  }

  private async attempt(run: () => Promise<ConnectResult>) {
    const client = this.client;
    const id = ++this.attemptId;
    try {
      const r = await run();
      if (!this.isOpen || this.client !== client || id !== this.attemptId) return;
      this.announce("Connected to Terra Wallet.");
      const done = this.onConnected;
      this.onConnected = this.onDismiss = null;
      done?.(r);
      this.close();
    } catch (e) {
      if (!this.isOpen || this.client !== client || id !== this.attemptId) return;
      this.error = toTerraError(e);
      this.go("error");
    }
  }

  private retry() {
    this.error = null;
    if (this.lastMethod === "walletconnect") this.startWalletConnect();
    else void this.startInjected();
  }

  private back() {
    this.attemptId++;
    if (this.client?.getState().status === "connecting") this.client.cancel();
    this.go("start");
    if (!this.detection) void this.runDetection();
  }

  private async switchTo(chain: TerraChain) {
    if (!this.client || this.busyChain !== null) return;
    this.busyChain = chain.id;
    this.chainError = "";
    this.render();
    try {
      await this.client.switchChain(chain.id);
      this.announce(`Switched to ${chain.name}.`);
    } catch (e) {
      const err = toTerraError(e);
      this.chainError = err.code === "USER_REJECTED" ? "The network switch was cancelled in Terra Wallet." : err.message;
    } finally {
      this.busyChain = null;
      if (this.isOpen) this.render();
    }
  }

  private async copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      this.copied = true;
      this.announce("Copied.");
      this.render();
      setTimeout(() => {
        this.copied = false;
        if (this.isOpen) this.render();
      }, 1600);
    } catch {
      this.announce("Copying is blocked in this browser.");
    }
  }

  private onState() {
    if (!this.isOpen || !this.client) return;
    const s = this.client.getState();
    if (s.status === "connected" && this.view !== "account" && s.address && s.chainId && s.connector) {
      // Connected by another path (an auto-reconnect, or the approval landed): finish the pending connect.
      const done = this.onConnected;
      if (done) {
        this.onConnected = this.onDismiss = null;
        done({ address: s.address, chainId: s.chainId, connector: s.connector });
        this.close();
      } else this.go("account");
      return;
    }
    if (this.view === "account" && s.status !== "connected") {
      this.go("start");
      void this.runDetection();
      return;
    }
    if (this.view === "account" || ((this.view === "qr" || this.view === "mobile") && s.pairingUri !== this.lastUri)) this.render();
  }

  private go(view: View) {
    this.view = view;
    this.render();
  }

  private announce(msg: string) {
    this.live.textContent = "";
    setTimeout(() => (this.live.textContent = msg), 30);
  }

  private onKey(e: KeyboardEvent) {
    if (e.key === "Escape" && typeof this.dialog.showModal !== "function") {
      e.preventDefault();
      this.close();
      return;
    }
    if (e.key !== "Tab") return;
    const items = [...this.panel.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],[tabindex="0"]')];
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = this.root.activeElement;
    if (e.shiftKey && (active === first || !this.panel.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !this.panel.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

  // ------------------------------------------------------------------ rendering
  private render() {
    if (!this.client) return;
    const viewChanged = this.renderedView !== this.view;
    const focusKey = (this.root.activeElement as HTMLElement | null)?.dataset?.key;
    const body = h("div", { class: viewChanged ? "view" : undefined });
    switch (this.view) {
      case "start":
        this.renderStart(body);
        break;
      case "qr":
        this.renderQr(body);
        break;
      case "mobile":
        this.renderMobile(body);
        break;
      case "connecting":
        this.renderConnecting(body);
        break;
      case "error":
        this.renderError(body);
        break;
      case "account":
        this.renderAccount(body);
        break;
    }
    body.append(h("div", { class: "foot" }, icon("shield", 16), h("span", { id: "terra-note" }, RECOVERY_NOTE)));
    this.panel.replaceChildren(h("div", { class: "grab", "aria-hidden": "true" }), body);
    this.renderedView = this.view;
    // Keep focus on the same control across re-renders; otherwise move it to the view's main action or title.
    const kept = focusKey && !viewChanged && /^[\w-]+$/.test(focusKey) ? this.panel.querySelector<HTMLElement>(`[data-key="${focusKey}"]`) : null;
    (kept ?? this.panel.querySelector<HTMLElement>("[data-autofocus]") ?? this.panel.querySelector<HTMLElement>(".title"))?.focus({ preventScroll: true });
  }

  private header(title: string, opts: { back?: boolean; logo?: boolean } = {}): HTMLElement {
    const close = h("button", { class: "ib", type: "button", "aria-label": "Close", "data-key": "close" }, icon("close", 20));
    close.addEventListener("click", () => this.close());
    let lead: HTMLElement;
    if (opts.back) {
      lead = h("button", { class: "ib", type: "button", "aria-label": "Back", "data-key": "back" }, icon("back", 20));
      lead.addEventListener("click", () => this.back());
    } else lead = h("img", { class: "mark", src: TERRA_LOGO, alt: "", width: 32, height: 32 });
    return h("header", {}, lead, h("h2", { class: "title", id: "terra-title", tabindex: "-1" }, title), close);
  }

  /** The requesting site, always shown while connecting; http (not localhost) is flagged. */
  private origin(verb: string): HTMLElement {
    const { host, secure } = originInfo();
    return h(
      "div",
      { class: secure ? "origin" : "origin warn", id: "terra-desc" },
      icon(secure ? "lock" : "alert", 18),
      h("span", {}, h("b", {}, host), secure ? ` ${verb}` : ` ${verb}. This connection is not secure (http).`),
    );
  }

  private row(opts: { key: string; title: string; sub: string; tile: Node; end?: Node; hero?: boolean; href?: string; disabled?: boolean; onClick?: () => void }): HTMLElement {
    const inner = [opts.tile instanceof HTMLImageElement ? h("span", { class: "tile" }, opts.tile) : h("span", { class: "tile" }, opts.tile), h("span", { class: "txt" }, h("span", { class: "t1" }, opts.title), h("span", { class: "t2" }, opts.sub)), opts.end ?? h("span", { class: "end" }, icon(opts.href ? "external" : "chevron", 18))];
    if (opts.href) {
      return h("a", { class: "row", href: opts.href, target: "_blank", rel: "noopener noreferrer", "data-key": opts.key }, ...inner);
    }
    const b = h("button", { class: opts.hero ? "row hero" : "row", type: "button", "data-key": opts.key, "aria-disabled": opts.disabled ? "true" : undefined }, ...inner);
    if (opts.onClick && !opts.disabled) b.addEventListener("click", opts.onClick);
    return b;
  }

  private installRows(d: Detection): HTMLElement[] {
    const rows: HTMLElement[] = [];
    if (d.platform === "desktop") rows.push(this.row({ key: "get-ext", title: "Add the browser extension", sub: "Chrome Web Store", tile: icon("puzzle", 20), href: CHROME_STORE_URL }));
    if (d.platform !== "ios") rows.push(this.row({ key: "get-android", title: "Get the Android app", sub: "Google Play", tile: icon("phone", 20), href: PLAY_STORE_URL }));
    if (d.platform === "ios") {
      rows.push(
        APP_STORE_URL
          ? this.row({ key: "get-ios", title: "Get the iPhone app", sub: "App Store", tile: icon("phone", 20), href: APP_STORE_URL })
          : this.row({ key: "get-ios", title: "iPhone app coming soon", sub: "Use the Android app or the browser extension for now", tile: icon("phone", 20), disabled: true, end: h("span") }),
      );
    }
    return rows;
  }

  private renderStart(body: HTMLElement) {
    body.append(this.header("Connect Terra Wallet"), this.origin("wants to connect to your wallet"));
    const d = this.detection;
    if (!d) {
      body.append(h("div", { class: "list", "aria-busy": "true" }, h("div", { class: "skel" }), h("div", { class: "skel" })), h("p", { class: "sr" }, "Looking for Terra Wallet"));
      return;
    }
    const main: HTMLElement[] = [];
    if (d.injected) {
      main.push(
        this.row({
          key: "injected",
          hero: true,
          title: d.platform === "desktop" ? "Terra Wallet extension" : "Terra Wallet",
          sub: d.platform === "desktop" ? "Detected in this browser" : "Detected in this app",
          tile: h("img", { src: TERRA_LOGO, alt: "", width: 40, height: 40 }),
          end: h("span", { class: "pill" }, "Detected"),
          onClick: () => void this.startInjected(),
        }),
      );
      main[0]!.setAttribute("data-autofocus", "");
    }
    if (d.walletConnect) {
      main.push(
        d.platform === "desktop"
          ? this.row({ key: "qr", title: "Terra Wallet app", sub: "Scan a QR code with your phone", tile: icon("qr", 20), onClick: () => this.startWalletConnect() })
          : this.row({ key: "app", title: "Open the Terra Wallet app", sub: "Approve there, then come back", tile: icon("phone", 20), onClick: () => this.startWalletConnect() }),
      );
    }
    if (main.length) body.append(h("div", { class: "list" }, ...main));
    if (!d.injected) {
      body.append(h("p", { class: "label" }, main.length ? "New to Terra Wallet?" : "Install Terra Wallet to continue"), h("div", { class: "list" }, ...this.installRows(d)));
    }
  }

  private renderQr(body: HTMLElement) {
    const uri = this.client!.getState().pairingUri;
    this.lastUri = uri;
    body.append(this.header("Scan with Terra Wallet", { back: true }), this.origin("wants to connect to your wallet"));
    const qr = h("div", { class: "qr" });
    if (uri) qr.append(renderQrSvg(uri, { size: 232, logo: TERRA_LOGO, label: "WalletConnect QR code for Terra Wallet" }));
    else qr.append(h("div", { class: "ph", role: "img", "aria-label": "Preparing a secure QR code" }));
    const copy = h("button", { class: "btn secondary sm", type: "button", "data-key": "copy", disabled: !uri }, icon(this.copied ? "check" : "copy", 16), this.copied ? "Copied" : "Copy link");
    copy.addEventListener("click", () => uri && void this.copy(uri));
    body.append(
      h("div", { class: "qrbox" }, qr, h("p", { class: "hint" }, "Open Terra Wallet on your phone, tap Scan, and point it at this code."), copy),
      h("p", { class: "label" }, "No app yet?"),
      h("div", { class: "list" }, ...this.installRows({ injected: false, solana: false, platform: "desktop", walletConnect: true })),
    );
  }

  private renderMobile(body: HTMLElement) {
    const uri = this.client!.getState().pairingUri;
    this.lastUri = uri;
    const platform = this.client!.platform;
    body.append(this.header("Open Terra Wallet", { back: !!this.detection?.injected }), this.origin("wants to connect to your wallet"));
    const open = h(
      "button",
      { class: "btn primary", type: "button", "data-key": "open-app", "data-autofocus": "", disabled: !uri },
      ...(uri ? [h("img", { class: "mark", src: TERRA_LOGO, alt: "", width: 22, height: 22, style: undefined }), this.tapped ? "Open Terra Wallet again" : "Open Terra Wallet"] : [h("span", { class: "spin" }), "Preparing"]),
    );
    open.addEventListener("click", () => {
      if (!uri) return;
      this.tapped = true;
      openAppLink(buildPairingDeepLink(uri, { platform }));
      this.render();
    });
    body.append(
      h(
        "div",
        { class: "state" },
        h("div", { class: "ring" }, h("img", { src: TERRA_LOGO, alt: "", width: 54, height: 54 })),
        h("h3", {}, this.tapped ? "Approve in Terra Wallet" : "Connect with the app"),
        h("p", {}, this.tapped ? "Approve the connection in the app, then come back to this page." : "Terra Wallet opens and asks you to approve this site."),
      ),
      h("div", { class: "actions one" }, open),
      h("div", { class: "list" }, ...this.installRows(this.detection ?? { injected: false, solana: false, platform, walletConnect: true })),
    );
  }

  private renderConnecting(body: HTMLElement) {
    const desktop = this.client!.platform === "desktop";
    const { host } = originInfo();
    const cancel = h("button", { class: "btn secondary", type: "button", "data-key": "cancel", "data-autofocus": "" }, "Cancel");
    cancel.addEventListener("click", () => this.back());
    body.append(
      this.header("Connect Terra Wallet"),
      this.origin("wants to connect to your wallet"),
      h(
        "div",
        { class: "state", role: "status" },
        h("div", { class: "ring" }, h("img", { src: TERRA_LOGO, alt: "", width: 54, height: 54 })),
        h("h3", {}, "Approve in Terra Wallet"),
        h("p", {}, desktop ? `Open the Terra Wallet extension to approve the connection from ${host}.` : `Approve the connection from ${host} in Terra Wallet.`),
      ),
      h("div", { class: "actions one" }, cancel),
    );
  }

  private renderError(body: HTMLElement) {
    const e = this.error ?? new TerraError("UNKNOWN");
    const rejected = e.code === "USER_REJECTED";
    const title = rejected ? "Request cancelled" : e.code === "REQUEST_PENDING" ? "Request already open" : e.code === "NOT_INSTALLED" ? "Terra Wallet not found" : e.code === "TIMEOUT" ? "Connection timed out" : "Could not connect";
    const message = rejected ? "The connection was cancelled. You can try again." : e.message;
    const close = h("button", { class: "btn secondary", type: "button", "data-key": "err-close" }, "Close");
    close.addEventListener("click", () => this.close());
    const again = h("button", { class: "btn primary", type: "button", "data-key": "retry", "data-autofocus": "" }, icon("retry", 18), "Try again");
    again.addEventListener("click", () => this.retry());
    body.append(
      this.header("Connect Terra Wallet"),
      h("div", { class: "state", role: "alert" }, h("div", { class: "badge-tile" }, icon("alert", 26)), h("h3", {}, title), h("p", {}, message)),
      h("div", { class: "actions" }, close, again),
    );
  }

  private renderAccount(body: HTMLElement) {
    const client = this.client!;
    const s = client.getState();
    const address = s.address ?? "";
    const current = client.chains.find((c) => c.id === s.chainId);
    const ava = h("span", { class: "ava", "aria-hidden": "true" });
    ava.style.setProperty("background", avatarGradient(address));
    const currentLogo = logoSrc(current?.logo);
    if (currentLogo) ava.append(h("img", { src: currentLogo, alt: "" }));
    const copy = h("button", { class: "ib", type: "button", "aria-label": this.copied ? "Address copied" : "Copy address", "data-key": "copy" }, icon(this.copied ? "check" : "copy", 18));
    copy.addEventListener("click", () => void this.copy(address));
    const via = s.connector === "walletconnect" ? "Terra Wallet app" : "Terra Wallet extension";
    body.append(
      this.header("Terra Wallet"),
      h(
        "div",
        { class: "acct", id: "terra-desc" },
        ava,
        h("span", { class: "txt" }, h("span", { class: "addr", title: address }, h("span", { class: "sr" }, `Account ${address}`), h("span", { "aria-hidden": "true" }, shortAddress(address))), h("span", { class: "t2" }, `${via} on ${originInfo().host}`)),
        copy,
      ),
    );
    const nets = client.chains.map((c) => {
      const active = c.id === s.chainId;
      const busy = this.busyChain === c.id;
      const b = h(
        "button",
        { class: "net", type: "button", "data-key": `net-${c.id}`, "aria-current": active ? "true" : undefined, "aria-busy": busy ? "true" : undefined },
        chainLogo(c),
        h("span", {}, c.name),
        busy ? h("span", { class: "end" }, h("span", { class: "spin" })) : active ? h("span", { class: "end" }, icon("check", 18)) : null,
      );
      if (!active) b.addEventListener("click", () => void this.switchTo(c));
      return b;
    });
    body.append(h("p", { class: "label", id: "terra-nets" }, "Network"), h("div", { class: "nets", role: "group", "aria-labelledby": "terra-nets" }, ...nets));
    if (this.chainError) body.append(h("p", { class: "inline-err", role: "alert" }, this.chainError));
    const disconnect = h("button", { class: "btn danger", type: "button", "data-key": "disconnect" }, icon("power", 18), "Disconnect");
    disconnect.addEventListener("click", () => {
      void client.disconnect();
      this.announce("Disconnected.");
      this.close();
    });
    body.append(h("div", { class: "actions one" }, disconnect));
  }
}

let modal: WalletModal | null = null;
const instance = () => {
  if (!modal || modal.doc !== document) modal = new WalletModal();
  return modal;
};

/** Opens the wallet modal: connect options when disconnected, the account view when connected. */
export function openWalletModal(client: TerraConnect, opts?: ModalOptions): ModalHandle {
  return instance().open(client, opts);
}

/** Connects through the modal. Resolves when connected; rejects with USER_REJECTED if closed first. */
export function connectWithModal(client: TerraConnect, opts?: ModalOptions): Promise<ConnectResult> {
  return instance().connect(client, opts);
}

export function closeWalletModal(): void {
  modal?.close();
}

export const isWalletModalOpen = () => !!modal?.isOpen;
