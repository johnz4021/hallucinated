// The store's sellable products in the current Stripe mode: store.json's catalog (live, or .test in the sandbox) plus
// published agent designs. Used by the CEO (planning), Creative (ad subjects) and Growth (spotlights).
import path from "node:path";
import { readJson } from "../lib/state.mjs";
import { stripeClient } from "../stripe/tools.mjs";
import { loadProposals } from "../designs/ledger.mjs";

export const STORE_HOSTS = (u) => { try { const x = new URL(u); return x.protocol === "https:" && (x.host === "hallucinated-store.vercel.app" || /\.public\.blob\.vercel-storage\.com$/.test(x.host)); } catch { return false; } };
const cache = new Map();   // product_id -> { at, prod, amounts }
// the live price(s) from Stripe, e.g. "$38" or "$38-$42"; copy never hard-codes a price
export const priceText = (amounts = []) => { const a = [...new Set(amounts)].sort((x, y) => x - y); const f = (n) => `$${(n / 100).toFixed(n % 100 ? 2 : 0)}`; return !a.length ? null : a.length === 1 ? f(a[0]) : `${f(a[0])}-${f(a.at(-1))}`; };
export const clearCatalogCache = () => cache.clear();

export async function storeCatalog(rootDir) {
  const sc = stripeClient(rootDir);
  if (sc.error) return [];
  const s = readJson(path.join(rootDir, "store.json"), {});
  const base = (s.url || "https://hallucinated-store.vercel.app").replace(/\/$/, "");
  const listed = (sc.mode === "live" ? s.products : s.test?.products) || [];
  const designs = Object.values(loadProposals(rootDir).proposals).filter((p) => p.state === "published" && p.mode === sc.mode)
    .map((p) => ({ slug: p.slug, product_id: p.publish.product_id, print_url: p.publish.print_url, design_id: p.design_id }));
  const out = [];
  for (const it of [...listed, ...designs]) {
    if (!it.product_id || out.some((o) => o.slug === it.slug)) continue;
    let c = cache.get(it.product_id);
    if (!c || Date.now() - c.at > 10 * 60_000) {
      const prod = await sc.call("GET", `/products/${it.product_id}`).catch(() => null);
      const prices = prod ? ((await sc.call("GET", `/prices?${new URLSearchParams({ product: it.product_id, active: "true", limit: "20" })}`).catch(() => ({ data: [] }))).data || []) : [];
      c = { at: Date.now(), prod, amounts: prices.map((x) => x.unit_amount).filter((n) => Number.isFinite(n)) }; cache.set(it.product_id, c);
    }
    const prod = c.prod;
    if (!prod?.active || !["live", "preorder"].includes(prod.metadata?.status)) continue;
    const images = (prod.images || []).filter(STORE_HOSTS);
    out.push({ slug: it.slug, name: prod.name, description: prod.description, status: prod.metadata.status === "live" ? "in stock" : "pre-order",
      garment: prod.metadata.garment || null, design_id: prod.metadata.design_id || it.design_id || null, url: `${base}/p/${it.slug}`,
      image: images[0] || null, images, print_url: it.print_url || null, by_agents: prod.metadata?.origin === "agents", product_id: it.product_id,
      price: priceText(c.amounts) });
  }
  return out;
}
