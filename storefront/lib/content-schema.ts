// Shape of content.json on Vercel Blob. Shared by the site and the admin API. See CONTENT.md.
export type Banner = {
  id: string;
  title: string;
  subtitle?: string;
  image: string;
  image_alt: string;
  cta_label?: string;
  cta_href?: string;
  /** Where the subject sits, so text goes on the other side. */
  focus?: "left" | "right" | "center";
  active?: boolean;
  sort?: number;
};
export type LookbookEntry = {
  id: string;
  image: string;
  alt: string;
  caption?: string;
  product_slug?: string;
  drop?: string;
  active?: boolean;
  sort?: number;
};
export type Drop = {
  id: string; // "drop-1"
  n: number;
  title: string;
  tagline?: string;
  description?: string;
  status: "live" | "preorder" | "archived";
  image?: string;
};
export type Design = {
  id: string; // = slug
  slug: string;
  design_id: string;
  title: string;
  trend: { summary: string; sources: { label: string; url: string }[] };
  pitch: string;
  ceo: { verdict: string; reason: string; at: string };
  product_session?: string;
  ceo_session?: string;
  created_at: string;
};
export type Content = {
  version: 1;
  updated_at: string;
  announcement?: string;
  banners: Banner[];
  lookbook: LookbookEntry[];
  drops: Drop[];
  designs: Design[];
};

export const COLLECTIONS = ["banners", "lookbook", "drops", "designs"] as const;
export type Collection = (typeof COLLECTIONS)[number];

const isStr = (v: unknown, max = 500) => typeof v === "string" && v.length > 0 && v.length <= max;
const isUrl = (v: unknown) => typeof v === "string" && /^(https:\/\/|\/)[^\s]+$/.test(v) && v.length <= 1000;
const optStr = (v: unknown, max = 500) => v === undefined || (typeof v === "string" && v.length <= max);

const isHttp = (v: unknown) => typeof v === "string" && /^https?:\/\/[^\s]+$/.test(v) && v.length <= 1000;
const isIso = (v: unknown) => typeof v === "string" && !Number.isNaN(Date.parse(v));

export function validateItem(collection: Collection, item: Record<string, unknown>): string | null {
  if (!item || typeof item !== "object") return "item must be an object";
  if (collection === "designs") {
    if (!isStr(item.slug, 80) || !/^[a-z0-9-]+$/.test(item.slug as string)) return "slug: lowercase letters, digits and dashes";
    if (item.id !== undefined && item.id !== item.slug) return "designs are keyed by slug (id must equal slug or be omitted)";
    if (!isStr(item.design_id, 80)) return "design_id required";
    if (!isStr(item.title, 120)) return "title required (max 120)";
    const t = item.trend as { summary?: unknown; sources?: unknown } | undefined;
    if (!t || !isStr(t.summary, 600)) return "trend.summary required (max 600)";
    if (!Array.isArray(t.sources) || t.sources.length > 6) return "trend.sources must be an array of at most 6";
    for (const src of t.sources as { label?: unknown; url?: unknown }[]) {
      if (!src || !isStr(src.label, 120) || !isHttp(src.url)) return "each source needs label (max 120) and an http(s) url";
    }
    if (!isStr(item.pitch, 600)) return "pitch required (max 600)";
    const c = item.ceo as { verdict?: unknown; reason?: unknown; at?: unknown } | undefined;
    if (!c || !isStr(c.verdict, 40) || !isStr(c.reason, 800) || !isIso(c.at)) return "ceo needs verdict, reason (max 800) and an ISO time 'at'";
    if (!optStr(item.product_session, 120) || !optStr(item.ceo_session, 120)) return "session ids max 120";
    if (!isIso(item.created_at)) return "created_at must be an ISO time";
    return null;
  }
  if (!isStr(item.id, 80) || !/^[a-z0-9-]+$/.test(item.id as string)) return "id: lowercase letters, digits and dashes";
  if (collection === "banners") {
    if (!isStr(item.title, 120)) return "title required (max 120)";
    if (!isUrl(item.image)) return "image must be an https URL";
    if (!isStr(item.image_alt, 300)) return "image_alt required";
    if (!optStr(item.subtitle, 240) || !optStr(item.cta_label, 40)) return "subtitle max 240, cta_label max 40";
    if (item.cta_href !== undefined && !(typeof item.cta_href === "string" && /^(\/|https:\/\/)/.test(item.cta_href))) return "cta_href must start with / or https://";
    if (item.focus !== undefined && !["left", "right", "center"].includes(item.focus as string)) return "focus: left|right|center";
  }
  if (collection === "lookbook") {
    if (!isUrl(item.image)) return "image must be an https URL";
    if (!isStr(item.alt, 300)) return "alt required";
    if (!optStr(item.caption, 200) || !optStr(item.product_slug, 80) || !optStr(item.drop, 40)) return "caption max 200";
  }
  if (collection === "drops") {
    if (!/^drop-\d+$/.test(String(item.id))) return "drop id must look like drop-2";
    if (typeof item.n !== "number") return "n (drop number) required";
    if (!isStr(item.title, 120)) return "title required";
    if (!["live", "preorder", "archived"].includes(item.status as string)) return "status: live|preorder|archived";
    if (item.image !== undefined && !isUrl(item.image)) return "image must be an https URL";
  }
  return null;
}

export function validateContent(c: unknown): string | null {
  const doc = c as Content;
  if (!doc || typeof doc !== "object") return "content must be an object";
  for (const col of COLLECTIONS) {
    if (col === "designs" && doc[col] === undefined) continue;
    if (!Array.isArray(doc[col])) return `${col} must be an array`;
    for (const item of doc[col]) {
      const err = validateItem(col, item as unknown as Record<string, unknown>);
      if (err) return `${col}[${(item as { id?: string }).id ?? "?"}]: ${err}`;
    }
  }
  if (!optStr(doc.announcement, 200)) return "announcement max 200";
  return null;
}
