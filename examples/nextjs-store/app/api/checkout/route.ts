/**
 * POST /api/checkout { productId } -> { checkoutUrl, orderId }
 * Creates a Terra Pay payment intent on the server with the SECRET key. The price comes from the server catalogue.
 */
import { randomUUID } from "node:crypto";
import { Terra, TerraApiError } from "@terrawallet/server";
import { orders } from "../../../lib/orders";
import { findProduct } from "../../../lib/products";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { productId?: unknown } | null;
  const product = findProduct(body?.productId);
  if (!product) return Response.json({ error: { code: "UNKNOWN_PRODUCT", message: "Unknown product." } }, { status: 404 });

  const secretKey = process.env.TERRA_SECRET_KEY;
  if (!secretKey || secretKey.includes("replace_me")) {
    return Response.json({ error: { code: "NOT_CONFIGURED", message: "Set TERRA_SECRET_KEY in .env.local (see .env.example)." } }, { status: 501 });
  }

  const terra = new Terra(secretKey);
  const orderId = randomUUID();
  try {
    const pi = await terra.paymentIntents.create(
      {
        amount: product.price,
        currency: "USD",
        accepted_assets: [
          { chain: "base", symbol: "USDC" },
          { chain: "polygon", symbol: "USDC" },
          { chain: "tron", symbol: "USDT" },
        ],
        description: product.name,
        metadata: { order_id: orderId, product_id: product.id },
        expires_in_s: 900,
      },
      // One key per order: a retried request can never create a second payment intent.
      { idempotencyKey: `order-${orderId}` },
    );
    orders.set(orderId, { id: orderId, productId: product.id, amount: product.price, paymentIntentId: pi.id, status: "awaiting_payment" });
    return Response.json({ orderId, checkoutUrl: pi.checkout_url });
  } catch (e) {
    if (e instanceof TerraApiError) {
      console.error(`Terra API error ${e.code} (request ${e.requestId}): ${e.message} See ${e.doc_url}`);
      return Response.json({ error: { code: e.code, message: "Checkout is unavailable right now.", requestId: e.requestId } }, { status: 502 });
    }
    throw e;
  }
}
