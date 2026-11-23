/**
 * DOM helpers. Every node is created with createElement and textContent: no innerHTML, no HTML strings built from
 * data, so addresses, chain names and labels can never become markup. Styles are constructable stylesheets
 * (CSP friendly, no inline <style> needed on modern engines).
 */

import { CHAIN_LOGOS } from "./logos.js";

type Child = Node | string | null | undefined | false;
type Attrs = Record<string, string | number | boolean | undefined | null>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Inline SVG icon (24 px grid, 2 px rounded strokes, like the extension's icon set). Static path data only. */
export function icon(name: keyof typeof ICONS, size = 20): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", width: size, height: size, "aria-hidden": "true", focusable: "false", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" })) {
    svg.setAttribute(k, String(v));
  }
  for (const d of ICONS[name]) {
    const p = document.createElementNS(SVG_NS, "path");
    p.setAttribute("d", d);
    svg.append(p);
  }
  return svg;
}

export const ICONS = {
  close: ["M18 6 6 18", "M6 6l12 12"],
  back: ["M15 18l-6-6 6-6"],
  chevron: ["M9 18l6-6-6-6"],
  down: ["M6 9l6 6 6-6"],
  lock: ["M7 11V8a5 5 0 0 1 10 0v3", "M5 11h14v10H5z"],
  shield: ["M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z", "M9 12l2 2 4-4"],
  alert: ["M12 9v4", "M12 17h.01", "M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"],
  copy: ["M9 9h11v11H9z", "M5 15H4V4h11v1"],
  check: ["M20 6 9 17l-5-5"],
  phone: ["M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z", "M11 18h2"],
  puzzle: ["M10 4a2 2 0 1 1 4 0v2h4v4h-2a2 2 0 1 0 0 4h2v4h-4v-2a2 2 0 1 0-4 0v2H6v-4h2a2 2 0 1 0 0-4H6V6h4z"],
  qr: ["M4 4h6v6H4z", "M14 4h6v6h-6z", "M4 14h6v6H4z", "M14 14h2v2h-2z", "M18 18h2v2h-2z", "M18 14h2", "M14 18v2"],
  external: ["M14 4h6v6", "M20 4 10 14", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"],
  power: ["M12 3v9", "M6.4 6.4a8 8 0 1 0 11.2 0"],
  retry: ["M3 12a9 9 0 0 1 15.5-6.2L21 8", "M21 3v5h-5", "M21 12a9 9 0 0 1-15.5 6.2L3 16", "M3 21v-5h5"],
} as const;

/** Attaches a stylesheet: constructable when supported, otherwise a <style> element. */
export function adoptStyles(root: ShadowRoot, sheetOrCss: CSSStyleSheet | string): void {
  if (typeof sheetOrCss !== "string") {
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheetOrCss];
    return;
  }
  const style = document.createElement("style");
  style.textContent = sheetOrCss;
  root.prepend(style);
}

/**
 * One shared constructable sheet per CSS string and document (parsed once, reused by every element instance).
 * Constructable sheets cannot be shared across documents, hence the per-document cache.
 */
const sheetsByDoc = new WeakMap<Document, Map<string, CSSStyleSheet | string>>();
export function sheetFor(css: string): CSSStyleSheet | string {
  let sheets = sheetsByDoc.get(document);
  if (!sheets) sheetsByDoc.set(document, (sheets = new Map()));
  let s = sheets.get(css);
  if (s === undefined) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      s = sheet;
    } catch {
      s = css;
    }
    sheets.set(css, s);
  }
  return s;
}

/**
 * The bundled official mark for a chain's `logo` key. Own keys only, so a custom chain whose logo is "constructor"
 * or "__proto__" never reaches an <img src>.
 */
export const logoSrc = (key: string | undefined): string | undefined =>
  key && Object.prototype.hasOwnProperty.call(CHAIN_LOGOS, key) ? CHAIN_LOGOS[key] : undefined;

export const shortAddress = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** Deterministic two-tone gradient for an address (no external identicon service). */
export function avatarGradient(address: string): string {
  let h1 = 0;
  let h2 = 0;
  for (let i = 2; i < address.length; i++) {
    const c = address.charCodeAt(i);
    h1 = (h1 * 31 + c) % 360;
    h2 = (h2 * 17 + c * 7) % 360;
  }
  if (Math.abs(h1 - h2) < 40) h2 = (h2 + 140) % 360;
  return `linear-gradient(135deg, hsl(${h1} 78% 58%), hsl(${h2} 72% 42%))`;
}

export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
