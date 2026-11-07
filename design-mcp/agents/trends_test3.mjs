// X search, take 3: fresh ids from socialData (platform "x") AND from the general data catalog; run the first one that resolves.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@usenaive-sdk/vetta";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(path.join(ROOT, "naive.log"), l + "\n"); };
const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: (env.match(/VETTA_API_KEY\s*=\s*["']?([^\s"']+)/) || [])[1] });
log("== trends test 3 (X search)");
const cands = [];
for (const [cat, q, opt] of [["socialData", "search tweets", { platform: "x" }], ["socialData", "trending topics", { platform: "x" }], ["data", "twitter search tweets", {}], ["data", "x trending topics", {}]]) {
  const r = await v[cat].searchTools({ query: q, limit: 5, ...opt }).catch((e) => ({ err: `${e?.status ?? ""} ${e.message}` }));
  if (r.err) { log(`${cat} "${q}": ERR ${r.err}`); continue; }
  for (const t of r.data || []) cands.push({ cat, id: t.id, name: t.name || t.title, price: t.price?.text });
  log(`${cat} "${q}": ${(r.data || []).map((t) => `${t.name || t.title} (${t.price?.text})`).join(" | ").slice(0, 600)}`);
}
let done = 0;
for (const c of cands.filter((c) => /twitter|tweet|\bx\b/i.test(c.name || "") && /search|trend/i.test(c.name || ""))) {
  if (done >= 2) break;
  const d = await v[c.cat].getTool(c.id).catch((e) => ({ err: `${e?.status ?? ""} ${e.message}` }));
  if (d.err) { log(`${c.cat} ${c.name}: getTool ${d.err}`); continue; }
  const where = d.input?.query ? "query" : d.input?.body ? "body" : "query";
  const props = d.input?.[where]?.properties || {};
  const args = {};
  for (const k of Object.keys(props)) if (/^(keyword|query|q|search|term)$/i.test(k)) args[k] = "AI agents";
  for (const r of d.input?.[where]?.required || []) if (!(r in args)) args[r] = props[r]?.examples?.[0] ?? props[r]?.default ?? "AI agents";
  log(`${c.cat} ${c.name} ${d.price?.text}: args ${JSON.stringify(args)} (inputs: ${Object.keys(props).join(", ")})`);
  if ((d.price?.micro_usd ?? 0) > 100_000) { log("  skipped: over $0.10"); continue; }
  try {
    const r = await v[c.cat].run({ tool_id: c.id, [where]: args });
    const s = JSON.stringify(r.data ?? r.result ?? r);
    const texts = [...s.matchAll(/"(?:full_text|text|name|trend|query)":"([^"]{8,200})"/g)].slice(0, 8).map((m) => m[1]);
    log(`  status=${r.status} ${s.length} bytes; samples: ${texts.join(" || ").slice(0, 900)}`);
    done++;
  } catch (e) { log(`  run ERR ${e?.status ?? ""} ${e.message}`); }
}
log("== trends test 3 done");
process.exit(0);
