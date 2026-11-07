process.on('unhandledRejection', e => { console.error(e); });
// Fetch the finished Kling video job from the ad test into ../ad-test/. Never prints the key.
import { createClient } from "@usenaive-sdk/vetta";
import fs from "node:fs";
import path from "node:path";
const ROOT = path.resolve(process.cwd(), "..");
const OUT = path.join(ROOT, "ad-test");
const LOG = path.join(ROOT, "naive.log");
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(LOG, l + "\n"); };
const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
const apiKey = (env.match(/VETTA_API_KEY\s*=\s*["']?([^\s"']+)/) || [])[1];
const c = createClient({ baseUrl: "https://api.vetta.sh", apiKey });
const RUNS = [["med_axd237jhk4w547vjhzatvrgzcj", "ses_ted41d8bbfs4pt0kagyaak0677"], ["med_apcbef93zy1kpm7k1fr22zgfhq", "ses_h5xms6q5bqm8crcaeh7487qxgz"]];
log("== fetch video");
for (const [JOB, SESSION] of RUNS) {
for (let i = 0; i < 60; i++) {
  const j = await c.media.get(JOB).catch((e) => ({ status: "err " + e?.message }));
  log(`job ${JOB} ${j.status} ${JSON.stringify(j).slice(0, 300)}`);
  if (j.status === "completed" || j.status === "failed" || String(j.status).startsWith("err")) break;
  await new Promise((r) => setTimeout(r, 15000));
}
const f = await c.files.list({ session_id: SESSION, kind: "video", limit: 20 }).catch((e) => { log("files err " + e?.message); return { data: [] }; });
for (const v of f.data || []) {
  const bytes = await c.files.downloadBytes(v.id);
  const name = `video-${v.id}-${(v.source?.model || "model").replace(/[^a-z0-9.-]+/gi, "_")}.mp4`;
  fs.writeFileSync(path.join(OUT, name), bytes);
  log(`saved ad-test/${name} (${v.width}x${v.height}, ${v.duration_seconds}s)`);
}
if (!(f.data || []).length) log(`no video file found for ${SESSION}`);
}
log("== fetch video done");
