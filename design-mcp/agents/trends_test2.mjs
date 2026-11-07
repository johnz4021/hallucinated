// Runs the actual X + Reddit tools from Naïve's socialData (each ~$0.001): X search "AI agents", X trending, Reddit search.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@usenaive-sdk/vetta";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(path.join(ROOT, "naive.log"), l + "\n"); };
const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: (env.match(/VETTA_API_KEY\s*=\s*["']?([^\s"']+)/) || [])[1] });
const found = JSON.parse(fs.readFileSync(path.join(ROOT, "trends-test.json"), "utf8"));
const all = Object.values(found.searches).flat();
const byName = (n) => all.find((t) => t.name === n)?.id;
const runs = [
  ["X search", "/api/v1/twitter/web/fetch_search_timeline", { keyword: "AI agents", query: "AI agents", search_type: "Top" }],
  ["X trending", "/api/v1/twitter/web/fetch_trending", { country: "UnitedStates" }],
  ["Reddit search", "/api/v1/reddit/app/fetch_dynamic_search", { query: "AI agents", keyword: "AI agents" }],
];
const out = {};
log("== trends test 2 (X + Reddit via Naïve socialData)");
for (const [label, name, guess] of runs) {
  const id = byName(name);
  if (!id) { log(`${label}: tool not found`); continue; }
  const d = await v.socialData.getTool(id).catch((e) => ({ err: e.message }));
  const where = d.input?.query ? "query" : "body";
  const props = d.input?.[where]?.properties || {};
  const args = Object.fromEntries(Object.entries(guess).filter(([k]) => k in props));
  for (const r of d.input?.[where]?.required || []) if (!(r in args)) args[r] = props[r]?.examples?.[0] ?? props[r]?.default ?? "AI agents";
  log(`${label}: ${name} ${d.price?.text} args ${JSON.stringify(args)} (inputs: ${Object.keys(props).join(", ")})`);
  try {
    const r = await v.socialData.run({ tool_id: id, [where]: args });
    out[label] = r;
    const s = JSON.stringify(r.data ?? r.result ?? r);
    const texts = [...s.matchAll(/"(?:full_text|text|title|name|trend_name)":"([^"]{12,200})"/g)].slice(0, 6).map((m) => m[1]);
    log(`${label}: status=${r.status} ${s.length} bytes; samples: ${texts.join(" || ").slice(0, 900)}`);
  } catch (e) { log(`${label}: ERR ${e?.status ?? ""} ${e.message}`); }
}
fs.writeFileSync(path.join(ROOT, "trends-test2.json"), JSON.stringify(out, null, 2).slice(0, 3_000_000));
log("== trends test 2 done");
process.exit(0);
