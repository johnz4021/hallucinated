// Generates campaign banners, lookbook shots and pre-order product shots with the OpenAI image API.
// Hard budget cap (estimated from returned token usage at gpt-image-1 list prices, an upper bound).
// Usage: node scripts/gen-imagery.mjs [id,id,...]   (default: all) -> test-output/imagery/<id>.png + log.jsonl
import { readFileSync, writeFileSync, appendFileSync, existsSync } from "node:fs";
import path from "node:path";
import { envVar, ROOT, STOREFRONT } from "./root-env.mjs";

const KEY = envVar("OPENAI_API_KEY");
if (!KEY) { console.error("OPENAI_API_KEY missing"); process.exit(2); }
const OUT = path.join(STOREFRONT, "test-output/imagery");
const LOG = path.join(OUT, "log.jsonl");
const BUDGET = Number(process.env.IMAGE_BUDGET_USD ?? 4.75);
const MODELS = (process.env.IMAGE_MODELS ?? "gpt-image-1.5,gpt-image-1").split(",");
const RATE = { text_in: 5e-6, image_in: 10e-6, image_out: 40e-6 }; // USD per token, gpt-image-1 list (upper bound)

const ref = {
  front: path.join(STOREFRONT, "test-output/refs/tee-front.png"),
  back: path.join(STOREFRONT, "test-output/refs/tee-back.png"),
  print: path.join(ROOT, "design-test/bc1dbe9d9aae.png"),
  logoBoneSand: path.join(ROOT, "brand/hallucinated-logo-bone-on-forest-sand-large-11in-300dpi.png"),
  logoBlackTee: path.join(ROOT, "brand/hallucinated-logo-black-tee-chest-4in-300dpi.png"),
  logoForest: path.join(ROOT, "brand/hallucinated-logo-forest-on-bone-sand-large-11in-300dpi.png"),
  logoLight: path.join(ROOT, "brand/hallucinated-logo-light-tee-large-11in-300dpi.png"),
};

const SAFE = "The model is a fictional adult, not any real person or celebrity, with no resemblance to anyone famous. No other logos, brand names, readable signs, license plates or text anywhere in the image except the shirt print. Editorial streetwear lookbook photo, natural light, 35mm film look, soft grain, muted natural palette of forest green, bone, sand and eucalyptus. Photorealistic.";
const FRONT = "The model wears the exact black t-shirt from the first reference image: across the chest, the lowercase word 'hallucinated' in a heavy rounded sans-serif, off-white, with an offset sage-green ghost copy behind it. Reproduce that chest print faithfully: same word, same spelling, same style, same size relative to the chest, nothing else printed on the front.";
const BACK = "The model wears the exact black t-shirt from the first reference image, seen from behind: the back print is the terminal text '> git reset --hard' in off-white monospace, above an off-white line-art street map of San Francisco with one small sage-green pin. Reproduce that back print faithfully: same text exactly, same layout, same map style, centered between the shoulder blades, nothing else printed.";
const PRODUCT = "Studio product photograph on a seamless warm sand-colored paper backdrop, soft even light, gentle natural shadow. No person, no mannequin visible, no tags, no other text or logos besides our wordmark. Photorealistic, clean e-commerce catalog style.";

