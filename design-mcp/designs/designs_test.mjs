// Unit checks for the design loop: guardrails, daily caps, publish-once (idempotency), the publish request shapes
// against storefront/CONTENT.md §4, retry-in-place, and announce-once. In-memory Stripe + store stubs; no network.
//   node designs/designs_test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkProposal, findBanned, SLUG_RE } from "./guard.mjs";
import { loadProposals, saveProposals, proposalsToday, publishesToday, publishedDesign, openProposal, slugTaken, ptDay, MAX_PROPOSALS_PER_DAY, MAX_PUBLISHES_PER_DAY } from "./ledger.mjs";
import { publishDesign, productBody, priceBody, dossierItem, mockupUrls, backfillFront, FRONT_FEATURE, STORE } from "./publish.mjs";
import { announceCheck, markAnnounced } from "./tools.mjs";

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "design-test");

// ---- guardrails
const clean = { title: "Merge conflict", slug: "merge-conflict-tee", pitch: "A diff that never resolves, like your Thursday standup.", trend_summary: "On Reddit and HN people keep joking about merge conflicts with their AI agents; the cloud ate my homework.", print_text: "<<<<<<< HEAD", prompt: "no logos, no real brands" };
assert.deepEqual(checkProposal(clean), []);
assert.equal(checkProposal({ ...clean, title: "Elon ships it" })[0].term, "elon");
assert.equal(checkProposal({ ...clean, pitch: "Powered by OpenAI vibes" })[0].term, "openai");
assert.equal(checkProposal({ ...clean, print_text: "GPT-5 wrote this" })[0].term, "gpt-5");
assert.equal(checkProposal({ ...clean, slug: "yc-reject-tee" })[0].term, "yc");
assert.equal(checkProposal({ ...clean, trend_summary: "jokes about the 9/11 anniversary" })[0].term, "9/11");
assert.equal(checkProposal({ ...clean, trend_summary: "r/sanfrancisco and Reddit threads" }).length, 0);   // platforms may be named as sources
assert.equal(checkProposal({ ...clean, prompt: "a portrait of Sam Altman" })[0].term, "altman");
assert.equal(findBanned({ t: "the cloud is someone else's computer; git push --force" }).length, 0);
assert.equal(findBanned({ t: "Metadata is fine, so is 'meta'" }).length, 0);      // only "meta platforms" is banned
assert.equal(findBanned({ t: "Stripe-ready" })[0].term, "stripe");
assert.equal(SLUG_RE.test("merge-conflict-tee"), true); assert.equal(SLUG_RE.test("Merge_Conflict"), false); assert.equal(SLUG_RE.test("a--b"), false);
console.log("guardrails: OK");

// ---- caps and idempotency in the ledger (per Pacific day, per Stripe mode)
const root = fs.mkdtempSync(path.join(os.tmpdir(), "designs-test-"));
const now = new Date();
const P = (id, o) => ({ proposal_id: id, mode: "test", state: "pending", design_id: "aaaaaaaaaaaa", slug: `s-${id}`, proposed_at: now.toISOString(), ...o });
let l = loadProposals(root);
l.proposals.p1 = P("p1"); l.proposals.p2 = P("p2", { design_id: "bbbbbbbbbbbb", state: "published", publish: { published_at: now.toISOString(), url: `${STORE}/p/s-p2` } });
l.proposals.p3 = P("p3", { mode: "live", design_id: "cccccccccccc" });
l.proposals.p4 = P("p4", { proposed_at: "2026-01-01T12:00:00Z", design_id: "dddddddddddd" });
saveProposals(root, l); l = loadProposals(root);
assert.equal(MAX_PROPOSALS_PER_DAY(), 6); assert.equal(MAX_PUBLISHES_PER_DAY(), 6);
assert.equal(proposalsToday(l, "test").length, 2);          // p1, p2 (p4 is another day, p3 another mode)
assert.equal(proposalsToday(l, "live").length, 1);
assert.equal(publishesToday(l, "test").length, 1);
assert.equal(publishesToday(l, "live").length, 0);           // sandbox tests never use up live's allowance
assert.ok(publishedDesign(l, "test", "bbbbbbbbbbbb")); assert.equal(publishedDesign(l, "live", "bbbbbbbbbbbb"), null);
assert.ok(openProposal(l, "test", "aaaaaaaaaaaa")); assert.equal(openProposal(l, "test", "bbbbbbbbbbbb"), null);
assert.equal(slugTaken(l, "test", "s-p2"), true); assert.equal(slugTaken(l, "test", "s-new"), false);
assert.equal(ptDay(new Date("2026-11-08T07:59:00Z")), "2026-11-07"); assert.equal(ptDay(new Date("2026-11-08T08:01:00Z")), "2026-11-08");
console.log("caps + ledger: OK");

