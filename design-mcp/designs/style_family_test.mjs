// The CEO judges a design by ITS style family: a photo-family proposal must not be failed for being a photo.
// (Sat: the CEO rejected vibe-manufacturing-tee, a photo box print, citing the old "flat, no photos, no gradients" art_style.)
import assert from "node:assert/strict";
import fs from "node:fs";
import { ceoBrief, styleOf } from "./tools.mjs";
import { checkProposal } from "./guard.mjs";
import { STYLES } from "./styles.mjs";

const BRAND = JSON.parse(fs.readFileSync(new URL("../brand.json", import.meta.url), "utf8"));
const verdict = { pass: true, style: "photo_box", family: "photo", text_seen: "VIBE MANUFACTURING", notes: "sharp photo panel", issues: [], placement: "back",
  args: { placement: "back", text: "VIBE MANUFACTURING", prompt: "photo box print: an AI-generated photograph of a robot arm assembling a laptop in a garage, realistic lighting, shallow depth of field, gradient sky" } };
const p = { proposal_id: "prop_1", slug: "vibe-manufacturing-tee", title: "Vibe manufacturing", pitch: "A photo box print of a robot arm vibe-building hardware.", trend_summary: "Everyone is vibe coding hardware now.", sources: [{ label: "hn", url: "https://news.ycombinator.com/item?id=1" }] };

// 1. style comes from the verdict when the proposal doesn't carry it (old proposals), and from the proposal when it does
assert.deepEqual(styleOf(p, verdict), { style: "photo_box", family: "photo", label: STYLES.photo_box.label });
assert.equal(styleOf({ style: "woodcut", family: "ink" }, verdict).family, "ink");
console.log("styleOf: OK");

// 2. the CEO brief shows the style + family and checklist 5 says the family is judged on its own rules
const brief = ceoBrief(p, verdict);
assert.match(brief, /Art style: photo box print \(photo family\)/);
assert.match(brief, /art_style\.photo/);
assert.match(brief, /5\. .*FOR ITS STYLE FAMILY.*never off-brand for being a photo, having colour or gradients/);
assert.doesNotMatch(brief, /flat screen-print|no photo|solid colors only/i);
console.log("CEO brief (photo family): OK");

// 3. brand.json: every family is on-brand; the flat / no-photo / no-gradient rules apply to ink only
assert.ok(Array.isArray(BRAND.art_style.all_families) && /every style family .* is on-brand/i.test(BRAND.art_style.all_families[0]));
for (const fam of ["photo", "collage", "color"]) {
  const rules = [...BRAND.art_style.all_families, ...BRAND.art_style[fam]].join(" ");
  assert.doesNotMatch(rules, /no photo|no gradients|solid colors only|flat screen-print/i, `${fam} rules still ban photos/gradients`);
}
assert.match(BRAND.art_style.ink.join(" "), /flat screen-print/);   // ink keeps its rules
for (const [id, s] of Object.entries(STYLES)) assert.ok(BRAND.art_style[s.family], `no art_style rules for family ${s.family} (${id})`);
for (const fam of new Set(Object.values(STYLES).map((s) => s.family))) for (const s of Object.values(STYLES).filter((x) => x.family === fam))
  assert.ok(BRAND.art_style.all_families[0].includes(s.label), `all_families lists ${s.label} under the wrong family or not at all`);
console.log("brand.json art_style by family: OK");

// 4. the code-side guardrail (propose_design + ceo_decide) doesn't trip on photo words
assert.deepEqual(checkProposal({ ...p, print_text: verdict.text_seen, prompt: verdict.args.prompt }), []);
console.log("guardrail ignores photo/gradient wording: OK");
console.log("style family tests: all OK");
