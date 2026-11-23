/**
 * Test helper: installs a happy-dom window as the Node globals (window, document, events, custom elements...).
 * Each package passes its own `Window` class so it resolves its own pinned happy-dom.
 * Node's test runner runs every test file in its own process, so globals never leak between files.
 */
const GLOBALS = [
  "window",
  "document",
  "navigator",
  "location",
  "localStorage",
  "sessionStorage",
  "Event",
  "CustomEvent",
  "MessageEvent",
  "KeyboardEvent",
  "MouseEvent",
  "FocusEvent",
  "EventTarget",
  "Node",
  "Element",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLDialogElement",
  "HTMLIFrameElement",
  "HTMLImageElement",
  "SVGElement",
  "ShadowRoot",
  "DocumentFragment",
  "CSSStyleSheet",
  "customElements",
  "getComputedStyle",
  "matchMedia",
  "MutationObserver",
  "requestAnimationFrame",
  "cancelAnimationFrame",
] as const;

export interface DomOptions {
  url?: string;
  userAgent?: string;
  maxTouchPoints?: number;
  colorScheme?: "light" | "dark";
  width?: number;
}

export interface InstalledDom<W> {
  window: W;
  restore(): Promise<void>;
}

export function installDom<W extends object>(WindowClass: new (opts: any) => W, opts: DomOptions = {}): InstalledDom<W> {
  const win = new WindowClass({
    url: opts.url ?? "https://shop.example",
    width: opts.width ?? 1280,
    height: 800,
    settings: {
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      disableIframePageLoading: true,
      navigation: { disableMainFrameNavigation: true, disableChildFrameNavigation: true, disableChildPageNavigation: true },
      navigator: {
        userAgent: opts.userAgent ?? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
        maxTouchPoints: opts.maxTouchPoints ?? 0,
      },
      device: { prefersColorScheme: opts.colorScheme ?? "dark", prefersReducedMotion: "reduce" },
    },
  }) as W & Record<string, any>;
  const g = globalThis as Record<string, unknown>;
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const key of GLOBALS) {
    saved.set(key, Object.getOwnPropertyDescriptor(g, key));
    let value = key === "window" ? win : win[key];
    if (typeof value === "function" && /^[a-z]/.test(key)) value = value.bind(win);
    Object.defineProperty(g, key, { value, configurable: true, writable: true, enumerable: true });
  }
  return {
    window: win,
    async restore() {
      for (const [key, desc] of saved) {
        if (desc) Object.defineProperty(g, key, desc);
        else delete g[key];
      }
      await win.happyDOM?.abort?.();
      win.happyDOM?.close?.();
    },
  };
}
