// generate_design: one call = GPT Image draws the whole graphic (text included) on a transparent background,
// light print prep (hard alpha edges, 3x upscale, 300 DPI), then a vision QA verdict.
// Brand rules live in brand.json and feed both the prompt and the checker.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BRAND = JSON.parse(fs.readFileSync(path.join(HERE, "brand.json"), "utf8"));
const IMAGE_MODELS = (process.env.IMAGE_MODELS || "gpt-image-2,gpt-image-1.5,gpt-image-1").split(",");
const VISION_MODELS = (process.env.VISION_MODELS || "gpt-5-mini,gpt-4.1-mini,gpt-4o-mini").split(",");
const PALETTE_TEXT = Object.entries(BRAND.palette).map(([k, v]) => `${k} ${v}`).join(", ");

async function openai(key, endpoint, body) {
  const r = await fetch(`https://api.openai.com/v1/${endpoint}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j?.error?.message || `HTTP ${r.status}`); e.status = r.status; throw e; }
  return j;
}
// GPT Image with reference images (images/edits). Retries without input_fidelity if a model rejects it.
async function openaiEdit(key, fields, files) {
  const send = async (withFidelity) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && (withFidelity || k !== "input_fidelity")) form.append(k, String(v));
    for (const f of files) form.append("image[]", new Blob([fs.readFileSync(f)], { type: "image/png" }), path.basename(f));
    const r = await fetch("https://api.openai.com/v1/images/edits", { method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j?.error?.message || `HTTP ${r.status}`); e.status = r.status; throw e; }
    return j;
  };
  try { return await send(true); }
  catch (e) { if (e.status === 400 && /fidelity/i.test(e.message)) return send(false); throw e; }
}

async function withFallback(models, fn) {
  let last;
  for (const m of models) {
    try { return { model: m, result: await fn(m) }; }
    catch (e) { last = e; if (![400, 403, 404].includes(e.status)) throw e; }
  }
  throw last;
}

export async function generateDesign(args, { openaiKey, outDir, baseUrl, log = () => {} }) {
  const { prompt, text = "", placement = "back" } = args;
  // References: always the logo when the brand name or the chest logo is in play; agent can add others.
  let refs = Array.isArray(args.references) ? [...args.references] : [];
  if (!refs.includes("logo") && (/hallucinated/i.test(text + " " + prompt) || placement === "front-chest")) refs.unshift("logo");
  refs = refs.filter((r) => BRAND.references?.[r] && fs.existsSync(path.join(HERE, BRAND.references[r].file)));
  const id = crypto.randomBytes(6).toString("hex");
  fs.mkdirSync(outDir, { recursive: true });

  // 1) GPT Image makes the full graphic
  const fullPrompt = [
    `Print-ready t-shirt graphic for the ${placement} of a ${BRAND.shirt}, isolated on a fully transparent background.`,
    `It prints on a BLACK shirt: every mark (text, shapes, lines) must be a LIGHT, solid, flat color (bone #F2EEE6 by default, eucalyptus #8A9A80 or sand #CBB894 for accents). Never black, dark grey or dark green: dark ink is invisible on the shirt. No box, panel or plate behind the text.`,
    ...BRAND.art_style.map((r) => `- ${r}`),
    `Colors limited to: ${PALETTE_TEXT}.`,
    text ? `The ONLY text in the image must read exactly: "${text}" (same spelling, case and punctuation). ${BRAND.typography}` : "No text at all.",
    `Never include: ${BRAND.banned.join("; ")}.`,
    ...refs.map((r, i) => `Reference image ${i + 1}: ${BRAND.references[r].use}`),
    `Design: ${prompt}`,
  ].join("\n");
  log(`[${id}] generating…`);
  const common = { prompt: fullPrompt, size: placement === "front-chest" ? "1024x1024" : "1024x1536",
    background: "transparent", output_format: "png", quality: process.env.IMAGE_QUALITY || "medium", n: 1 };
  const gen = await withFallback(IMAGE_MODELS, (model) => refs.length
    ? openaiEdit(openaiKey, { model, ...common, input_fidelity: "high" }, refs.map((r) => path.join(HERE, BRAND.references[r].file)))
    : openai(openaiKey, "images/generations", { model, ...common }));
  const raw = Buffer.from(gen.result.data[0].b64_json, "base64");

  // 2) Print prep only: hard alpha edges (no halos on black), 3x upscale, 300 DPI
  const { data, info } = await sharp(raw).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let clear = 0;
  // Knock out near-black: on a black tee it is invisible and would only print as stray ink (and it is how
  // leftover dark boxes sneak in). Dark text the model draws by mistake then shows up as missing, and QA fails it.
  let knocked = 0;
  for (let i = 3; i < data.length; i += 4) {
    data[i] = data[i] >= 128 ? 255 : 0;
    if (data[i] && Math.max(data[i - 3], data[i - 2], data[i - 1]) < 48) { data[i] = 0; knocked++; }
    if (!data[i]) clear++;
  }
  const hard = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  const printPath = path.join(outDir, `${id}.png`);
  // Trim the print file to the visible artwork: the printer sizes (and prices) the whole canvas, so empty
  // transparent margins would make an 11 in wide text block bill as an 11 x 16.5 in print and sit in the wrong place.
  let trimmed = await sharp(hard).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 }).png().toBuffer({ resolveWithObject: true }).catch(() => null);
  if (!trimmed || trimmed.info.width < 8 || trimmed.info.height < 8) trimmed = { data: hard, info: { width: info.width, height: info.height } };
  const pw = trimmed.info.width * 3, ph = trimmed.info.height * 3;
  await sharp(trimmed.data).resize(pw, ph, { kernel: "lanczos3" }).png().withMetadata({ density: 300 }).toFile(printPath);
  const transparentPct = Math.round((clear / (info.width * info.height)) * 100);

  // 3) Vision QA on a black-tee preview
  const preview = await sharp({ create: { width: info.width, height: info.height, channels: 4, background: "#1A1A1A" } })
    .composite([{ input: hard }]).png().toBuffer().then((b) => sharp(b).resize(768).png().toBuffer());
  fs.writeFileSync(path.join(outDir, `${id}-preview.png`), preview);
  const issues = [];
  if (transparentPct > 99) issues.push("almost nothing is visible on the black shirt: the artwork was drawn in black/dark colors; redraw every element in bone #F2EEE6 (light, solid)");
  if (transparentPct < 15) issues.push(`background is not transparent (only ${transparentPct}% clear): remove any background box or fill`);
  let vision = { pass: true, issues: [], text_seen: "" }, visionModel = null;
  try {
    const v = await withFallback(VISION_MODELS, (model) => openai(openaiKey, "chat/completions", {
      model, response_format: { type: "json_object" },
      messages: [{ role: "user", content: [
        { type: "text", text:
`You are a strict print QA checker for ${BRAND.name}, a streetwear brand. This is a t-shirt ${placement} graphic shown on a ${BRAND.shirt}.
Required text: ${text ? `"${text}" — must be spelled EXACTLY, with no extra, missing or garbled characters` : "none — there must be no text"}.
Brand palette: ${PALETTE_TEXT}. Typography rule: ${BRAND.typography}
Fail it if any of these is not true:
${BRAND.qa_checks.map((c, i) => `${i + 1}. ${c}`).join("\n")}
How to read this image: WE composited the artwork onto a flat ${BRAND.shirt.replace(/.*\((#[0-9A-Fa-f]+)\).*/, "$1")} fill that stands in for the shirt. That flat fill filling the whole frame is NOT a background box, frame or mockup — never flag it. Only flag a box/frame/mockup if you see a distinct shape inside the image (a rectangle of another shade, a visible edge or border, a drawn shirt).
Be strict but fair: fail only for definite problems you can see, never for minor shade differences (white vs bone is fine), taste, or things you would merely like to "confirm". Each issue must be a short, specific fix the designer can put in the next prompt.
Reply JSON only: {"pass": true|false, "issues": ["..."], "text_seen": "exact text you can read", "notes": "one line on what works"}` },
        { type: "image_url", image_url: { url: `data:image/png;base64,${preview.toString("base64")}` } },
      ] }],
    }));
    visionModel = v.model;
    vision = JSON.parse(v.result.choices[0].message.content);
  } catch (e) { issues.push(`vision check unavailable: ${e.message}`); }

  const allIssues = [...issues, ...(vision.issues || [])];
  const result = {
    id,
    pass: Boolean(vision.pass) && issues.length === 0,
    issues: allIssues,
    text_seen: vision.text_seen || "",
    notes: vision.notes || "",
    print_file_url: `${baseUrl}/files/${id}.png`,
    preview_url: `${baseUrl}/files/${id}-preview.png`,
    print_size: `${pw}x${ph}px @300dpi, trimmed to the artwork (aspect ${(ph / pw).toFixed(2)} h/w)`,
    transparent_pct: transparentPct,
    references_used: refs,
    image_model: gen.model,
    vision_model: visionModel,
  };
  fs.writeFileSync(path.join(outDir, `${id}.json`), JSON.stringify({ args, ...result }, null, 2));
  log(`[${id}] ${result.pass ? "PASS" : "FAIL"} ${allIssues.join(" | ")}`);
  return result;
}
