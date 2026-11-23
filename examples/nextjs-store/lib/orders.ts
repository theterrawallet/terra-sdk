/**
 * Demo order store (in memory, survives dev hot reloads). Use your database in production. Orders become "paid"
 * ONLY from a verified webhook, never from the browser.
 */
export type OrderStatus = "awaiting_payment" | "paid" | "expired" | "underpaid";

export interface Order {
  id: string;
  productId: string;
  amount: string;
  paymentIntentId?: string;
  status: OrderStatus;
}

const g = globalThis as { __terraDemo?: { orders: Map<string, Order>; events: Set<string> } };
const store = (g.__terraDemo ??= { orders: new Map(), events: new Set() });

export const orders = store.orders;
/** Webhook event ids already processed (deliveries can repeat). */
export const processedEvents = store.events;

export function orderByPaymentIntent(pi: string): Order | undefined {
  for (const o of orders.values()) if (o.paymentIntentId === pi) return o;
  return undefined;
}
