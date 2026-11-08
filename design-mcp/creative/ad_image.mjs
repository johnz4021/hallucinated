// Photoreal ad images via OpenAI images/EDITS (gpt-image, input_fidelity high), fed the REAL print file (on a black card)
// plus the store mockup(s) as input images, the same approach as designs/launch.mjs (whose helpers are not exported, so
// this is a small copy of its pattern). Naïve generate_image stays as the fallback only. Lead, Sat 18:35: the first live
// photoreal run failed review on misspelled prints, missing print details and stray text (buses, murals, whiteboards).
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

export const AD_IMAGE_MODELS = () => (process.env.ADS_IMAGE_MODELS || "gpt-image-2,gpt-image-1.5,gpt-image-1").split(",");
const QUALITY = () => process.env.ADS_IMAGE_QUALITY || "high";
// appended in code to every ad image prompt
export const SCENE_NO_TEXT = "No readable text anywhere except the shirt print: blank walls, screens blank or turned away, no signs, posters, murals, buses, packaging or labels; the background softly out of focus. All props unbranded and generic (plain cups, no logos on laptops, phones, bags or cars). Fictional people only.";

// The reference images for one product: the print on a black card (if we have the print), then its mockups. Local PNG paths.
export async function adRefFiles(rootDir, product, { printPath = null, fetchImpl = fetch } = {}) {
  const dir = path.join(rootDir, "design-test", "ad-refs"); fs.mkdirSync(dir, { recursive: true });
  const out = [];
  const card = path.join(dir, `${product.slug}-print-card.png`);
  if (!fs.existsSync(card)) {
    let print = printPath && fs.existsSync(printPath) ? fs.readFileSync(printPath) : null;
    if (!print && product.print_url) { const r = await fetchImpl(product.print_url, { signal: AbortSignal.timeout(40_000) }); if (r.ok) print = Buffer.from(await r.arrayBuffer()); }
    if (print) {
      const art = await sharp(print).resize(900, 900, { fit: "inside", withoutEnlargement: false }).png().toBuffer();
      await sharp({ create: { width: 1024, height: 1024, channels: 4, background: "#1A1A1A" } }).composite([{ input: art, gravity: "center" }]).png().toFile(card);
    }
  }
  if (fs.existsSync(card)) out.push(card);
  for (const [i, u] of (product.images || [product.image]).filter(Boolean).slice(0, 2).entries()) {
    const f = path.join(dir, `${product.slug}-mockup-${i}.png`);
    if (!fs.existsSync(f)) {
      const r = await fetchImpl(u, { signal: AbortSignal.timeout(40_000) });
      if (!r.ok) continue;
      fs.writeFileSync(f, await sharp(Buffer.from(await r.arrayBuffer())).png().toBuffer());
    }
    out.push(f);
  }
  return out;
}

// Pure: the full prompt sent to the image model
export function adImagePrompt({ product, scenario, photoStyle, prompt }) {
  return [
    `A PHOTOREALISTIC photograph (${photoStyle}). ${prompt}`,
    `Scenario: ${scenario}.`,
    `A fictional person WEARS the ${product.garment || "garment"} "${product.name}" shown in the reference images: the garment is the clear centre and focus of the frame.`,
    `The garment's print must be EXACTLY the artwork in the first reference image (every line, symbol and letter, spelled exactly, legible, same proportions and colours), placed as in the mockups. Do not invent, drop or change any part of the print.`,
    SCENE_NO_TEXT,
  ].join("\n");
}

async function openaiEdit(key, model, prompt, files, withFidelity = true) {
  const form = new FormData();
  for (const [k, v] of Object.entries({ model, prompt, size: "1024x1536", quality: QUALITY(), n: 1, ...(withFidelity ? { input_fidelity: "high" } : {}) })) form.append(k, String(v));
  for (const f of files) form.append("image[]", new Blob([fs.readFileSync(f)], { type: "image/png" }), path.basename(f));
  const r = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(300_000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 400 && withFidelity && /fidelity/i.test(j?.error?.message || "")) return openaiEdit(key, model, prompt, files, false);
    const e = new Error(j?.error?.message || `HTTP ${r.status}`); e.status = r.status; throw e;
  }
  return j;
}
// -> { jpg (Buffer), model }
export async function generateAdImage(openaiKey, prompt, files) {
  let last;
  for (const model of AD_IMAGE_MODELS()) {
    try {
      const j = await openaiEdit(openaiKey, model, prompt, files);
      const raw = Buffer.from(j.data[0].b64_json, "base64");
      return { jpg: await sharp(raw).jpeg({ quality: 88, mozjpeg: true }).toBuffer(), model };
    } catch (e) { last = e; if (![400, 403, 404].includes(e.status) || /safety|moderation/i.test(e.message)) throw e; }
  }
  throw last;
}
