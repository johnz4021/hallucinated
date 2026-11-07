import "server-only";
import Stripe from "stripe";
import { config } from "./config";

let client: Stripe | null = null;

// Test keys only, unless ALLOW_LIVE_STRIPE=1 is set on purpose (John's call, not ours).
export function getStripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  const isTest = key.startsWith("sk_test_") || key.startsWith("rk_test_");
  if (!isTest && process.env.ALLOW_LIVE_STRIPE !== "1") {
    throw new Error("Refusing a non-test Stripe key (set ALLOW_LIVE_STRIPE=1 only when going live)");
  }
  client = new Stripe(key, { appInfo: { name: "hallucinated-store" } });
  return client;
}

let cachedPrice: { id: string; at: number } | null = null;

// The Price is found by lookup key, so a price change is a Stripe-side move, not new IDs in code.
// It must match store.config.json, so the page never shows one price and charges another.
export async function getPriceId(): Promise<string> {
  if (cachedPrice && Date.now() - cachedPrice.at < 5 * 60_000) return cachedPrice.id;
  const prices = await getStripe().prices.list({ lookup_keys: [config.lookupKey], active: true, limit: 1 });
  const price = prices.data[0];
  if (!price) throw new Error(`No active Price with lookup_key ${config.lookupKey}; run npm run setup-stripe`);
  if (price.unit_amount !== config.unitAmount || price.currency !== config.currency) {
    throw new Error(`Stripe price ${price.id} is ${price.unit_amount} ${price.currency}, config says ${config.unitAmount} ${config.currency}; run npm run setup-stripe`);
  }
  cachedPrice = { id: price.id, at: Date.now() };
  return price.id;
}
