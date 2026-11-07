process.on('unhandledRejection', e => { console.error(e); });
// X posting test (John approved): 1) a text-only post, 2) the drop video re-encoded to X's limits (1080x1350, 30 fps).
// Shows exactly which one X refuses. Reads VETTA_API_KEY from ../.env (never printed). Output -> naive.log
import { createClient } from "@usenaive-sdk/vetta";
import fs from "node:fs";
import path from "node:path";
const ROOT = path.resolve(process.cwd(), "..");
const LOG = path.join(ROOT, "naive.log");
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(LOG, l + "\n"); };
const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
const c = createClient({ baseUrl: "https://api.vetta.sh", apiKey: (env.match(/VETTA_API_KEY\s*=\s*["']?([^\s"']+)/) || [])[1] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const identity = ((await c.identities.list({ limit: 50 })).data || []).find((i) => /hallucinated/i.test(i.name));
log("== X post test on " + identity.id);

async function postAndWatch(label, body) {
  let p;
  try { p = await c.social.createPost(identity.id, body); }
  catch (e) { log(`${label}: createPost ERR ${e?.status ?? ""} ${e?.code ?? ""} ${e.message}`); return null; }
  log(`${label}: created ${p.id} status=${p.status}`);
  for (let i = 0; i < 16; i++) {
    await sleep(8000);
    const list = await c.social.listPosts({ identity_id: identity.id, limit: 10, reconcile: true }).catch(() => ({ data: [] }));
    const q = (list.data || []).find((x) => x.id === p.id);
    if (q && ["posted", "failed"].includes(q.status)) { log(`${label}: ${q.status.toUpperCase()} url=${q.url} error=${q.error}`); return q; }
  }
  log(`${label}: still not final after ~2 min`); return null;
}

// 1) text only
const t = await postAndWatch("TEXT", { content: "the company is run by agents. the shirts are real. drop #1 soon.", platforms: ["x"] });

// 2) the same video, re-encoded to X's limits
const file = path.join(ROOT, "e2e", "x-ready-pwma3s5.mp4");
if (fs.existsSync(file)) {
  try {
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(file)], { type: "video/mp4" }), "hallucinated-drop1-1080x1350.mp4");
    const f = await c.files.upload(form);
    log(`uploaded ${f.id} (${f.kind}, ${f.size_bytes ?? "?"} bytes)`);
    await postAndWatch("VIDEO", { content: "black tee. first drop. the fog is a feature, not a bug.", platforms: ["x"], file_ids: [f.id], ai_generated: true });
  } catch (e) { log(`VIDEO: upload ERR ${e?.status ?? ""} ${e.message}`); }
} else log("VIDEO: e2e/x-ready-pwma3s5.mp4 not found");
log("== X post test done (check https://x.com/hallucinateddpt)");
