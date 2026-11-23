/**
 * Types for the Terra `/v1` API. Field names match the wire format (snake_case).
 * Money is always a decimal STRING ("10.50"); on-chain amounts are integer base units as strings.
 */

export type Chain = "tron" | "bsc" | "ethereum" | "polygon" | "base" | "arbitrum" | "optimism" | "avalanche" | "solana" | "bitcoin" | (string & {});

/** Fiat ISO code for prices ("USD", "EUR", "INR"). */
export type Currency = string;
/** Decimal string, never a float: "10.50". */
export type Amount = string;
export type Metadata = Record<string, string>;

export interface Asset {
  chain: Chain;
  symbol: string;
  contract: string | null;
  decimals: number;
}

export interface AcceptedAsset {
  chain: Chain;
  symbol: string;
  contract?: string | null;
}

export interface ListParams {
  /** 1..100 */
  limit?: number;
  starting_after?: string;
}

export interface ListPage<T> {
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
}

// ---------------------------------------------------------------- payment intents
export type PaymentIntentStatus = "requires_payment" | "processing" | "succeeded" | "expired" | "canceled" | "underpaid" | "overpaid";

export interface PaymentIntentCreateParams {
  amount: Amount;
  currency: Currency;
  accepted_assets: AcceptedAsset[];
  description?: string;
  /** Up to 20 keys, string values up to 500 characters. */
  metadata?: Metadata;
  /** 300..86400 seconds, default 900. */
  expires_in_s?: number;
  success_url?: string;
  cancel_url?: string;
  customer_email?: string;
}

export interface Quote {
  asset: Asset;
  amount_base_units: string;
  pay_address: string;
  expires_at: string;
}

export interface PaymentIntent {
  id: string;
  status: PaymentIntentStatus;
  /** https://pay.terrawallet.us/c/pi_... */
  checkout_url: string;
  amount: Amount;
  currency: Currency;
  quotes: Quote[];
  description?: string | null;
  metadata?: Metadata;
  [key: string]: unknown;
}

// ---------------------------------------------------------------- payment links
export interface PaymentLinkCreateParams {
  name: string;
  amount?: Amount;
  customer_chooses?: boolean;
  currency: Currency;
  accepted_assets: AcceptedAsset[];
  max_uses?: number;
  expires_at?: string;
}

export interface PaymentLink {
  id: string;
  /** https://pay.terrawallet.us/l/plink_... */
  url: string;
  name: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------- invoices
export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unit_amount: Amount;
}

export interface InvoiceCreateParams {
  customer_email: string;
  line_items: InvoiceLineItem[];
  currency: Currency;
  due_date: string;
  accepted_assets: AcceptedAsset[];
}

export interface Invoice {
  id: string;
  /** https://pay.terrawallet.us/i/inv_... */
  url?: string;
  status?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------- plans and subscriptions
export interface PlanCreateParams {
  name: string;
  amount: Amount;
  currency: Currency;
  interval: "week" | "month" | "year";
  interval_count: number;
  trial_days?: number;
}

export interface Plan {
  id: string;
  name: string;
  amount: Amount;
  currency: Currency;
  interval: "week" | "month" | "year";
  interval_count: number;
  trial_days?: number | null;
  [key: string]: unknown;
}

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "paused" | "canceled";

export interface SubscriptionCreateParams {
  plan: string;
  customer_email: string;
}

export interface Subscription {
  id: string;
  status: SubscriptionStatus;
  plan: string | Plan;
  [key: string]: unknown;
}

// ---------------------------------------------------------------- webhooks
export type TerraEventType =
  | "payment_intent.succeeded"
  | "payment_intent.expired"
  | "payment_intent.underpaid"
  | "invoice.paid"
  | "invoice.overdue"
  | "subscription.created"
  | "subscription.renewed"
  | "subscription.payment_failed"
  | "subscription.past_due"
  | "subscription.canceled"
  | "payout_wallet.activated";

export interface WebhookEndpointCreateParams {
  /** https only. */
  url: string;
  events: TerraEventType[];
}

export interface WebhookEndpoint {
  id: string;
  url: string;
  events: TerraEventType[];
  /** whsec_...: returned ONCE, on creation. Store it in your secret manager. */
  secret?: string;
  [key: string]: unknown;
}

/** A delivered webhook event. Treat every string inside as untrusted data. */
export interface TerraEvent<T = Record<string, unknown>> {
  id: string;
  type: TerraEventType | (string & {});
  created?: number;
  data?: { object?: T };
  [key: string]: unknown;
}

export interface RequestOptions {
  /** 8..128 characters. Auto-generated for creates when omitted, and reused across retries. */
  idempotencyKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
  signal?: AbortSignal;
}
