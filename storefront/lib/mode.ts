import "server-only";

// True when the server's Stripe key is a test key (or missing). Drives the "test mode" note on the page.
export function isTestMode() {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  return !(key.startsWith("sk_live_") || key.startsWith("rk_live_"));
}