const JOBS = [
  { id: "banner-fog", size: "1536x1024", quality: "high", refs: [ref.back, ref.print], prompt: `Wide landscape campaign photo. ${BACK} The model stands with their back to the camera on a steep residential hillside street in San Francisco on a foggy morning, pastel row houses and a soft fog bank behind, the print sharp and well lit. The person is on the right third of the frame; the left side is calm fog and sky for headline text. ${SAFE}` },
  { id: "banner-steps", size: "1536x1024", quality: "high", refs: [ref.front, ref.logoBlackTee], prompt: `Wide landscape campaign photo. ${FRONT} The model sits on weathered concrete steps outside a plain warehouse door in the Dogpatch-style industrial part of a city, early warm light, relaxed posture, forearms on knees, looking slightly off camera. The model is on the right half; the left half is a clean concrete wall for headline text. ${SAFE}` },
  { id: "banner-flatlay", size: "1536x1024", quality: "high", refs: [ref.back, ref.print], prompt: `Wide landscape top-down flat lay. The exact black t-shirt from the first reference image lies flat, back side up, on bone-colored concrete, the back print ('> git reset --hard' above a line-art street map) sharp and faithful to the reference, exact text, nothing else printed. Next to it: a closed plain silver laptop with no logo, a plain paper coffee cup with no print, a ring of keys, a folded paper city map. The shirt sits on the right two thirds; the left third is empty concrete. Soft daylight, gentle shadows, photorealistic, no other text or logos.` },
  { id: "lb-back-street", size: "1024x1536", quality: "high", refs: [ref.back, ref.print], prompt: `Full-length portrait. ${BACK} The model walks away from the camera down the middle of a quiet, steep San Francisco street lined with bay-window houses, light fog, overcast soft light, dark trousers and white sneakers with no logos. ${SAFE}` },
  { id: "lb-front-wall", size: "1024x1536", quality: "high", refs: [ref.front, ref.logoBlackTee], prompt: `Three-quarter-length portrait. ${FRONT} The model leans against a sun-washed pale stucco wall, hands in pockets, calm unbothered expression, late afternoon sun with crisp shadows. ${SAFE}` },
  { id: "lb-back-detail", size: "1024x1536", quality: "high", refs: [ref.back, ref.print], prompt: `Close-up portrait crop from behind, shoulders to waist. ${BACK} The print fills the frame and is crisp and legible, you can see the cotton texture. Out-of-focus green park trees behind. ${SAFE}` },
  { id: "lb-front-rooftop", size: "1024x1536", quality: "high", refs: [ref.front, ref.logoBlackTee], prompt: `Seated portrait. ${FRONT} The model sits on a rooftop ledge with a hazy city skyline far behind (generic, no recognizable landmarks), golden hour, a closed plain notebook beside them, looking at the camera with a dry half-smile. ${SAFE}` },
  { id: "lb-back-bus", size: "1024x1536", quality: "high", refs: [ref.back, ref.print], prompt: `Portrait from behind, waist up. ${BACK} The model waits at a plain bus shelter with no signage or ads, holding a takeaway coffee in a plain cup, morning light, fog in the distance. ${SAFE}` },
  { id: "lb-front-laptop", size: "1024x1536", quality: "high", refs: [ref.front, ref.logoBlackTee], prompt: `Portrait, waist up. ${FRONT} The model stands in a sparse sunlit loft office, holding a closed plain silver laptop with no logo under one arm, shrugging slightly as if a deploy just went wrong and they are fine with it. ${SAFE}` },
  { id: "lb-front-woman", size: "1024x1536", quality: "high", refs: [ref.front, ref.logoBlackTee], prompt: `Three-quarter-length portrait of a fictional woman in her late twenties with short dark hair. ${FRONT} She stands on a quiet sunlit sidewalk in front of a pale painted wooden house, tee slightly oversized and tucked loosely into wide light-gray trousers, holding a plain ceramic mug, dry unimpressed expression. ${SAFE}` },
  { id: "pre-hoodie", size: "1024x1024", quality: "medium", refs: [ref.logoBoneSand], prompt: `${PRODUCT} A heavyweight pullover hoodie in deep forest green (#2F3B2A), laid out neatly with the hood up behind, front facing. Across the chest, the wordmark from the reference image exactly: lowercase 'hallucinated' in a heavy rounded sans-serif, off-white with an offset sand-colored ghost copy, faithful spelling and style.` },
  { id: "pre-cap", size: "1024x1024", quality: "medium", refs: [ref.logoBlackTee], prompt: `${PRODUCT} A black six-panel unstructured cotton dad cap, three-quarter front view. On the front panel, the wordmark from the reference image as a small flat embroidery: lowercase 'hallucinated' in a heavy rounded sans-serif, off-white thread with an offset sage-green ghost copy, faithful spelling; the dot on the i is a plain round dot.` },
  { id: "pre-tote", size: "1024x1024", quality: "medium", refs: [ref.logoForest], prompt: `${PRODUCT} A heavy natural bone-colored canvas tote bag standing upright, front facing. Printed in the center, the wordmark from the reference image exactly: lowercase 'hallucinated' in a heavy rounded sans-serif, dark forest green with an offset sand ghost copy, faithful spelling.` },
  { id: "pre-bone-tee", size: "1024x1024", quality: "medium", refs: [ref.logoLight], prompt: `${PRODUCT} An off-white bone-colored (#F2EEE6) cotton t-shirt laid flat, front facing, neatly folded sleeves. Across the chest, the wordmark from the reference image exactly: lowercase 'hallucinated' in a heavy rounded sans-serif, near-black with an offset sage-green ghost copy, faithful spelling, about half the chest width.` },
];