// ---- publish against stubs
function stripeStub() {
  const products = [], prices = [];
  let n = 0;
  return { mode: "test", products, prices, calls: [],
    async call(method, p, body, opts) {
      this.calls.push({ method, p, body, opts });
      const u = new URL("https://x" + p);
      if (method === "GET" && u.pathname === "/products/search") {
        const [, field, value] = u.searchParams.get("query").match(/metadata\['(\w+)'\]:'([^']+)'/);
        return { data: products.filter((x) => x.active && x.metadata[field] === value) };
      }
      if (method === "GET" && u.pathname === "/prices") {
        const lk = u.searchParams.get("lookup_keys[]"), prod = u.searchParams.get("product");
        return { data: prices.filter((x) => (lk ? x.lookup_key === lk : x.product === prod) && (!u.searchParams.get("active") || x.active)) };
      }
      if (method === "POST" && u.pathname === "/products") { const x = { id: `prod_${++n}`, active: true, ...body }; products.push(x); return x; }
      if (method === "POST" && u.pathname.startsWith("/products/")) { const x = products.find((y) => y.id === u.pathname.split("/")[2]); Object.assign(x, body, body.active === "false" ? { active: false } : {}); return x; }
      if (method === "POST" && u.pathname === "/prices") {
        if (body.transfer_lookup_key === "true") for (const x of prices) if (x.lookup_key === body.lookup_key) x.lookup_key = null;
        const x = { id: `price_${++n}`, active: true, ...body, unit_amount: Number(body.unit_amount) }; prices.push(x); return x;
      }
      if (method === "POST" && u.pathname.startsWith("/prices/")) { const x = prices.find((y) => y.id === u.pathname.split("/")[2]); if (body.active === "false") x.active = false; return x; }
      throw new Error(`stub: unexpected ${method} ${p}`);
    } };
}
const adminStub = () => ({ calls: [], designs: {}, async call(method, p, o = {}) {
  this.calls.push({ method, p, o });
  if (p.startsWith("/api/admin/upload")) { assert.ok(o.body.length > 1000 && o.body.length < 4_400_000); assert.equal(o.type, "image/png"); const name = new URL("https://x" + p).searchParams.get("name"); return { url: `https://x2ww2cgnt2vbaqob.public.blob.vercel-storage.com/media/agents/${name}-abc.png` }; }
  if (p === "/api/admin/content") { if (o.json.op === "upsert") this.designs[o.json.item.slug] = o.json.item; return { ok: true }; }
  if (p === "/api/revalidate") return { ok: true };
  throw new Error("admin stub: " + p);
} });

const sc = stripeStub(), admin = adminStub();
const prop = { proposal_id: "prop_t1", mode: "test", design_id: "bc1dbe9d9aae", title: "Merge conflict", slug: "merge-conflict-tee", pitch: clean.pitch, trend_summary: clean.trend_summary,
  sources: [{ label: "r/programming thread", url: "https://reddit.com/r/programming/x" }], print_line: "a diff that never resolves", proposed_at: now.toISOString(),
  ceo_session: "ses_ceo", product_session: "ses_prod", decision: { decision: "approve", reason: "Lands for anyone who has rebased on a Friday; no names, no marks.", at: now.toISOString() } };
const pub = await publishDesign({ rootDir: root, sc, admin, proposal: prop, outDir: OUT });
const prod = sc.products[0];
assert.equal(sc.products.length, 1); assert.equal(pub.product_id, prod.id);
assert.deepEqual(prod.metadata, { slug: "merge-conflict-tee", status: "preorder", origin: "agents", launch_window: "When it launches", drop: "agents", design_id: "bc1dbe9d9aae", garment: "tee", color: "black", category: "tees", placement: "back", front: "wordmark", proposal_id: "prop_t1" });
assert.equal(prod.name, "Merge conflict tee");
// two-sided: [back mockup of the design, FRONT mockup of the chest wordmark, flat]
assert.equal(prod.images.length, 3);
assert.match(prod.images[0], /\/api\/mockup\?side=back&print=.*merge-conflict-tee-print/);
assert.match(prod.images[1], /\/api\/mockup\?side=front&print=.*hallucinated-wordmark-front/);
assert.match(prod.images[2], /\/api\/mockup\?side=flat&print=.*merge-conflict-tee-print/);
assert.ok(prod.marketing_features.some((f) => f.name === FRONT_FEATURE));
assert.equal(sc.prices.length, 4);
for (const [i, size] of ["S", "M", "L", "XL"].entries()) {
  const pr = sc.prices[i];
  assert.equal(pr.lookup_key, `merge-conflict-tee-${size.toLowerCase()}`); assert.equal(pr.unit_amount, 6500); assert.equal(pr.currency, "usd"); assert.equal(pr.transfer_lookup_key, "true");
  assert.deepEqual(pr.metadata, { size, design_id: "bc1dbe9d9aae", garment: "tee", color: "black", drop: "agents", slug: "merge-conflict-tee", origin: "agents" });
}
const dz = admin.designs["merge-conflict-tee"];
assert.equal(dz.ceo.verdict, "approved"); assert.equal(dz.ceo.reason, prop.decision.reason); assert.equal(dz.trend.sources.length, 1); assert.equal(dz.product_session, "ses_prod"); assert.equal(dz.ceo_session, "ses_ceo");
assert.ok(admin.calls.some((c) => c.p === "/api/revalidate" && c.o.json.what === "all"));
assert.equal(pub.url, `${STORE}/p/merge-conflict-tee`); assert.equal(pub.dossier.ok, true);
assert.ok(sc.calls.filter((c) => c.method === "POST" && c.p === "/products").every((c) => c.opts?.idempotencyKey === "design-product-prop_t1"));

