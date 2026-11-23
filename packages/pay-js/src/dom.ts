/**
 * DOM helpers. Every node is built with createElement / textContent: no innerHTML, no HTML strings from data, so
 * merchant or checkout text can never become markup. Styles go through constructable stylesheets (CSP friendly).
 */

type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string | undefined> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) el.setAttribute(k, v);
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** An inline SVG icon from static path data (24x24 grid, stroke style like the extension's icons). */
export function icon(paths: readonly string[], size = 20, opts: { fill?: boolean; cls?: string } = {}): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  if (opts.cls) svg.setAttribute("class", opts.cls);
  svg.setAttribute("fill", opts.fill ? "currentColor" : "none");
  if (!opts.fill) {
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
  }
  for (const d of paths) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}

export const ICONS = {
  lock: ["M7 11V8a5 5 0 0 1 10 0v3", "M5 11h14v10H5z"],
  close: ["M18 6 6 18", "M6 6l12 12"],
  external: ["M14 4h6v6", "M20 4 10 14", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"],
} as const;

/** Attaches styles to a shadow root: a constructable stylesheet when supported, a <style> element otherwise. */
export function adoptStyles(root: ShadowRoot, css: string): void {
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    return;
  } catch {
    /* older engines: fall through */
  }
  const style = document.createElement("style");
  style.textContent = css;
  root.prepend(style);
}

export const prefersReducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export const isPhone = () => typeof matchMedia === "function" && matchMedia("(max-width: 640px), (pointer: coarse) and (max-width: 900px)").matches;
