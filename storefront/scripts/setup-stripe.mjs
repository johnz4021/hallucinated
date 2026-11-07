// Idempotent: finds or creates the drop-1 Product + Price (by lookup_key) and prints only the IDs.
// If store.config.json's amount changed, creates a new Price, transfers the lookup_key to it, archives the old one.
import Stripe from "stripe";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stripeKey, STOREFRONT } from "./root-env.mjs";

const cfg = JSON.parse(readFileSync(path.join(STOREFRONT, "store.config.json"), "utf8"));
const { key, mode } = stripeKey();
const stripe = new Stripe(key);

const productData = {
  name: cfg.product_name,
  description: cfg.product_description,
  metadata: { drop: cfg.drop, design_id: cfg.design_id },
};

const existing = (await stripe.prices.list({ lookup_keys: [cfg.lookup_key], expand: ["data.product"], limit: 1 })).data[0];

let productId;
if (existing) {
  productId = typeof existing.product === "string" ? existing.product : existing.product.id;
} else {
  const found = await stripe.products.search({ query: `metadata['design_id']:'${cfg.design_id}' AND active:'true'` }).catch(() => ({ data: [] }));
  productId = found.data[0]?.id;
}
if (productId) {
  await stripe.products.update(productId, productData);
} else {
  productId = (await stripe.products.create(productData)).id;
}

let price = existing;
let action = "unchanged";
if (!existing || existing.unit_amount !== cfg.unit_amount || existing.currency !== cfg.currency || !existing.active) {
  price = await stripe.prices.create({
    product: productId,
    unit_amount: cfg.unit_amount,
    currency: cfg.currency,
    lookup_key: cfg.lookup_key,
    transfer_lookup_key: true,
    metadata: { drop: cfg.drop, design_id: cfg.design_id },
  });
  if (existing) await stripe.prices.update(existing.id, { active: false });
  action = existing ? `replaced ${existing.id} (archived)` : "created";
}
await stripe.products.update(productId, { default_price: price.id });

console.log(JSON.stringify({ mode, product_id: productId, price_id: price.id, lookup_key: cfg.lookup_key, unit_amount: price.unit_amount, currency: price.currency, price: action }, null, 2));