// retry of the same proposal: updates in place, reuses the prices (no duplicates)
await publishDesign({ rootDir: root, sc, admin, proposal: prop, outDir: OUT });
assert.equal(admin.calls.filter((c) => /name=hallucinated-wordmark-front/.test(c.p)).length, 1);   // the front wordmark is uploaded once, then cached
assert.equal(sc.products.length, 1); assert.equal(sc.prices.length, 4);
// the same design under ANY other proposal is refused (published once, ever); so is the same slug
await assert.rejects(publishDesign({ rootDir: root, sc, admin, proposal: { ...prop, proposal_id: "prop_t2", slug: "another-slug-tee" }, outDir: OUT }), /already on sale/);
await assert.rejects(publishDesign({ rootDir: root, sc, admin, proposal: { ...prop, proposal_id: "prop_t3", design_id: "9ab8a02eaec1" }, outDir: OUT }), /slug merge-conflict-tee is already used/);
assert.equal(sc.products.length, 1);
// request-shape helpers, directly
assert.deepEqual(mockupUrls("https://b/x.png", "back", "https://b/logo.png"), { main: `${STORE}/api/mockup?side=back&print=https%3A%2F%2Fb%2Fx.png`, front: `${STORE}/api/mockup?side=front&print=https%3A%2F%2Fb%2Flogo.png`, flat: `${STORE}/api/mockup?side=flat&print=https%3A%2F%2Fb%2Fx.png` });
assert.equal(productBody({ ...prop, title: "Ship it tee" }, { mockupUrl: "a", flatUrl: "b", placement: "back" }).name, "Ship it tee");
assert.equal(priceBody(prop, "prod_x", "XL").lookup_key, "merge-conflict-tee-xl");
assert.equal(dossierItem({ ...prop, sources: Array(9).fill(prop.sources[0]) }).trend.sources.length, 6);
// backfill: a product published before the two-sided rule gets the front image, metadata and feature, in place, once
sc.products.push({ id: "prod_old", active: true, name: "Old tee", images: ["https://hallucinated-store.vercel.app/api/mockup?side=back&print=x", "https://hallucinated-store.vercel.app/api/mockup?side=flat&print=x"],
  marketing_features: [{ name: "Black tee" }, { name: "Back: old joke" }], metadata: { slug: "old-tee", origin: "agents", placement: "back", design_id: "aaaaaaaaaaaa" } });
const bf = await backfillFront({ sc, admin, rootDir: root, slug: "old-tee" });
const old = sc.products.find((x) => x.id === "prod_old");
assert.equal(bf.products[0].front_added, true); assert.equal(old.images.length, 3);
assert.match(old.images[1], /side=front&print=.*hallucinated-wordmark-front/); assert.match(old.images[0], /side=back/); assert.match(old.images[2], /side=flat/);
assert.equal(old.metadata.front, "wordmark"); assert.equal(old.metadata.slug, "old-tee");
assert.deepEqual(old.marketing_features.map((f) => f.name), ["Black tee", FRONT_FEATURE, "Back: old joke"]);
const bf2 = await backfillFront({ sc, admin, rootDir: root, slug: "old-tee" });
assert.equal(bf2.products[0].front_added, false); assert.equal(old.images.length, 3); assert.equal(old.marketing_features.length, 3);   // idempotent
const dry = await backfillFront({ sc, admin, rootDir: root, slug: "merge-conflict-tee", dry: true });
assert.equal(dry.products[0].front_added, false);   // published with the front already
console.log("publish (stubbed Stripe + store, two-sided, backfill): OK");

// ---- announce once
l = loadProposals(root);
l.proposals.prop_t1 = { ...prop, state: "published", publish: pub }; saveProposals(root, l);
assert.match(announceCheck(root, "test", "merge-conflict-tee", `new tee ${pub.url}`).why, /sandbox/);                         // sandbox designs: never announced
process.env.DESIGNS_ANNOUNCE_TEST = "1";
assert.equal(announceCheck(root, "test", "merge-conflict-tee", "new shirt").ok, false);                                    // must carry its URL
assert.equal(announceCheck(root, "live", "merge-conflict-tee", `x ${pub.url}`).ok, false);                                  // sandbox design never announced live
const a = announceCheck(root, "test", "merge-conflict-tee", `new tee ${pub.url}`); assert.equal(a.ok, true);
markAnnounced(root, a.proposal_id, "123");
assert.match(announceCheck(root, "test", "merge-conflict-tee", `again ${pub.url}`).why, /already announced/);
console.log("announce once: OK");
console.log("designs tests: all OK (temp root " + root + ")");
