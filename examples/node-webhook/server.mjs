#!/usr/bin/env node
/**
 * Minimal Terra Pay webhook receiver: Node's http module plus @terrawallet/server, nothing else.
 *
 *   TERRA_WEBHOOK_SECRET=whsec_... node server.mjs          (listens on http://localhost:4242/webhooks/terra)
 *
 * The rules that matter:
 *   1. Verify the signature over the RAW body bytes, before parsing (constant-time compare, 5 minute window).
 *   2. Answer 2xx quickly, then do the work: Terra retries failed deliveries with backoff for 3 days.
 *   3. Process each event id once: deliveries can repeat and arrive out of order.
 *   4. Treat every string in the payload as untrusted data. For money decisions, re-fetch the payment intent
 *      from the API with your secret key.
 */
import { createServer } from "node:http";
import { TerraWebhookSignatureError, verifyWebhook } from "@terrawallet/server";

const SECRETS = (process.env.TERRA_WEBHOOK_SECRET ?? "").split(",").map((s) => s.trim()).filter(Boolean); // comma separated during a rotation
const PORT = Number(process.env.PORT ?? 4242);
const MAX_BODY = 256 * 1024;
if (!SECRETS.length) {
  console.error("Set TERRA_WEBHOOK_SECRET (the whsec_... secret shown when you created the endpoint).");
  process.exit(1);
}

/** Replace with your database (a unique index on event id). */
const processed = new Set();

async function handle(event) {
  switch (event.type) {
    case "payment_intent.succeeded":
      // Fulfil the order whose metadata.order_id matches, after re-fetching the intent if you need certainty.
      console.log(`paid: ${event.data?.object?.id}`);
      break;
    case "payment_intent.expired":
    case "payment_intent.underpaid":
    case "invoice.paid":
    case "invoice.overdue":
    case "subscription.created":
    case "subscription.renewed":
    case "subscription.payment_failed":
    case "subscription.past_due":
    case "subscription.canceled":
      console.log(`${event.type}: ${event.data?.object?.id}`);
      break;
    default:
      console.log(`ignored event type ${String(event.type).slice(0, 64)}`);
  }
}

const json = (res, status, body) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/webhooks/terra") return json(res, 404, { error: "not_found" });
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) return json(res, 413, { error: "too_large" });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks);
  let event;
  try {
    event = verifyWebhook(raw, req.headers["terra-signature"], SECRETS);
  } catch (e) {
    return json(res, 400, { error: e instanceof TerraWebhookSignatureError ? e.code : "invalid" });
  }
  if (processed.has(event.id)) return json(res, 200, { received: true, duplicate: true });
  processed.add(event.id);
  json(res, 200, { received: true });
  setImmediate(() => handle(event).catch((err) => console.error("handler failed", err)));
}).listen(PORT, () => console.log(`Terra webhook receiver on http://localhost:${PORT}/webhooks/terra`));
