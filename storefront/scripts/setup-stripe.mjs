// Idempotent catalog sync: seed/catalog.json -> Stripe Products (one per garment/design) + Prices (one per size).
// Finds products by metadata.slug, prices by lookup_key `<slug>-<size>`. If an amount changes it creates a new
// Price, transfers the lookup_key and archives the old one. Prints IDs only.
// Works in test or live mode (live needs ALLOW_LIVE_STRIPE=1); each mode gets its own IDs.
// legacy_lookup_key: also keeps a size-less single Price under that key (the phase-1 page uses
// hallucinated-drop1-tee). It has no metadata.size, so the phase-2 catalog never lists it.
// Usage: node scripts/setup-stripe.mjs [--only slug,slug] [seed-file]
import Stripe from "stripe";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stripeKey, STOREFRONT } from "./root-env.mjs";

const args = process.argv.slice(2);
const oi = args.indexOf("--only");
const only = oi > -1 ? args.splice(oi, 2)[1].split(",") : null;
const seed = JSON.parse(readFileSync(args[0] ?? path.join(STOREFRONT, "seed/catalog.json"), "utf8"));
const cfg = JSON.parse(readFileSync(path.join(STOREFRONT, "store.config.json"), "utf8"));
const { key, mode } = stripeKey();
const stripe = new Stripe(key);

const all = [];
for await (const p of stripe.products.list({ limit: 100 })) all.push(p);

const report = [];
for (const item of seed.products.filter((p) => !only || only.includes(p.slug))) {
  const meta = {
    slug: item.slug, status: item.status, drop: item.drop, design_id: item.design_id, garment: item.garment,
    color: item.color, category: item.category, sort: String(item.sort ?? 100), launch_window: item.launch_window ?? "",
  };
  const data = {
    name: item.name, description: item.description, images: item.images.slice(0, 8), metadata: meta, active: true,
    marketing_features: (item.features ?? []).slice(0, 15).map((name) => ({ name })),
  };
  const legacy = item.legacy_lookup_key
    ? (await stripe.prices.list({ lookup_keys: [item.legacy_lookup_key], limit: 1 })).data[0]
    : null;
  let product = all.find((p) => p.metadata.slug === item.slug) ?? (legacy ? all.find((p) => p.id === legacy.product) : undefined);
  product = product ? await stripe.products.update(product.id, data) : await stripe.products.create(data);

  let legacyId = null;
  if (item.legacy_lookup_key) {
    const lmeta = { drop: item.drop, design_id: item.design_id, garment: item.garment, color: item.color, legacy: "true" };
    if (legacy && legacy.active && legacy.unit_amount === item.unit_amount && legacy.product === product.id) {
      legacyId = (await stripe.prices.update(legacy.id, { metadata: lmeta })).id;
    } else {
      legacyId = (await stripe.prices.create({
        product: product.id, unit_amount: item.unit_amount, currency: cfg.currency,
        lookup_key: item.legacy_lookup_key, transfer_lookup_key: true, metadata: lmeta,
      })).id;
      if (legacy && legacy.active) await stripe.prices.update(legacy.id, { active: false });
    }
  }

  const prices = {};
  for (const size of item.sizes) {
    const lookup_key = `${item.slug}-${size.toLowerCase()}`;
    const pmeta = { drop: item.drop, design_id: item.design_id, garment: item.garment, color: item.color, size, slug: item.slug };
    const existing = (await stripe.prices.list({ lookup_keys: [lookup_key], limit: 1 })).data[0];
    let price = existing;
    if (!existing || existing.unit_amount !== item.unit_amount || existing.currency !== cfg.currency || !existing.active || existing.product !== product.id) {
      price = await stripe.prices.create({
        product: product.id, unit_amount: item.unit_amount, currency: cfg.currency, lookup_key, transfer_lookup_key: true, metadata: pmeta,
      });
      if (existing && existing.active) await stripe.prices.update(existing.id, { active: false });
    } else {
      price = await stripe.prices.update(existing.id, { metadata: pmeta });
    }
    prices[size] = price.id;
  }
  // Archive size prices that are no longer in the seed.
  for await (const pr of stripe.prices.list({ product: product.id, active: true, limit: 100 })) {
    if (pr.metadata.size && !Object.values(prices).includes(pr.id)) await stripe.prices.update(pr.id, { active: false });
    // (size-less prices, like the legacy one, are left alone)
  }
  await stripe.products.update(product.id, { default_price: prices[item.sizes[0]] });
  report.push({ slug: item.slug, status: item.status, product_id: product.id, prices, ...(legacyId ? { legacy_price: legacyId } : {}) });
}
console.log(JSON.stringify({ mode, products: report }, null, 2));
