/**
 * Theming: mode (light, dark, auto), accent colour, corner radius and font.
 *
 * Partners theme through attributes or CSS custom properties on the element (--terra-accent, --terra-radius,
 * --terra-font). Every value is parsed and validated here, then written to PRIVATE variables inside the closed
 * shadow root, so a theme can never inject CSS, and the accent always keeps WCAG AA contrast with its text.
 * Security texts (requesting origin, recovery-phrase warning) never use the accent and cannot be themed away.
 */

export type ThemeMode = "light" | "dark" | "auto";
export type RadiusPreset = "none" | "sm" | "md" | "lg";

export interface ThemeOptions {
  mode?: ThemeMode;
  /** #rgb, #rrggbb or rgb(r, g, b). */
  accent?: string;
  /** px (0 to 24) or a preset. */
  radius?: number | RadiusPreset;
  /** A font-family list, e.g. "Inter, system-ui, sans-serif". */
  font?: string;
}

export type Rgb = [number, number, number];

export const DEFAULT_ACCENT = "#0A5BFF";
const INK: Rgb = [11, 18, 33];
const WHITE: Rgb = [255, 255, 255];

export function parseColor(input: unknown): Rgb | null {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) return [...m[1]!].map((c) => parseInt(c + c, 16)) as Rgb;
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1]!.slice(i, i + 2), 16)) as Rgb;
  const r = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/.exec(s) ?? /^rgb\(\s*(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})\s*\)$/.exec(s);
  if (r) {
    const v = [Number(r[1]), Number(r[2]), Number(r[3])];
    return v.every((x) => x <= 255) ? (v as Rgb) : null;
  }
  return null;
}

const lum = ([r, g, b]: Rgb) => {
  const f = (c: number) => {
    const x = c / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

/** WCAG 2.x contrast ratio. */
export function contrast(a: Rgb, b: Rgb): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p) as [number, number];
  return (x + 0.05) / (y + 0.05);
}

const hex = (c: Rgb) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

/**
 * Validated accent plus its text colour. Picks white or ink text, whichever contrasts more; when neither reaches
 * 4.5:1 the accent is darkened until white text does.
 */
export function resolveAccent(input?: string | null): { accent: string; onAccent: string; soft: string; ring: string; focusDark: string; focusLight: string } {
  let rgb = parseColor(input) ?? (parseColor(DEFAULT_ACCENT) as Rgb);
  let on = contrast(rgb, WHITE) >= contrast(rgb, INK) ? WHITE : INK;
  for (let i = 0; i < 20 && contrast(rgb, on) < 4.5; i++) {
    rgb = rgb.map((v) => v * 0.9) as Rgb;
    on = WHITE;
  }
  const [r, g, b] = rgb.map(Math.round) as Rgb;
  // Focus rings must reach 3:1 against the surface in each mode; otherwise they fall back to the text colour.
  const focusDark = contrast(rgb, [12, 19, 34]) >= 3 ? hex(rgb) : "#F5F7FF";
  const focusLight = contrast(rgb, WHITE) >= 3 ? hex(rgb) : "#0B1221";
  return { accent: hex(rgb), onAccent: hex(on), soft: `rgba(${r},${g},${b},0.14)`, ring: `rgba(${r},${g},${b},0.45)`, focusDark, focusLight };
}

const PRESETS: Record<RadiusPreset, number> = { none: 0, sm: 8, md: 14, lg: 18 };

export function resolveRadius(input: unknown): number {
  if (typeof input === "number" && Number.isFinite(input)) return Math.min(24, Math.max(0, Math.round(input)));
  if (typeof input !== "string" || !input.trim()) return 14;
  const s = input.trim().toLowerCase();
  if (s in PRESETS) return PRESETS[s as RadiusPreset];
  const m = /^(\d{1,2}(?:\.\d+)?)(px)?$/.exec(s);
  return m ? Math.min(24, Math.round(Number(m[1]))) : 14;
}

/** Font-family lists only: names, quotes, commas, spaces, hyphens. Anything else falls back to the default. */
export function resolveFont(input: unknown): string | undefined {
  if (typeof input !== "string") return undefined;
  const s = input.trim();
  return s && s.length <= 200 && /^[A-Za-z0-9 ,"'_-]+$/.test(s) ? s : undefined;
}

export function resolveMode(input: unknown): ThemeMode {
  return input === "light" || input === "dark" ? input : "auto";
}

/** Reads theme values from attributes first, then from the element's computed custom properties. */
export function themeFromElement(el: Element, fallback: ThemeOptions = {}): ThemeOptions {
  let css: CSSStyleDeclaration | null = null;
  try {
    css = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
  } catch {
    css = null;
  }
  const prop = (name: string) => css?.getPropertyValue(name)?.trim() || undefined;
  return {
    mode: resolveMode(el.getAttribute("theme") ?? fallback.mode),
    accent: el.getAttribute("accent") ?? prop("--terra-accent") ?? fallback.accent ?? DEFAULT_ACCENT,
    radius: resolveRadius(el.getAttribute("radius") ?? prop("--terra-radius") ?? fallback.radius ?? 14),
    font: resolveFont(el.getAttribute("font") ?? prop("--terra-font") ?? fallback.font),
  };
}

/** Writes validated private variables onto an element inside the shadow root (CSSOM, CSP safe). */
export function applyTheme(target: HTMLElement, theme: ThemeOptions): void {
  const a = resolveAccent(theme.accent);
  target.setAttribute("data-theme", resolveMode(theme.mode));
  target.style.setProperty("--_accent", a.accent);
  target.style.setProperty("--_on-accent", a.onAccent);
  target.style.setProperty("--_accent-soft", a.soft);
  target.style.setProperty("--_ring", a.ring);
  target.style.setProperty("--_focus-dark", a.focusDark);
  target.style.setProperty("--_focus-light", a.focusLight);
  target.style.setProperty("--_radius", `${resolveRadius(theme.radius)}px`);
  const font = resolveFont(theme.font);
  if (font) target.style.setProperty("--_font", font);
  else target.style.removeProperty("--_font");
}
