// Reference implementation of CONTENT.md §4 (agent design publish flow), used for sandbox tests.
// Usage: node scripts/publish-design.mjs <dossier.json> --print-url <blob url> --base <admin base url> [--price 3800]
//   dossier.json: { slug, design_id, title, placement?, description, features?, trend, pitch, ceo, product_session?, ceo_session?, created_at? }
// Stripe calls use whichever STRIPE_SECRET_KEY is in the repo-root .env (test unless ALLOW_LIVE_STRIPE=1).
import Stripe from "stripe";
import { readFileSync } from "node:fs";
import { envVar, stripeKey } from "./root-env.mjs";

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i > -1 ? args[i + 1] : d; };
const d = JSON.parse(readFileSync(args[0], "utf8"));
const printUrl = opt("--print-url");
const base = (opt("--base", "https://hallucinated-store.vercel.app")).replace(/\/$/, "");
const STORE = "https://hallucinated-store.vercel.app"; // mockup URLs always use production; the site localizes them
const price = Number(opt("--price", 3800));
const admin = envVar("STORE_ADMIN_SECRET");
const { key, mode } = stripeKey();
const stripe = new Stripe(key);
if (!printUrl || !d.slug) throw new Error("need dossier.slug and --print-url");

const placement = d.placement === "front" ? "front" : "back";
const mockup = `${STORE}/api/mockup?side=${placement}&print=${encodeURIComponent(printUrl)}`;
const flat = `${STORE}/api/mockup?side=flat&print=${encodeURIComponent(printUrl)}`;
const meta = { slug: d.slug, status: "preorder", origin: "agents", launch_window: d.launch_window ?? "When it launches", drop: "agents",
  design_id: d.design_id, garment: "tee", color: "black", category: "tees", placement };

const existing = (await stripe.products.search({ query: `metadata['slug']:'${d.slug}'` })).data.find((p) => p.active);
const product = existing
  ? await stripe.products.update(existing.id, { name: d.title, description: d.description, images: [mockup, flat], metadata: meta })
  : await stripe.products.create({ name: d.title, description: d.description, images: [mockup, flat], metadata: meta,
      marketing_features: (d.features ?? []).map((name) => ({ name })) });
const prices = {};
for (const size of ["S", "M", "L", "XL"]) {
  const lookup_key = `${d.slug}-${size.toLowerCase()}`;
  const found = (await stripe.prices.list({ lookup_keys: [lookup_key], limit: 1 })).data[0];
  prices[size] = found && found.active && found.unit_amount === price ? found.id : (await stripe.prices.create({
    product: product.id, unit_amount: price, currency: "usd", lookup_key, transfer_lookup_key: true,
    metadata: { size, design_id: d.design_id, garment: "tee", color: "black", drop: "agents", slug: d.slug, origin: "agents" },
  })).id;
}

const auth = { authorization: `Bearer ${admin}`, "content-type": "application/json" };
const item = { slug: d.slug, design_id: d.design_id, title: d.title, trend: d.trend, pitch: d.pitch, ceo: d.ceo,
  product_session: d.product_session, ceo_session: d.ceo_session, created_at: d.created_at ?? new Date().toISOString() };
const r1 = await fetch(`${base}/api/admin/content`, { method: "PATCH", headers: auth, body: JSON.stringify({ op: "upsert", collection: "designs", item }) });
const r2 = await fetch(`${base}/api/revalidate`, { method: "POST", headers: auth, body: JSON.stringify({ what: "all" }) });
console.log(JSON.stringify({ mode, product_id: product.id, prices, mockup, dossier: `${r1.status} ${await r1.text()}`, revalidate: r2.status }, null, 2));
