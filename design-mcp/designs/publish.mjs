// Deterministic publish of an approved agent design (storefront/CONTENT.md §4). No LLM in here:
//   1. upload the print (downscaled to 2000 px, PNG) -> Blob url
//   2. images: [back mockup, FRONT mockup with the Hallucinated chest wordmark, flat]. Every agent shirt is two-sided: the
//      front is always our wordmark (brand/hallucinated-logo-black-tee-chest-4in-300dpi.png, uploaded once, URL cached),
//      the back is the agent's design. Metadata front=wordmark. backfillFront() brings older products up to this.
//   3. Stripe product (status=preorder, origin=agents, drop=agents, ...) + one $65 price per S/M/L/XL, lookup key <slug>-<size>
//   4. dossier: PATCH /api/admin/content collection "designs"
//   5. POST /api/revalidate {"what":"all"}
// Uses whichever Stripe mode stripeClient picked (sandbox unless STRIPE_LIVE_OK=1). Every Stripe create has an
// idempotency key per proposal, and a design that already has an active product is refused (published once, ever).
// Unpublish: archiveDesign() (products + prices inactive, dossier removed, revalidate).
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import { envKey, readJson, writeJson } from "../lib/state.mjs";

export const STORE = "https://hallucinated-store.vercel.app";
export const SIZES = ["S", "M", "L", "XL"];
export const PRICE_CENTS = 6500;
export const placementOf = (verdict) => (verdict?.args?.placement === "front-chest" ? "front" : "back");
const clip = (s, n) => String(s || "").slice(0, n);

export function storeAdmin(rootDir, fetchImpl = fetch) {
  const secret = envKey(rootDir, "STORE_ADMIN_SECRET");
  if (!secret) return { error: "STORE_ADMIN_SECRET is not in .env" };
  const call = async (method, p, { json, body, type } = {}) => {
    const r = await fetchImpl(STORE + p, { method, headers: { Authorization: `Bearer ${secret}`, ...(json ? { "Content-Type": "application/json" } : type ? { "Content-Type": type } : {}) },
      body: json ? JSON.stringify(json) : body, signal: AbortSignal.timeout(40_000) });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { raw: t.slice(0, 300) }; }
    if (!r.ok) { const e = new Error(`store ${method} ${p.split("?")[0]} ${r.status}: ${j.error || j.raw || ""}`); e.status = r.status; throw e; }
    return j;
  };
  return { call };
}

// The front of every agent shirt: our real chest wordmark print (same front as drop #1), uploaded to Blob once.
export const FRONT_LOGO_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "brand", "hallucinated-logo-black-tee-chest-4in-300dpi.png");
export const FRONT_FEATURE = "Front: Hallucinated wordmark";
export async function frontLogoUrl(rootDir, admin) {
  const f = path.join(rootDir, "store-assets.json"), cache = readJson(f, {});
  if (cache.front_wordmark_url) return cache.front_wordmark_url;
  const up = await admin.call("POST", "/api/admin/upload?name=hallucinated-wordmark-front", { body: fs.readFileSync(FRONT_LOGO_FILE), type: "image/png" });
  writeJson(f, { ...cache, front_wordmark_url: up.url, front_wordmark_at: new Date().toISOString() });
  return up.url;
}

// Pure: what we send to Stripe, so the shape is unit-checked against the contract.
export const mockupUrls = (printUrl, placement, frontUrl) => ({
  main: `${STORE}/api/mockup?side=${placement}&print=${encodeURIComponent(printUrl)}`,   // images[0]: the agent's print on a black tee (back)
  ...(frontUrl ? { front: `${STORE}/api/mockup?side=front&print=${encodeURIComponent(frontUrl)}` } : {}),   // images[1]: the wordmark on the chest
  flat: `${STORE}/api/mockup?side=flat&print=${encodeURIComponent(printUrl)}`,           // last: the print on shirt-black (light ink is invisible on a raw PNG)
});
export function productBody(p, { mockupUrl, frontUrl, flatUrl, placement }) {
  const name = /\btee$/i.test(p.title.trim()) ? p.title.trim() : `${p.title.trim()} tee`;
  return {
    name: clip(name, 120), description: clip(p.pitch, 350), images: [mockupUrl, ...(frontUrl ? [frontUrl] : []), flatUrl],
    marketing_features: [{ name: "Black tee" }, { name: FRONT_FEATURE }, { name: clip(`Back: ${p.print_line || p.title}`, 80) },
      { name: "Pre-order: your card is saved, charged when it launches" }, { name: "Designed by our Product agent, approved by our CEO agent" }],
    metadata: { slug: p.slug, status: "preorder", origin: "agents", launch_window: "When it launches", drop: "agents", design_id: p.design_id,
      garment: "tee", color: "black", category: "tees", placement, front: "wordmark", proposal_id: p.proposal_id },
  };
}
export const priceBody = (p, productId, size) => ({
  product: productId, unit_amount: String(PRICE_CENTS), currency: "usd", lookup_key: `${p.slug}-${size.toLowerCase()}`, transfer_lookup_key: "true",
  metadata: { size, design_id: p.design_id, garment: "tee", color: "black", drop: "agents", slug: p.slug, origin: "agents" },
});
export const dossierItem = (p) => ({
  slug: p.slug, design_id: p.design_id, title: clip(p.title, 120),
  trend: { summary: clip(p.trend_summary, 600), sources: (p.sources || []).slice(0, 6).map((s) => ({ label: clip(s.label, 120), url: s.url })) },
  pitch: clip(p.pitch, 600),
  ceo: { verdict: "approved", reason: clip(p.decision?.reason, 800), at: p.decision?.at },
  ...(p.product_session ? { product_session: p.product_session } : {}), ...(p.ceo_session ? { ceo_session: p.ceo_session } : {}),
  created_at: p.proposed_at,
});

