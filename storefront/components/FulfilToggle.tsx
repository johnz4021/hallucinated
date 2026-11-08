"use client";

import { config } from "@/lib/config";
import type { Fulfilment } from "./checkout-client";
import { money } from "./cart";

// Compact Ship / Pick up toggle for pre-orders. Ship is the default.
export default function FulfilToggle({ value, onChange, name, subtotal }: { value: Fulfilment; onChange: (v: Fulfilment) => void; name: string; subtotal: number }) {
  const fee = config.shipping.rates.ship.amount;
  const free = subtotal >= config.shipping.free_threshold;
  return (
    <fieldset className="fulfil-toggle">
      <legend className="sr-only">Shipping or pickup</legend>
      <label className={value === "ship" ? "is-on" : ""}>
        <input type="radio" name={name} value="ship" checked={value === "ship"} onChange={() => onChange("ship")} />
        <span>Ship to me <small>{free ? "free" : `+${money(fee)}`}</small></span>
      </label>
      <label className={value === "pickup" ? "is-on" : ""}>
        <input type="radio" name={name} value="pickup" checked={value === "pickup"} onChange={() => onChange("pickup")} />
        <span>Pick up in SF <small>free</small></span>
      </label>
    </fieldset>
  );
}
