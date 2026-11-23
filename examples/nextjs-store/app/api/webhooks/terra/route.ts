/**
 * POST /api/webhooks/terra: Terra Pay webhook receiver.
 * 1. Verify the signature over the RAW body (constant-time, 5 minute replay window).
 * 2. Process each event id once (deliveries can repeat or arrive out of order).
 * 3. Treat every string in the payload as untrusted data.
 */
import { TerraWebhookSignatureError, verifyWebhook, type TerraEvent } from "@terrawallet/server";
import { orderByPaymentIntent, processedEvents } from "../../../../lib/orders";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const secret = process.env.TERRA_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook secret not configured", { status: 500 });
  const raw = await req.text();
  let event: TerraEvent<{ id?: string; status?: string }>;
  try {
    event = verifyWebhook(raw, req.headers.get("terra-signature"), secret);
  } catch (e) {
    const code = e instanceof TerraWebhookSignatureError ? e.code : "INVALID";
    return Response.json({ error: code }, { status: 400 });
  }
  if (processedEvents.has(event.id)) return Response.json({ received: true, duplicate: true });
  processedEvents.add(event.id);

  const pi = event.data?.object?.id;
  const order = typeof pi === "string" ? orderByPaymentIntent(pi) : undefined;
  if (order) {
    if (event.type === "payment_intent.succeeded") order.status = "paid";
    else if (event.type === "payment_intent.expired") order.status = "expired";
    else if (event.type === "payment_intent.underpaid") order.status = "underpaid";
  }
  return Response.json({ received: true });
}
