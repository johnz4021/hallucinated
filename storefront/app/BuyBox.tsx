"use client";

import { useState } from "react";

type Props = { sizes: readonly string[]; unitAmount: number; maxQuantity: number; fulfilment: string };

export default function BuyBox({ sizes, unitAmount, maxQuantity, fulfilment }: Props) {
  const [size, setSize] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0 }).format((unitAmount * qty) / 100);

  async function buy() {
    if (!size) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ size, quantity: qty }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || "Checkout didn't open. Try again.");
      window.location.assign(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout didn't open. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="buy">
      <fieldset className="sizes">
        <legend>Size</legend>
        <div className="size-row">
          {sizes.map((s) => (
            <label key={s} className="size">
              <input type="radio" name="size" value={s} checked={size === s} onChange={() => setSize(s)} />
              <span>{s}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="qty">
        <span className="qty-label" id="qty-label">How many</span>
        <div className="stepper" role="group" aria-labelledby="qty-label">
          <button type="button" aria-label="One fewer" disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
          <output aria-live="polite">{qty}</output>
          <button type="button" aria-label="One more" disabled={qty >= maxQuantity} onClick={() => setQty((q) => Math.min(maxQuantity, q + 1))}>+</button>
        </div>
      </div>

      <button type="button" className="cta" disabled={!size || busy} onClick={buy}>
        {busy ? "Opening checkout…" : !size ? "Pick a size" : `Buy ${qty > 1 ? `${qty} ` : ""}for ${total}`}
      </button>
      {error && <p className="error" role="alert">{error}</p>}
      <p className="fulfilment">{fulfilment}</p>
    </div>
  );
}
