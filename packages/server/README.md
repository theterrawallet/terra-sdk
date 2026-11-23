# @terrawallet/server

The Terra Pay `/v1` API for Node.js 18+ (ESM and CommonJS), plus webhook verification. No dependencies.

```ts
import { Terra, verifyWebhook } from "@terrawallet/server";

const terra = new Terra(process.env.TERRA_SECRET_KEY); // tw_test_sk_... / tw_live_sk_...

const pi = await terra.paymentIntents.create(
  { amount: "120.00", currency: "USD", accepted_assets: [{ chain: "base", symbol: "USDC" }], metadata: { order_id: "1042" } },
  { idempotencyKey: "order-1042" },
);
// send the shopper to pi.checkout_url, or open it with TerraPay.open({ checkoutUrl: pi.checkout_url, ... })
```

Resources: `paymentIntents`, `paymentLinks`, `invoices` (`send`), `plans`, `subscriptions` (`cancel`),
`webhookEndpoints` (`del`), each with `create`, `retrieve`, `list` (cursor page) and `listAll` (async iterator).
Field names match the API (snake_case); money is a decimal string.

## Reliability

- **Idempotency:** every create sends an `Idempotency-Key` (yours, or `idempotencyKey()` generated) and reuses the
  same key on every retry. A reused key with a different body fails with `IDEMPOTENCY_KEY_REUSED` (409).
- **Retries:** 408, 425, 429 and 5xx, `409 IDEMPOTENCY_IN_PROGRESS` (the first attempt is still running on the
  server), network errors and timeouts, with exponential backoff and jitter (`maxRetries`, default 2), honouring
  `Retry-After` (capped at 20 s). A POST without a key is never retried.
- **No double creates:** when a create still fails with `TIMEOUT`, `CONNECTION_ERROR`, a 5xx or
  `IDEMPOTENCY_IN_PROGRESS`, it may have happened on the server. Retry with the SAME key, never a new one:
  `create(params, { idempotencyKey: error.idempotencyKey })` (every error carries the key its request used). Best:
  derive the key from your order id.
- **Timeouts:** `timeoutMs` per attempt (default 30 s).
- **Errors:** `TerraApiError` subclasses (`TerraInvalidRequestError`, `TerraAuthenticationError`,
  `TerraPermissionError`, `TerraNotFoundError`, `TerraConflictError`, `TerraRateLimitError`, `TerraServerError`,
  `TerraConnectionError`) with `code`, `status`, `requestId` and `doc_url`.
- Refuses publishable keys, malformed keys, running in a browser, and base URLs that are not https (plain http only
  for `localhost`, `127.0.0.1` or `[::1]`, for local tests) or that carry credentials, a query or a fragment. A
  request path can never move the key to another host or outside the base path.
- Never logs. Error messages, causes and stacks have keys, webhook secrets and bearer credentials redacted, even when
  a custom `fetch` quotes the request in its own error.

## Webhooks

```ts
// Next.js route handler (Node runtime). Use the RAW body.
export async function POST(req: Request) {
  const raw = await req.text();
  const event = verifyWebhook(raw, req.headers.get("terra-signature"), process.env.TERRA_WEBHOOK_SECRET!);
  // process event.id once; answer 2xx fast
  return Response.json({ received: true });
}
```

`verifyWebhook(rawBody, header, secret, toleranceSec = 300)` checks `Terra-Signature: t=<unix>,v1=<hex>`
(HMAC-SHA256 of `${t}.${rawBody}`) in constant time, accepts several `v1` values or an array of secrets during a
rotation, rejects timestamps outside the window, and returns the parsed event. Failures throw
`TerraWebhookSignatureError` (`NO_SIGNATURE_HEADER`, `MALFORMED_SIGNATURE_HEADER`, `SIGNATURE_MISMATCH`,
`TIMESTAMP_OUT_OF_TOLERANCE`, `INVALID_PAYLOAD`); a header with two different `t` values is malformed.
`safeVerifyWebhook()` takes the same arguments and never throws for anything the sender controls: it returns
`{ ok: true, event }` or `{ ok: false, code, message }` (setup mistakes such as a missing secret still throw).
`generateTestHeader()` signs payloads for local tests.

Routes other than the creates listed in the contract (retrieve, list, cancel, delete, send) follow the contract's
REST conventions and should be confirmed against the Terra Pay API as it lands.
