"use client";

import Link from "next/link";
import { useState } from "react";
import { type CartLine, money, useCart } from "./cart";

type Props = {
  slug: string;
  name: string;
  image: string | null;
  kind: "live" | "preorder";
  launchWindow: string | null;
  variants: { priceId: string; size: string; unitAmount: number }[];
  fulfilment: string;
};

export default function ProductBuy({ slug, name, image, kind, launchWindow, variants, fulfilment }: Props) {
  const cart = useCart();
  const single = variants.length === 1;
  const [size, setSize] = useState<string | null>(single ? variants[0].size : null);
  const [qty, setQty] = useState(1);
  const [state, setState] = useState<"idle" | "added" | "mixed">("idle");
  const v = variants.find((x) => x.size === size) ?? null;
  const price = v?.unitAmount ?? variants[0]?.unitAmount ?? 0;

  function line(): Omit<CartLine, "qty"> {
    return { priceId: v!.priceId, slug, name, size: v!.size, unitAmount: v!.unitAmount, image, kind, launchWindow };
  }
  function add(replace = false) {
    if (!v) return;
    const r = cart.add(line(), qty, { replace });
    setState(r.ok ? "added" : "mixed");
  }

  return (
    <div className="buy">
      {!single && (
        <fieldset className="sizes">
          <legend>
            Size <Link href="/info#size-guide" className="size-guide-link">Size guide</Link>
          </legend>
          <div className="size-row">
            {variants.map((x) => (
              <label key={x.size} className="size">
                <input type="radio" name={`size-${slug}`} value={x.size} checked={size === x.size} onChange={() => { setSize(x.size); setState("idle"); }} />
                <span>{x.size}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {single && <p className="one-size">One size</p>}

      <div className="qty">
        <span className="qty-label" id={`qty-${slug}`}>Quantity</span>
        <div className="stepper" role="group" aria-labelledby={`qty-${slug}`}>
          <button type="button" aria-label="One fewer" disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
          <output aria-live="polite">{qty}</output>
          <button type="button" aria-label="One more" disabled={qty >= 5} onClick={() => setQty((q) => Math.min(5, q + 1))}>+</button>
        </div>
      </div>

      <button type="button" className="cta" disabled={!v} onClick={() => add()}>
        {!v ? "Pick a size" : kind === "preorder" ? `Pre-order, ${money(price * qty)}` : `Add to bag, ${money(price * qty)}`}
      </button>

      {state === "added" && (
        <p className="added" role="status">
          Added to your bag. <Link href="/cart">View bag and check out</Link>
        </p>
      )}
      {state === "mixed" && (
        <div className="mixed" role="alert">
          <p>
            {kind === "preorder"
              ? "Your bag has in-stock items. Pre-orders check out on their own, so check out your bag first, or start a new bag with this pre-order."
              : "Your bag has pre-orders. In-stock items check out on their own, so finish the pre-order first, or start a new bag with this item."}
          </p>
          <div className="mixed-actions">
            <Link href="/cart" className="btn-quiet">Go to bag</Link>
            <button type="button" className="btn-quiet" onClick={() => add(true)}>Start a new bag</button>
          </div>
        </div>
      )}

      {kind === "preorder" ? (
        <p className="buy-note">
          Pre-order: we save your card now and charge {money(price * qty)} when it launches{launchWindow ? ` (est. ${launchWindow})` : ""}. If it never
          launches, you&rsquo;re never charged. <Link href="/info#preorders">How pre-orders work</Link>
        </p>
      ) : (
        <p className="buy-note">{fulfilment}</p>
      )}
    </div>
  );
}
