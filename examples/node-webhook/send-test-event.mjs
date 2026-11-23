#!/usr/bin/env node
/**
 * Sends a signed test event to the local receiver, plus a tampered copy that must be refused.
 *   TERRA_WEBHOOK_SECRET=whsec_... node send-test-event.mjs
 */
import { generateTestHeader } from "@terrawallet/server";

const secret = process.env.TERRA_WEBHOOK_SECRET?.split(",")[0];
const url = process.env.WEBHOOK_URL ?? "http://localhost:4242/webhooks/terra";
if (!secret) {
  console.error("Set TERRA_WEBHOOK_SECRET to the same value the server uses.");
  process.exit(1);
}
const payload = JSON.stringify({
  id: `evt_test${Date.now()}`,
  type: "payment_intent.succeeded",
  created: Math.floor(Date.now() / 1000),
  data: { object: { id: "pi_TEST1234567890ABCDEFGH", status: "succeeded", amount: "32.00", currency: "USD", metadata: { order_id: "1042" } } },
});
const header = generateTestHeader({ payload, secret });
const post = (body) => fetch(url, { method: "POST", headers: { "content-type": "application/json", "terra-signature": header }, body });

const ok = await post(payload);
console.log("signed event:", ok.status, await ok.text());
const again = await post(payload);
console.log("same event again (deduplicated):", again.status, await again.text());
const bad = await post(payload.replace('"32.00"', '"0.01"'));
console.log("tampered event:", bad.status, await bad.text());
