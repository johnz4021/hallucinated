// Reads selected keys from the repo-root .env (../.env) without printing anything.
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const STOREFRONT = path.join(ROOT, "storefront");

export function readRootEnv(file = path.join(ROOT, ".env")) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

// Returns the Stripe secret key, refusing anything but a test key unless allowLive.
export function stripeKey({ allowLive = process.env.ALLOW_LIVE_STRIPE === "1" } = {}) {
  const key = process.env.STRIPE_SECRET_KEY || readRootEnv().STRIPE_SECRET_KEY;
  if (!key) {
    console.error("STRIPE_SECRET_KEY is missing from the repo-root .env. Add it (test mode: sk_test_... or rk_test_...).");
    process.exit(2);
  }
  const isTest = key.startsWith("sk_test_") || key.startsWith("rk_test_");
  if (!isTest && !allowLive) {
    console.error("Refusing: STRIPE_SECRET_KEY is not a test key (sk_test_/rk_test_). Live mode needs John's explicit OK.");
    process.exit(2);
  }
  return { key, mode: isTest ? "test" : "live" };
}
