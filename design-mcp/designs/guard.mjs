// Code-level guardrails for agent-designed products. Terms live in brand.json "banned_terms".
// Whole-word, case-insensitive, punctuation-insensitive ("GPT-5" == "gpt 5", "9/11" == "9 11").
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BRAND_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "brand.json");
const norm = (s) => ` ${String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;

export function bannedTerms(brand = JSON.parse(fs.readFileSync(BRAND_FILE, "utf8"))) {
  const b = brand.banned_terms || {};
  return { real_people: b.real_people || [], trademarks: b.trademarks || [], tragedy: b.tragedy || [] };
}

// fields: { name: text }, lists: which lists apply. Returns [{field, term, list}] (empty = clean).
export function findBanned(fields, lists = ["real_people", "trademarks", "tragedy"], terms = bannedTerms()) {
  const hits = [];
  for (const [field, text] of Object.entries(fields)) {
    const t = norm(text);
    for (const list of lists) for (const term of terms[list] || []) {
      const n = norm(term);
      if (n.trim() && t.includes(n)) hits.push({ field, term, list });
    }
  }
  return hits;
}

// The check propose_design and ceo_decide both run. Titles, slugs, pitches and the PRINTED text are held to every list;
// the trend summary (which names platforms as sources) and the image prompt (which says "no logos") only to people + tragedy.
export function checkProposal({ title, slug, pitch, trend_summary, print_text, prompt }, terms) {
  return [
    ...findBanned({ title, slug: String(slug || "").replace(/-/g, " "), pitch, print_text }, ["real_people", "trademarks", "tragedy"], terms),
    ...findBanned({ trend_summary, prompt }, ["real_people", "tragedy"], terms),
  ];
}

export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
