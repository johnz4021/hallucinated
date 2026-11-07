import "server-only";
import Stripe from "stripe";

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
