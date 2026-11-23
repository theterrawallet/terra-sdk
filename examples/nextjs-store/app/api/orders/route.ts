/** GET /api/orders?id=<orderId> -> the order status the webhook has recorded. */
import { orders } from "../../../lib/orders";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  const order = orders.get(id);
  if (!order) return Response.json({ error: { code: "NOT_FOUND", message: "No such order." } }, { status: 404 });
  return Response.json({ id: order.id, status: order.status });
}
