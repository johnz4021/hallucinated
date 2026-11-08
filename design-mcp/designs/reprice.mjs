// Reprices published AGENT tees (John, Sat: $65 -> $38). Per size: a new Price at the new amount with the same lookup key
// (transfer_lookup_key) and the same metadata, then the old Price is archived; then the store is revalidated.
// Idempotent: a size whose lookup-key Price is already active at the target amount is left alone.
// Only products with metadata origin=agents (the seed catalog - drop-1, hoodie, cap, tote, bone tee - is refused).
// Pre-orders already placed keep their totals: they reference the old Price ids, whose unit_amount never changes.
//   node designs/reprice.mjs <slug...> --usd 38 [--dry] [--live]      (--live = the live Stripe key; default: test key)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SIZES, activeProducts, storeAdmin } from "./publish.mjs";

// -> { slug, product_id, sizes: [{ size, lookup_key, before: {id, unit_amount, active}|null, after: id, action }], archived_extra: [] }
export async function repriceProduct(sc, slug, cents, { dry = false } = {}) {
  const prods = (await activeProducts(sc, "slug", slug)).filter((p) => p.metadata?.slug === slug);
  if (prods.length !== 1) throw new Error(`${slug}: expected 1 active product, found ${prods.length}`);
  const prod = prods[0];
  if (prod.metadata?.origin !== "agents") throw new Error(`${slug}: not an agent tee (origin=${prod.metadata?.origin || "none"}); refusing`);
  const out = { slug, product_id: prod.id, sizes: [], archived_extra: [] };
  const keep = new Set();
  for (const size of SIZES) {
    const lookup_key = `${slug}-${size.toLowerCase()}`;
    const cur = ((await sc.call("GET", `/prices?${new URLSearchParams({ "lookup_keys[]": lookup_key, limit: "1" })}`)).data || [])[0] || null;
    const before = cur ? { id: cur.id, unit_amount: cur.unit_amount, active: cur.active } : null;
    if (cur && cur.active && cur.unit_amount === cents && cur.product === prod.id) { keep.add(cur.id); out.sizes.push({ size, lookup_key, before, after: cur.id, action: "already at price" }); continue; }
    if (cur && cur.product !== prod.id) throw new Error(`${lookup_key} belongs to another product (${cur.product}); refusing`);
    const body = { product: prod.id, unit_amount: String(cents), currency: cur?.currency || "usd", lookup_key, transfer_lookup_key: "true",
      metadata: cur?.metadata || { size, garment: "tee", color: "black", drop: "agents", slug, origin: "agents", ...(prod.metadata?.design_id ? { design_id: prod.metadata.design_id } : {}) } };
    if (dry) { if (cur) keep.add(cur.id); out.sizes.push({ size, lookup_key, before, after: null, action: `would create ${cents} and archive ${cur?.id || "nothing"}` }); continue; }
    const np = await sc.call("POST", "/prices", body, { idempotencyKey: `reprice-${prod.id}-${size}-${cents}` });
    keep.add(np.id);
    if (cur && cur.active && cur.id !== np.id) await sc.call("POST", `/prices/${cur.id}`, { active: "false" });
    if (cur) keep.add(cur.id);   // handled above (archived), not an "extra"
    out.sizes.push({ size, lookup_key, before, after: np.id, action: cur ? `created ${cents}, archived ${cur.id}` : `created ${cents}` });
  }
  // any other active price left on the product at a different amount (an old size price that lost its key, etc.)
  const active = (await sc.call("GET", `/prices?${new URLSearchParams({ product: prod.id, active: "true", limit: "50" })}`)).data || [];
  for (const p of active) if (!keep.has(p.id) && p.unit_amount !== cents && !dry) { await sc.call("POST", `/prices/${p.id}`, { active: "false" }); out.archived_extra.push(p.id); }
  else if (!keep.has(p.id) && p.unit_amount !== cents && dry) out.archived_extra.push(`${p.id} (would archive)`);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const usdAt = argv.indexOf("--usd"), usd = usdAt >= 0 ? Number(argv[usdAt + 1]) : NaN;
  const dry = argv.includes("--dry");
  if (argv.includes("--live")) process.env.STRIPE_LIVE_OK = "1";
  const slugs = argv.filter((a, i) => !a.startsWith("--") && i !== usdAt + 1);
  if (!slugs.length || !(usd > 0 && usd < 1000)) { console.error("usage: node designs/reprice.mjs <slug...> --usd 38 [--dry] [--live]"); process.exit(1); }
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  const { stripeClient } = await import("../stripe/tools.mjs");
  const { loadProposals, saveProposals } = await import("./ledger.mjs");
  const sc = stripeClient(ROOT);
  if (sc.error) { console.error(sc.error); process.exit(1); }
  const cents = Math.round(usd * 100);
  console.log(`${dry ? "DRY RUN, " : ""}Stripe ${sc.mode} mode: repricing ${slugs.join(", ")} to $${usd} (${cents})`);
  let changed = false;
  for (const slug of slugs) {
    try {
      const r = await repriceProduct(sc, slug, cents, { dry });
      console.log(`\n${slug} (${r.product_id})`);
      for (const s of r.sizes) console.log(`  ${s.size.padEnd(2)} ${s.lookup_key.padEnd(28)} before ${s.before ? `${s.before.id} ${s.before.unit_amount}${s.before.active ? "" : " (inactive)"}` : "none"}  ->  after ${s.after || "-"}   [${s.action}]`);
      if (r.archived_extra.length) console.log(`  also archived: ${r.archived_extra.join(", ")}`);
      if (!dry && r.sizes.some((s) => s.after && s.after !== s.before?.id)) {
        changed = true;
        const l = loadProposals(ROOT);
        for (const p of Object.values(l.proposals)) if (p.slug === slug && p.state === "published" && p.mode === sc.mode && p.publish) {
          p.publish.price_ids = Object.fromEntries(r.sizes.map((s) => [s.size, s.after]));
          p.publish.unit_amount = cents; p.publish.repriced_at = new Date().toISOString();
        }
        saveProposals(ROOT, l);
      }
    } catch (e) { console.log(`\n${slug}: FAILED ${e.message}`); process.exitCode = 1; }
  }
  if (!dry && changed) {
    const admin = storeAdmin(ROOT);
    const ok = admin.error ? admin.error : await admin.call("POST", "/api/revalidate", { json: { what: "all" } }).then(() => "ok").catch((e) => e.message);
    console.log(`\nstore revalidate: ${ok}`);
  }
}
