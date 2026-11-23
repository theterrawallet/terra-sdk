import { Window } from "happy-dom";
import { installDom, type DomOptions, type InstalledDom } from "../../../scripts/test-dom.js";

export interface Env {
  dom: InstalledDom<Window>;
  /** Closed shadow roots, captured for inspection (production code never exposes them). */
  roots: Map<Element, ShadowRoot>;
  restore(): Promise<void>;
}

export function setupDom(opts: DomOptions = {}): Env {
  const dom = installDom(Window, opts);
  const roots = new Map<Element, ShadowRoot>();
  const proto = (dom.window as unknown as { Element: typeof Element }).Element.prototype;
  const orig = proto.attachShadow;
  proto.attachShadow = function (this: Element, init: ShadowRootInit) {
    const r = orig.call(this, init);
    roots.set(this, r);
    return r;
  };
  return {
    dom,
    roots,
    async restore() {
      proto.attachShadow = orig;
      await dom.restore();
    },
  };
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export function modalRoot(env: Env): ShadowRoot {
  const host = document.querySelector("terra-wallet-modal");
  if (!host) throw new Error("modal not open");
  return env.roots.get(host)!;
}