function spent() {
  if (!existsSync(LOG)) return { usd: 0, calls: 0 };
  return readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
    .reduce((a, l) => ({ usd: a.usd + (l.est_usd || 0), calls: a.calls + 1 }), { usd: 0, calls: 0 });
}

async function run(job) {
  for (const model of MODELS) {
    const form = new FormData();
    Object.entries({ model, prompt: job.prompt, size: job.size, quality: job.quality, n: 1, output_format: "png", input_fidelity: "high" })
      .forEach(([k, v]) => form.append(k, String(v)));
    for (const f of job.refs) form.append("image[]", new Blob([readFileSync(f)], { type: "image/png" }), path.basename(f));
    const r = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${KEY}` }, body: form });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = j?.error?.message ?? r.status;
      appendFileSync(LOG, JSON.stringify({ id: job.id, model, ok: false, error: String(msg).slice(0, 200), est_usd: 0, at: new Date().toISOString() }) + "\n");
      if (/model|not found|does not exist|invalid_value/i.test(String(msg))) continue;
      throw new Error(`${job.id}: ${msg}`);
    }
    const u = j.usage ?? {};
    const tin = u.input_tokens_details?.text_tokens ?? 0, iin = u.input_tokens_details?.image_tokens ?? 0, out = u.output_tokens ?? 0;
    const est = tin * RATE.text_in + iin * RATE.image_in + out * RATE.image_out;
    writeFileSync(path.join(OUT, `${job.id}.png`), Buffer.from(j.data[0].b64_json, "base64"));
    appendFileSync(LOG, JSON.stringify({ id: job.id, model, ok: true, size: job.size, quality: job.quality, usage: { text_in: tin, image_in: iin, out }, est_usd: +est.toFixed(4), at: new Date().toISOString() }) + "\n");
    return { id: job.id, model, est };
  }
  throw new Error(`${job.id}: no model accepted the request`);
}

const only = process.argv[2]?.split(",");
const queue = JOBS.filter((j) => !only || only.includes(j.id));
const PER_CALL_CEILING = 0.4;
let inflight = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (queue.length) {
    const s = spent();
    if (s.usd + (inflight + 1) * PER_CALL_CEILING > BUDGET) { console.log(`budget stop at est $${s.usd.toFixed(2)}`); return; }
    const job = queue.shift();
    inflight++;
    try { const r = await run(job); console.log(`ok ${r.id} (${r.model}) ~$${r.est.toFixed(3)}`); }
    catch (e) { console.log(`FAIL ${e.message}`); }
    finally { inflight--; }
  }
}));
const s = spent();
console.log(`total calls logged: ${s.calls}, est spend $${s.usd.toFixed(2)} (cap $${BUDGET})`);
