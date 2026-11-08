import "server-only";
import type Stripe from "stripe";
import { config } from "./config";
import { getStripe } from "./stripe";

let cache: { at: number; byKey: Map<string, Stripe.ShippingRate> } | null = null;

// Active Stripe shipping rates by metadata.key (created by `npm run setup-stripe`).
async function ratesByKey() {
  if (cache && Date.now() - cache.at < 5 * 60_000) return cache.byKey;
  const byKey = new Map<string, Stripe.ShippingRate>();
  for await (const r of getStripe().shippingRates.list({ active: true, limit: 100 })) {
    if (r.metadata?.key && !byKey.has(r.metadata.key)) byKey.set(r.metadata.key, r);
  }
  cache = { at: Date.now(), byKey };
  return byKey;
}

// Buy-now checkout options: standard US shipping (free at/over the threshold) plus free SF pickup.
export async function shippingOptionsFor(subtotal: number): Promise<Stripe.Checkout.SessionCreateParams.ShippingOption[]> {
  const { rates, free_threshold } = config.shipping;
  const byKey = await ratesByKey();
  const ship = byKey.get(subtotal >= free_threshold ? rates.ship_free.key : rates.ship.key);
  const pickup = byKey.get(rates.pickup.key);
  if (!ship || !pickup) throw new Error("shipping rates missing in Stripe; run npm run setup-stripe");
  return [{ shipping_rate: ship.id }, { shipping_rate: pickup.id }];
}

// "ship" | "pickup" for a completed session, from the chosen rate's metadata.
export function fulfilmentOf(session: Stripe.Checkout.Session): "ship" | "pickup" | null {
  const r = session.shipping_cost?.shipping_rate;
  const f = r && typeof r === "object" ? r.metadata?.fulfilment : null;
  return f === "ship" || f === "pickup" ? f : null;
}
