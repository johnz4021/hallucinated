// Unit checks for designs/reprice.mjs with a fake Stripe (no network). node designs/reprice_test.mjs
import assert from "node:assert/strict";
import { repriceProduct } from "./reprice.mjs";
import { PRICE_CENTS, priceBody } from "./publish.mjs";

function fakeStripe() {
  let n = 0;
  const products = [
    { id: "prod_a", active: true, metadata: { slug: "git-blame-ai-tee", origin: "agents", design_id: "d1" } },
    { id: "prod_seed", active: true, metadata: { slug: "bone-tee", status: "live" } },
  ];
  const prices = [];
  for (const size of ["S", "M", "L", "XL"]) prices.push({ id: `price_old_${size}`, product: "prod_a", active: true, unit_amount: 6500, currency: "usd", lookup_key: `git-blame-ai-tee-${size.toLowerCase()}`,
    metadata: { size, design_id: "d1", garment: "tee", color: "black", drop: "agents", slug: "git-blame-ai-tee", origin: "agents" } });
  prices.push({ id: "price_stray", product: "prod_a", active: true, unit_amount: 6500, currency: "usd", lookup_key: null, metadata: {} });
  const calls = [];
  const call = async (method, p, body, opts) => {
    calls.push({ method, p, body, opts });
    const u = new URL("https://api.stripe.com/v1" + p);
    if (method === "GET" && u.pathname === "/v1/products/search") { const slug = (u.searchParams.get("query").match(/metadata\['slug'\]:'([^']+)'/) || [])[1]; return { data: products.filter((x) => x.metadata.slug === slug && x.active) }; }
    if (method === "GET" && u.pathname === "/v1/prices") {
      const lk = u.searchParams.get("lookup_keys[]"), prod = u.searchParams.get("product");
      return { data: prices.filter((x) => (lk ? x.lookup_key === lk : x.product === prod) && (u.searchParams.get("active") !== "true" || x.active)) };
    }
    if (method === "POST" && u.pathname === "/v1/prices") {
      const dup = prices.find((x) => x.idem && x.idem === opts?.idempotencyKey); if (dup) return dup;
      if (body.transfer_lookup_key === "true") for (const x of prices) if (x.lookup_key === body.lookup_key) x.lookup_key = null;
      const x = { id: `price_new_${++n}`, active: true, ...body, unit_amount: Number(body.unit_amount), idem: opts?.idempotencyKey }; prices.push(x); return x;
    }
    if (method === "POST" && u.pathname.startsWith("/v1/prices/")) { const x = prices.find((y) => y.id === u.pathname.split("/")[3]); if (body.active === "false") x.active = false; return x; }
    throw new Error(`fake: ${method} ${p}`);
  };
  return { call, mode: "test", prices, calls };
}

assert.equal(PRICE_CENTS, 3800);                                         // new default (DESIGN_PRICE_USD unset)
assert.equal(priceBody({ slug: "x-tee", design_id: "d" }, "prod", "M").unit_amount, "3800");
console.log("publisher default $38: OK");

const sc = fakeStripe();
const dry = await repriceProduct(sc, "git-blame-ai-tee", 3800, { dry: true });
assert.equal(sc.calls.filter((c) => c.method === "POST").length, 0);      // dry writes nothing
assert.deepEqual(dry.sizes.map((s) => s.before.id), ["price_old_S", "price_old_M", "price_old_L", "price_old_XL"]);
console.log("dry run: no writes: OK");

const r = await repriceProduct(sc, "git-blame-ai-tee", 3800);
for (const s of r.sizes) {
  const np = sc.prices.find((x) => x.id === s.after), old = sc.prices.find((x) => x.id === s.before.id);
  assert.equal(np.unit_amount, 3800); assert.equal(np.active, true); assert.equal(np.lookup_key, s.lookup_key); assert.equal(np.product, "prod_a");
  assert.deepEqual(np.metadata, old.metadata);                            // same metadata (size, design_id, ...)
  assert.equal(old.active, false); assert.equal(old.unit_amount, 6500);   // archived; its amount (what old pre-orders reference) unchanged
  assert.equal(old.lookup_key, null);                                     // the key moved
}
assert.deepEqual(r.archived_extra, ["price_stray"]);
assert.deepEqual(sc.prices.filter((x) => x.product === "prod_a" && x.active).map((x) => x.unit_amount), [3800, 3800, 3800, 3800]);
console.log("reprice: new prices, same keys + metadata, old archived: OK");

const posts = sc.calls.filter((c) => c.method === "POST").length;
const again = await repriceProduct(sc, "git-blame-ai-tee", 3800);
assert.ok(again.sizes.every((s) => s.action === "already at price")); assert.equal(sc.calls.filter((c) => c.method === "POST").length, posts);
console.log("idempotent: second run writes nothing: OK");

await assert.rejects(repriceProduct(sc, "bone-tee", 3800), /not an agent tee/);
await assert.rejects(repriceProduct(sc, "no-such-tee", 3800), /expected 1 active product/);
console.log("seed catalog / unknown slug refused: OK");
console.log("reprice tests: all OK");
