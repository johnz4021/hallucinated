"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { config, datedWindows, localImage } from "@/lib/config";
import { money, useCart } from "./cart";

export default function CartView({ fulfilment: fulfilmentNote, contact }: { fulfilment: string; contact: string }) {
  const cart = useCart();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fulfilment, setFulfilment] = useState<"ship" | "pickup" | null>(null);

  async function checkout() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: cart.lines.map((l) => ({ price_id: l.priceId, quantity: l.qty })),
          ...(cart.kind === "preorder" ? { fulfilment } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || "Checkout didn't open. Try again.");
      window.location.assign(data.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout didn't open. Try again.");
      setBusy(false);
    }
  }

  if (!cart.ready) return <div className="cart-empty" aria-busy="true" />;
  if (!cart.lines.length)
    return (
      <div className="cart-empty">
        <p>Your bag is empty.</p>
        <Link href="/shop" className="btn">Shop everything</Link>
      </div>
    );

  const pre = cart.kind === "preorder";
  const shipFee = config.shipping.rates.ship.amount;
  const freeOver = config.shipping.free_threshold;
  const windows = datedWindows(cart.lines.map((l) => l.launchWindow));
  return (
    <div className="cart">
      <ul className="cart-lines">
        {cart.lines.map((l) => (
          <li key={l.priceId} className="cart-line">
            <Link href={`/p/${l.slug}`} className="cart-thumb">
              {l.image && <Image {...localImage(l.image)} alt="" fill sizes="96px" />}
            </Link>
            <div className="cart-info">
              <Link href={`/p/${l.slug}`} className="cart-name">{l.name}</Link>
              <span className="cart-meta">
                {l.size === "OS" ? "One size" : `Size ${l.size}`}
                {l.kind === "preorder" ? `. Pre-order${datedWindows([l.launchWindow]) ? `, est. ${l.launchWindow}` : ""}` : ""}
              </span>
              <div className="cart-controls">
                <div className="stepper small" role="group" aria-label={`Quantity of ${l.name}`}>
                  <button type="button" aria-label="One fewer" disabled={l.qty <= 1} onClick={() => cart.setQty(l.priceId, l.qty - 1)}>−</button>
                  <output>{l.qty}</output>
                  <button type="button" aria-label="One more" disabled={l.qty >= 5} onClick={() => cart.setQty(l.priceId, l.qty + 1)}>+</button>
                </div>
                <button type="button" className="link-btn" onClick={() => cart.remove(l.priceId)}>Remove</button>
              </div>
            </div>
            <span className="cart-total">{money(l.unitAmount * l.qty)}</span>
          </li>
        ))}
      </ul>
      <aside className="cart-summary" aria-label="Summary">
        <div className="sum-row">
          <span>{pre ? "Charged at launch" : "Subtotal"}</span>
          <span>{money(cart.subtotal)}</span>
        </div>
        {pre && (
          <fieldset className="fulfil-choice">
            <legend>How do you want it?</legend>
            <label className={fulfilment === "ship" ? "is-on" : ""}>
              <input type="radio" name="fulfilment" value="ship" checked={fulfilment === "ship"} onChange={() => setFulfilment("ship")} />
              <span>
                <strong>Ship to me</strong>
                <small>{money(shipFee)}, free over {money(freeOver)}. US only.</small>
              </span>
            </label>
            <label className={fulfilment === "pickup" ? "is-on" : ""}>
              <input type="radio" name="fulfilment" value="pickup" checked={fulfilment === "pickup"} onChange={() => setFulfilment("pickup")} />
              <span>
                <strong>Pick up in SF</strong>
                <small>Free. We email the address and a pickup window.</small>
              </span>
            </label>
          </fieldset>
        )}
        <p className="sum-note">
          {pre
            ? `We save your card now and charge ${money(cart.subtotal)}${
                fulfilment === "ship" && cart.subtotal < freeOver ? ` + ${money(shipFee)} shipping` : ""
              } only if it launches${windows ? ` (est. ${windows})` : ""}. Never launches, never charged. Checkout asks for your address either way; we only use it if we ship. Cancel before launch: ${contact}.`
            : fulfilmentNote}
        </p>
        <button type="button" className="cta" onClick={checkout} disabled={busy || (pre && !fulfilment)}>
          {busy ? "Opening checkout…" : pre ? (fulfilment ? "Save card and pre-order" : "Choose shipping or pickup") : "Check out"}
        </button>
        {error && <p className="error" role="alert">{error}</p>}
      </aside>
    </div>
  );
}
