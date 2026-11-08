"use client";

export type Fulfilment = "ship" | "pickup";

// Opens Stripe Checkout for exactly these items. Throws with the server's message on failure.
export async function startCheckout(items: { price_id: string; quantity: number }[], fulfilment?: Fulfilment | null) {
  const res = await fetch("/api/checkout", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ items, ...(fulfilment ? { fulfilment } : {}), client: 2 }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) throw new Error(data.error || "Checkout didn't open. Try again.");
  window.location.assign(data.url);
}