const q = (s) => String(s).replace(/'/g, "\\'");
export async function activeProducts(sc, field, value) {
  const r = await sc.call("GET", `/products/search?${new URLSearchParams({ query: `metadata['${field}']:'${q(value)}' AND active:'true'`, limit: "10" })}`);
  return r.data || [];
}

export async function publishDesign({ rootDir, sc, admin, proposal: p, outDir, log = () => {} }) {
  const verdict = JSON.parse(fs.readFileSync(path.join(outDir, `${p.design_id}.json`), "utf8"));
  const placement = placementOf(verdict);
  // published once, ever: an active product for this design (or this slug) that isn't this proposal's own is a refusal;
  // this proposal's own product (a retry) is updated in place, like storefront/scripts/publish-design.mjs does
  const mine = (x) => x.metadata?.proposal_id === p.proposal_id;
  const designHits = await activeProducts(sc, "design_id", p.design_id), slugHits = await activeProducts(sc, "slug", p.slug);
  const byDesign = designHits.filter((x) => !mine(x));
  if (byDesign.length) throw Object.assign(new Error(`design ${p.design_id} is already on sale as ${byDesign[0].id} (${byDesign[0].metadata?.slug})`), { permanent: true });
  const bySlug = slugHits.filter((x) => !mine(x));
  if (bySlug.length) throw Object.assign(new Error(`slug ${p.slug} is already used by ${bySlug[0].id}`), { permanent: true });
  const own = [...designHits, ...slugHits].find(mine) || null;

  // 1. print, downscaled (the 300-dpi file is far bigger than the 2000 px the site needs)
  // Full-colour photo/collage prints are much heavier than line art: step the size down until it fits the 4.4 MB upload limit
  let png;
  for (const px of [2000, 1600, 1400, 1200]) {
    png = await sharp(path.join(outDir, `${p.design_id}.png`)).resize(px, px, { fit: "inside", withoutEnlargement: true }).png({ compressionLevel: 9, effort: 10 }).toBuffer();
    if (png.length <= 4_200_000) break;
  }
  if (png.length > 4_200_000) throw new Error(`print is ${png.length} bytes even at 1200 px (limit 4.4 MB)`);
  const up = await admin.call("POST", `/api/admin/upload?name=${encodeURIComponent(`${p.slug}-print`)}`, { body: png, type: "image/png" });
  const printUrl = up.url;
  // 2. mockups (no call: the site renders them from the print URL)
  if (placement !== "back") throw Object.assign(new Error("agent shirts are back prints; the front is always the Hallucinated wordmark"), { permanent: true });
  const { main: mockupUrl, front: frontUrl, flat: flatUrl } = mockupUrls(printUrl, placement, await frontLogoUrl(rootDir, admin));
  log(`[publish] ${p.slug}: print ${printUrl}`);
  // 3. Stripe product + prices: reuse this proposal's own product / an active same-amount price on a retry
  const body = productBody(p, { mockupUrl, frontUrl, flatUrl, placement });
  const prod = own
    ? await sc.call("POST", `/products/${own.id}`, { name: body.name, description: body.description, images: body.images, metadata: body.metadata })
    : await sc.call("POST", "/products", body, { idempotencyKey: `design-product-${p.proposal_id}` });
  const price_ids = {};
  for (const size of SIZES) {
    const pb = priceBody(p, prod.id, size);
    const found = ((await sc.call("GET", `/prices?${new URLSearchParams({ "lookup_keys[]": pb.lookup_key, limit: "1" })}`)).data || [])[0];
    price_ids[size] = found && found.active && found.product === prod.id && found.unit_amount === PRICE_CENTS ? found.id
      : (await sc.call("POST", "/prices", pb, { idempotencyKey: `design-price-${p.proposal_id}-${size}` })).id;
  }
  log(`[publish] ${p.slug}: ${sc.mode} product ${prod.id}, prices ${Object.values(price_ids).join(", ")}`);
  // 4. dossier (409 = someone else wrote first: retry)
  const dossier = await writeDossier(admin, p);
  // 5. revalidate
  const reval = await admin.call("POST", "/api/revalidate", { json: { what: "all" } }).then(() => true).catch((e) => { log(`[publish] revalidate failed: ${e.message}`); return false; });
  return { mode: sc.mode, product_id: prod.id, price_ids, print_url: printUrl, mockup_url: mockupUrl, front_url: frontUrl, flat_url: flatUrl, placement, url: `${STORE}/p/${p.slug}`,
    dossier, revalidated: reval, published_at: new Date().toISOString() };
}

export async function writeDossier(admin, p) {
  for (let i = 0; i < 3; i++) {
    try { await admin.call("PATCH", "/api/admin/content", { json: { op: "upsert", collection: "designs", item: dossierItem(p) } }); return { ok: true }; }
    catch (e) { if (e.status !== 409) return { ok: false, error: e.message }; await new Promise((r) => setTimeout(r, 800)); }
  }
  return { ok: false, error: "content kept changing (409 x3)" };
}

// For unpublish.mjs (John only): every active product with this slug -> prices + product inactive, dossier removed.
export async function archiveDesign({ sc, admin, slug, log = () => {} }) {
  const prods = await activeProducts(sc, "slug", slug);
  const done = [];
  for (const prod of prods) {
    const prices = (await sc.call("GET", `/prices?product=${prod.id}&active=true&limit=100`)).data || [];
    for (const pr of prices) await sc.call("POST", `/prices/${pr.id}`, { active: "false" });
    await sc.call("POST", `/products/${prod.id}`, { active: "false" });
    done.push({ product_id: prod.id, prices: prices.map((x) => x.id) });
    log(`[unpublish] ${slug}: archived ${prod.id} and ${prices.length} price(s)`);
  }
  const dossier = await admin.call("PATCH", "/api/admin/content", { json: { op: "remove", collection: "designs", id: slug } }).then(() => "removed").catch((e) => (e.status === 404 ? "none" : `error: ${e.message}`));
  const reval = await admin.call("POST", "/api/revalidate", { json: { what: "all" } }).then(() => true).catch(() => false);
  return { mode: sc.mode, archived: done, dossier, revalidated: reval };
}

// Brings an agent product published before the two-sided rule up to it, in place: images become [back mockup, front
// wordmark mockup, flat], metadata front=wordmark, and the "Front: Hallucinated wordmark" feature line. Idempotent.
export async function backfillFront({ sc, admin, rootDir, slug, dry = false, log = () => {} }) {
  const prods = (await activeProducts(sc, "slug", slug)).filter((x) => x.metadata?.origin === "agents");
  if (!prods.length) return { slug, mode: sc.mode, error: "no active agent product with that slug" };
  const front = `${STORE}/api/mockup?side=front&print=${encodeURIComponent(await frontLogoUrl(rootDir, admin))}`;
  const out = [];
  for (const prod of prods) {
    const imgs = prod.images || [];
    const hasFront = imgs.some((u) => u === front || /[?&]side=front&/.test(u));
    const images = hasFront ? imgs : [imgs[0], front, ...imgs.slice(1)].filter(Boolean).slice(0, 8);
    const feats = (prod.marketing_features || []).map((f) => f.name);
    const features = feats.includes(FRONT_FEATURE) ? feats : [feats[0] || "Black tee", FRONT_FEATURE, ...feats.slice(1)].filter(Boolean).slice(0, 15);
    const patch = { images, metadata: { ...prod.metadata, front: "wordmark" }, marketing_features: features.map((name) => ({ name })) };
    if (!dry) await sc.call("POST", `/products/${prod.id}`, patch);
    out.push({ product_id: prod.id, images_before: imgs.length, images_after: images.length, front_added: !hasFront, feature_added: !feats.includes(FRONT_FEATURE), dry });
    log(`[backfill] ${slug} ${prod.id} ${dry ? "(dry) " : ""}front ${hasFront ? "already there" : "added"}`);
  }
  if (!dry) await admin.call("POST", "/api/revalidate", { json: { what: "all" } }).catch(() => {});
  return { slug, mode: sc.mode, front_mockup: front, products: out };
}
