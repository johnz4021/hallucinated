// LinkedIn for the Growth agent: posts to JOHN'S OWN profile through the official, self-serve API
// ("Share on LinkedIn" product, scope w_member_social; company pages would need LinkedIn's review).
// Token from linkedin/login.mjs in <root>/.linkedin-token.json (60 days, never logged). Client id/secret in .env.
import fs from "node:fs";
import path from "node:path";

export const LI_VERSION = process.env.LINKEDIN_VERSION || "202608";
export const tokenFile = (root) => path.join(root, ".linkedin-token.json");
export function loadToken(root) {
  try { const t = JSON.parse(fs.readFileSync(tokenFile(root), "utf8")); return Date.now() < t.expires_at ? t : null; } catch { return null; }
}

// LinkedIn's "little text" format: these characters must be escaped or the post is cut off / misparsed.
export const escapeLittle = (s) => String(s).replace(/[\\|{}@\[\]()<>#*_~]/g, (c) => "\\" + c);

async function li(t, method, url, body, extra = {}) {
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${t.access_token}`, "LinkedIn-Version": LI_VERSION, "X-Restli-Protocol-Version": "2.0.0",
    ...(body ? { "Content-Type": "application/json" } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60_000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`LinkedIn ${method} ${url.replace("https://api.linkedin.com", "")} ${r.status}: ${text.slice(0, 300)}`);
  return { r, json: text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null };
}

export async function uploadImage(t, file) {
  const { json } = await li(t, "POST", "https://api.linkedin.com/rest/images?action=initializeUpload", { initializeUploadRequest: { owner: t.person_urn } });
  const { uploadUrl, image } = json.value;
  const put = await fetch(uploadUrl, { method: "PUT", headers: { Authorization: `Bearer ${t.access_token}` }, body: fs.readFileSync(file), signal: AbortSignal.timeout(120_000) });
  if (!put.ok) throw new Error(`LinkedIn image upload ${put.status}: ${(await put.text()).slice(0, 200)}`);
  return image;   // urn:li:image:...
}

// Pure: little-text commentary with @mentions. The text is escaped; mention tokens @[Name](urn:li:organization:ID) are not.
// "@Name" in the text becomes a mention where we have its urn (else the plain name); mentions not in the text are thanked
// at the end. mentions: [{ name, urn|null }]
export function buildCommentary(text, mentions = []) {
  const tok = (m) => (m.urn ? `@[${m.name.replace(/[\]\\]/g, "")}](${m.urn})` : escapeLittle(m.name));
  let out = escapeLittle(text);
  const missing = [];
  for (const m of mentions) {
    const esc = escapeLittle("@" + m.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(esc, "i");
    if (re.test(out)) out = out.replace(re, tok(m)); else missing.push(m);
  }
  if (missing.length) out += `\n\n${escapeLittle("Thanks to")} ${missing.map(tok).join(", ")}`;
  return out;
}
// Pure: the /rest/posts body (single image -> content.media; 2+ -> content.multiImage)
export function postBody(t, { commentary, images = [] }) {
  return { author: t.person_urn, commentary, visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false,
    ...(images.length === 1 ? { content: { media: { id: images[0].urn, altText: images[0].alt || "Hallucinated tee" } } }
      : images.length > 1 ? { content: { multiImage: { images: images.map((i) => ({ id: i.urn, altText: i.alt || "Hallucinated tee" })) } } } : {}) };
}

export async function createPost(t, { text, imageUrn, altText, commentary, images }) {
  const body = commentary || images ? postBody(t, { commentary: commentary ?? escapeLittle(text), images: images || (imageUrn ? [{ urn: imageUrn, alt: altText }] : []) })
    : { author: t.person_urn, commentary: escapeLittle(text), visibility: "PUBLIC",
    distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: "PUBLISHED", isReshareDisabledByAuthor: false,
    ...(imageUrn ? { content: { media: { id: imageUrn, altText: altText || "Hallucinated tee" } } } : {}) };
  const { r } = await li(t, "POST", "https://api.linkedin.com/rest/posts", body);
  const id = r.headers.get("x-restli-id") || r.headers.get("x-linkedin-id");
  return { id, url: id ? `https://www.linkedin.com/feed/update/${id}/` : null };
}

// Organization urn by vanity name through the API (needs an org-read scope; with w_member_social only it is usually 403 -> null)
export async function orgByVanity(t, vanity) {
  try {
    const { json } = await li(t, "GET", `https://api.linkedin.com/rest/organizations?q=vanityName&vanityName=${encodeURIComponent(vanity)}`);
    const el = (json?.elements || [])[0];
    return el?.id ? { urn: `urn:li:organization:${el.id}`, name: el.localizedName || el.name?.localized?.en_US || null } : null;
  } catch (e) { return { error: e.message.slice(0, 160) }; }
}
