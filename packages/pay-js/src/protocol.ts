/**
 * The checkout URL and the postMessage protocol between a merchant page and pay.terrawallet.us.
 *
 * Checkout to merchant (posted by the checkout page to the opener or parent window):
 *   { terraPay: 1, sid, type: "ready" | "resize" | "success" | "cancel" | "expire" | "error" | "close", ...fields }
 *
 * A message is accepted ONLY when all of these hold:
 *   1. event.origin is exactly https://pay.terrawallet.us,
 *   2. event.source is the very window or iframe this call opened,
 *   3. data.sid equals the random session id this call generated,
 *   4. every field passes a strict type and format check (unknown fields are dropped).
 */
import { TerraPayError } from "./errors.js";

export const CHECKOUT_ORIGIN = "https://pay.terrawallet.us";

const ID = {
  pi: /^pi_[A-Za-z0-9]{6,64}$/,
  plink: /^plink_[A-Za-z0-9]{6,64}$/,
  inv: /^inv_[A-Za-z0-9]{6,64}$/,
  plan: /^plan_[A-Za-z0-9]{6,64}$/,
  sub: /^sub_[A-Za-z0-9]{6,64}$/,
};
const PATH_KIND: Record<string, keyof typeof ID> = { c: "pi", l: "plink", i: "inv", s: "plan" };

export type CheckoutMode = "modal" | "popup";

export interface CheckoutTarget {
  checkoutUrl?: string;
  paymentIntentId?: string;
  planId?: string;
}

/** A random 128-bit session id that ties every message to one open() call. */
export function newSessionId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Resolves the checkout path (/c/pi_..., /l/plink_..., /i/inv_..., /s/plan_...) from the caller's input. */
export function checkoutPath(target: CheckoutTarget): string {
  const given = [target.checkoutUrl, target.paymentIntentId, target.planId].filter((x) => x !== undefined);
  if (given.length !== 1) throw new TerraPayError("INVALID_CHECKOUT");
  if (target.paymentIntentId !== undefined) {
    if (!ID.pi.test(target.paymentIntentId)) throw new TerraPayError("INVALID_CHECKOUT", "paymentIntentId must look like pi_...");
    return `/c/${target.paymentIntentId}`;
  }
  if (target.planId !== undefined) {
    if (!ID.plan.test(target.planId)) throw new TerraPayError("INVALID_CHECKOUT", "planId must look like plan_...");
    return `/s/${target.planId}`;
  }
  let url: URL;
  try {
    url = new URL(String(target.checkoutUrl));
  } catch {
    throw new TerraPayError("INVALID_CHECKOUT");
  }
  if (url.origin !== CHECKOUT_ORIGIN || url.username || url.password) {
    throw new TerraPayError("INVALID_CHECKOUT", "checkoutUrl must be on https://pay.terrawallet.us.");
  }
  const m = /^\/([clis])\/([A-Za-z0-9_]+)\/?$/.exec(url.pathname);
  const kind = m ? PATH_KIND[m[1]!] : undefined;
  if (!m || !kind || !ID[kind].test(m[2]!)) throw new TerraPayError("INVALID_CHECKOUT", "Unrecognised checkout URL path.");
  return `/${m[1]}/${m[2]}`;
}

export function buildCheckoutUrl(target: CheckoutTarget, p: { publishableKey: string; mode: CheckoutMode; sid: string; parentOrigin: string; theme?: string }): string {
  const url = new URL(checkoutPath(target), CHECKOUT_ORIGIN);
  url.searchParams.set("embed", p.mode);
  url.searchParams.set("pk", p.publishableKey);
  url.searchParams.set("sid", p.sid);
  url.searchParams.set("origin", p.parentOrigin);
  if (p.theme === "light" || p.theme === "dark") url.searchParams.set("theme", p.theme);
  return url.toString();
}

export type CheckoutMessageType = "ready" | "resize" | "success" | "cancel" | "expire" | "error" | "close";

export interface CheckoutMessage {
  type: CheckoutMessageType;
  status?: "succeeded" | "processing";
  paymentIntentId?: string;
  subscriptionId?: string;
  invoiceId?: string;
  txHash?: string;
  chain?: string;
  height?: number;
  errorCode?: string;
  errorMessage?: string;
}

const TYPES = new Set<CheckoutMessageType>(["ready", "resize", "success", "cancel", "expire", "error", "close"]);

const pick = (v: unknown, re: RegExp): string | undefined => (typeof v === "string" && re.test(v) ? v : undefined);

/**
 * Validates a MessageEvent against the exact checkout origin, the expected source window and the session id.
 * Returns a sanitised copy, or null when the message must be ignored.
 */
export function parseCheckoutMessage(ev: { origin: string; source: unknown; data: unknown }, expected: { source: unknown; sid: string }): CheckoutMessage | null {
  if (ev.origin !== CHECKOUT_ORIGIN) return null;
  if (!expected.source || ev.source !== expected.source) return null;
  const d = ev.data as Record<string, unknown> | null;
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  if (d.terraPay !== 1 || d.sid !== expected.sid || typeof d.type !== "string" || !TYPES.has(d.type as CheckoutMessageType)) return null;
  const out: CheckoutMessage = { type: d.type as CheckoutMessageType };
  if (d.status === "succeeded" || d.status === "processing") out.status = d.status;
  const pi = pick(d.paymentIntentId, ID.pi);
  if (pi) out.paymentIntentId = pi;
  const sub = pick(d.subscriptionId, ID.sub);
  if (sub) out.subscriptionId = sub;
  const inv = pick(d.invoiceId, ID.inv);
  if (inv) out.invoiceId = inv;
  const tx = pick(d.txHash, /^(0x)?[A-Za-z0-9]{16,128}$/);
  if (tx) out.txHash = tx;
  const chain = pick(d.chain, /^[a-z0-9-]{2,32}$/);
  if (chain) out.chain = chain;
  if (typeof d.height === "number" && Number.isFinite(d.height)) out.height = Math.min(4000, Math.max(120, Math.round(d.height)));
  const code = pick(d.errorCode, /^[A-Z][A-Z0-9_]{1,63}$/);
  if (code) out.errorCode = code;
  if (typeof d.errorMessage === "string") out.errorMessage = d.errorMessage.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 300);
  if (out.type === "success" && !out.status) out.status = "succeeded";
  return out;
}
