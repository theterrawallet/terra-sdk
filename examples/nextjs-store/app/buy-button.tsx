"use client";

import { useState } from "react";
import { TerraPay } from "@terrawallet/pay-js";

type Phase = "idle" | "creating" | "open" | "confirming" | "paid" | "cancelled" | "expired" | "error";

const LABEL: Record<Phase, string> = {
  idle: "",
  creating: "Preparing checkout",
  open: "Checkout open",
  confirming: "Payment sent. Waiting for on-chain confirmation.",
  paid: "Paid. Thank you!",
  cancelled: "Checkout closed.",
  expired: "The quote expired. Try again for a fresh price.",
  error: "",
};

export function BuyButton({ productId }: { productId: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState("");

  async function waitForWebhook(orderId: string) {
    // The browser callback is only a hint: the order is paid when the verified webhook says so.
    for (let i = 0; i < 60; i++) {
      const r = await fetch(`/api/orders?id=${encodeURIComponent(orderId)}`);
      const o = (await r.json()) as { status?: string };
      if (o.status === "paid") return setPhase("paid");
      if (o.status === "expired") return setPhase("expired");
      await new Promise((res) => setTimeout(res, 3000));
    }
  }

  async function buy() {
    setPhase("creating");
    setMessage("");
    const res = await fetch("/api/checkout", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ productId }) });
    const body = (await res.json()) as { checkoutUrl?: string; orderId?: string; error?: { message?: string } };
    if (!res.ok || !body.checkoutUrl || !body.orderId) {
      setPhase("error");
      setMessage(body.error?.message ?? "Checkout is unavailable.");
      return;
    }
    const orderId = body.orderId;
    setPhase("open");
    TerraPay.open({
      checkoutUrl: body.checkoutUrl,
      publishableKey: process.env.NEXT_PUBLIC_TERRA_PUBLISHABLE_KEY ?? "",
      onSuccess: () => {
        setPhase("confirming");
        void waitForWebhook(orderId);
      },
      onCancel: () => setPhase("cancelled"),
      onExpire: () => setPhase("expired"),
      onError: (e) => {
        setPhase("error");
        setMessage(e.message);
      },
    });
  }

  const busy = phase === "creating" || phase === "open";
  return (
    <div className="buy">
      <button className="buy-btn" onClick={buy} disabled={busy || phase === "paid"}>
        {busy ? LABEL[phase] : phase === "paid" ? "Paid" : "Pay with crypto"}
      </button>
      <p className="muted small" role="status">
        {phase === "error" ? message : busy ? "" : LABEL[phase]}
      </p>
    </div>
  );
}
