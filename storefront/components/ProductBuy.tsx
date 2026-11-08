"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { config, isDatedWindow } from "@/lib/config";
import { type CartLine, money, useCart } from "./cart";
import { type Fulfilment, startCheckout } from "./checkout-client";
import FulfilToggle from "./FulfilToggle";

type Props = {
  slug: string;
  name: string;
  image: string | null;
  kind: "live" | "preorder";
  launchWindow: string | null;
  variants: { priceId: string; size: string; unitAmount: number }[];
  fulfilment: string;
  agent?: boolean;
  shippingLine?: string;
};

// Primary action goes straight to Stripe Checkout for this item; "Add to bag" is secondary.
export default function ProductBuy({ slug, name, image, kind, launchWindow, variants, fulfilment, agent = false, shippingLine }: Props) {
  const cart = useCart();
  const single = variants.length === 1;
  const [size, setSize] = useState<string | null>(single ? variants[0].size : null);
  const [qty, setQty] = useState(1);
  const [ship, setShip] = useState<Fulfilment>("ship");
  const [state, setState] = useState<"idle" | "added" | "mixed" | "busy" | "need-size">("idle");
  const [error, setError] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);
  const sizesRef = useRef<HTMLFieldSetElement>(null);
  const v = variants.find((x) => x.size === size) ?? null;
  const price = v?.unitAmount ?? variants[0]?.unitAmount ?? 0;
  const total = price * qty;
  const pre = kind === "preorder";
  const shipFee = pre && ship === "ship" && total < config.shipping.free_threshold ? config.shipping.rates.ship.amount : 0;

  // Hide the sticky bar while the on-screen keyboard is up (any text field focused).
  useEffect(() => {
    const on = (e: FocusEvent) => setInputFocused(e.target instanceof HTMLInputElement && !["radio", "checkbox", "button"].includes(e.target.type));
    const off = () => setInputFocused(false);
    window.addEventListener("focusin", on);
    window.addEventListener("focusout", off);
    return () => { window.removeEventListener("focusin", on); window.removeEventListener("focusout", off); };
  }, []);

  function needSize() {
    setState("need-size");
    sizesRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function line(): Omit<CartLine, "qty"> {
    return { priceId: v!.priceId, slug, name, size: v!.size, unitAmount: v!.unitAmount, image, kind, launchWindow };
  }
  function add(replace = false) {
    if (!v) return needSize();
    const r = cart.add(line(), qty, { replace });
    setState(r.ok ? "added" : "mixed");
  }
  async function buyNow() {
    if (!v) return needSize();
    setState("busy");
    setError(null);
    try {
      await startCheckout([{ price_id: v.priceId, quantity: qty }], pre ? ship : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Checkout didn't open. Try again.");
      setState("idle");
    }
  }
  const primaryLabel = state === "busy" ? "Opening checkout…" : pre ? `Pre-order now, ${money(total)}` : `Buy now, ${money(total)}`;

  return (
    <div className="buy">
      {!single && (
        <fieldset className={`sizes${state === "need-size" ? " need" : ""}`} ref={sizesRef}>
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
          {state === "need-size" && <p className="need-size" role="alert">Pick a size first.</p>}
        </fieldset>
      )}

      <div className="buy-row">
        {single && <span className="one-size">One size</span>}
        <div className="stepper" role="group" aria-label="Quantity">
          <button type="button" aria-label="One fewer" disabled={qty <= 1} onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
          <output aria-live="polite">{qty}</output>
          <button type="button" aria-label="One more" disabled={qty >= 5} onClick={() => setQty((q) => Math.min(5, q + 1))}>+</button>
        </div>
      </div>

      {pre && <FulfilToggle value={ship} onChange={setShip} name={`fulfil-${slug}`} subtotal={total} />}

      <button type="button" className="cta" onClick={buyNow} disabled={state === "busy"}>{primaryLabel}</button>
      <button type="button" className="btn-secondary" onClick={() => add()}>Add to bag</button>
      {error && <p className="error" role="alert">{error}</p>}

      {state === "added" && (
        <p className="added" role="status">
          Added to your bag. <Link href="/cart">View bag</Link>
        </p>
      )}
      {state === "mixed" && (
        <div className="mixed" role="alert">
          <p>Your bag has {pre ? "in-stock items" : "pre-orders"}, which check out separately. Use {pre ? "Pre-order now" : "Buy now"} above for this one, or start a new bag.</p>
          <div className="mixed-actions">
            <Link href="/cart" className="btn-quiet">Go to bag</Link>
            <button type="button" className="btn-quiet" onClick={() => add(true)}>Start a new bag</button>
          </div>
        </div>
      )}

      {pre ? (
        <p className="buy-note">
          {agent ? "Designed by the agents. " : ""}Pre-order: nothing is charged today. You&rsquo;re charged {money(total)}
          {shipFee ? ` + ${money(shipFee)} shipping` : ""} only if it launches{isDatedWindow(launchWindow) ? ` (est. ${launchWindow})` : ""}.
          Never launches, never charged. <Link href="/info#preorders">How pre-orders work</Link>
        </p>
      ) : (
        <p className="buy-note ship-line">{shippingLine ?? fulfilment}</p>
      )}

      {/* Mobile: price, size state and the primary action stay on screen. */}
      <div className={`sticky-buy${inputFocused ? " is-hidden" : ""}`} aria-hidden={inputFocused}>
        <div className="sticky-info">
          <strong>{money(total)}{shipFee ? ` + ${money(shipFee)}` : ""}</strong>
          <span>{single ? "One size" : size ? `Size ${size}` : "Pick a size"}{pre ? `, ${ship === "ship" ? "ship" : "SF pickup"}` : ""}</span>
        </div>
        <button type="button" className="cta" onClick={buyNow} disabled={state === "busy"}>
          {state === "busy" ? "Opening…" : pre ? "Pre-order now" : "Buy now"}
        </button>
      </div>
    </div>
  );
}
