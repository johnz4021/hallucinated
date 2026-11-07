// Proves Naïve's built-in socialData for trend/sentiment research: lists matching tools with prices, then runs ONE cheap
// search (a few cents at most; refuses anything over $0.10). Output -> naive.log and design-mcp/../trends-test.json
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@usenaive-sdk/vetta";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(path.join(ROOT, "naive.log"), l + "\n"); };
const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: (env.match(/VETTA_API_KEY\s*=\s*["']?([^\s"']+)/) || [])[1] });
const out = { searches: {} };
log("== trends test (Naïve socialData)");
for (const q of ["x search posts", "twitter trends", "reddit search", "tiktok trending", "hacker news"]) {
  try {
    const r = await v.socialData.searchTools({ query: q, limit: 6 });
    out.searches[q] = (r.data || []).map((t) => ({ id: t.id, name: t.name || t.title, platform: t.platform, price: t.price?.text ?? t.price }));
    log(`${q}: ${out.searches[q].map((t) => `${t.id} (${t.price})`).join(" | ") || "none"}`);
  } catch (e) { log(`${q}: ERR ${e?.status ?? ""} ${e.message}`); }
}
// run the cheapest X search we found
const xs = Object.values(out.searches).flat().filter((t) => /x|twitter/i.test(`${t.platform} ${t.id} ${t.name}`) && /search/i.test(`${t.id} ${t.name}`));
let pick = null;
for (const t of xs) {
  const d = await v.socialData.getTool(t.id).catch(() => null);
  if (d?.price?.micro_usd != null && d.price.micro_usd <= 100_000) { pick = d; break; }
}
if (!pick) log("no X search tool under $0.10 found; see the list above (Monid is the fallback)");
else {
  out.picked = { id: pick.id, price: pick.price, input: pick.input, notes: pick.notes };
  log(`running ${pick.id} (${pick.price?.text}); inputs: ${JSON.stringify(pick.input).slice(0, 300)}`);
  const qk = Object.keys(pick.input?.query || pick.input?.body || {}).find((k) => /^(q|query|keyword|search|term)/i.test(k)) || "query";
  const where = pick.input?.body && !pick.input?.query ? "body" : "query";
  const lim = Object.keys(pick.input?.[where] || {}).find((k) => /limit|count|max/i.test(k));
  const args = { [qk]: "AI agents", ...(lim ? { [lim]: 5 } : {}) };
  try {
    const r = await v.socialData.run({ tool_id: pick.id, [where]: args });
    out.run = r;
    log(`result: status=${r.status} ${JSON.stringify(r.data ?? r.result ?? r).slice(0, 1200)}`);
  } catch (e) { log(`run ERR ${e?.status ?? ""} ${e.message}`); }
}
fs.writeFileSync(path.join(ROOT, "trends-test.json"), JSON.stringify(out, null, 2));
log("== trends test done (details in trends-test.json)");
process.exit(0);
