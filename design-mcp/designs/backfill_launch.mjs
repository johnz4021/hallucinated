// Launch images for designs that are already on the store (CONTENT.md §6), or a test run. Same code path as the
// ceo_decide hook (designs/launch.mjs); this just awaits the job instead of returning at once.
//   node designs/backfill_launch.mjs <slug> [slug ...] [--dry] [--test] [--regen] [--no-publish] [--label <dir-suffix>]
//   node designs/backfill_launch.mjs --all [--dry]      every LIVE published agent design without live launch images
// test:true is automatic when the design was published in sandbox mode; --test forces it (shown on previews only).
// Passing images made earlier for the same design (e.g. a --test run) are reused, not regenerated (--regen redoes them).
// Spend: up to 9 image generations per design (3 shots x 3 tries), daily cap LAUNCH_MAX_IMAGES_PER_DAY (default 60).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { envKey } from "../lib/state.mjs";
import { loadProposals } from "./ledger.mjs";
import { startLaunchImages, designInfo, shotPlan, shotPrompt, loadLaunch, gensToday, MAX_PER_DAY, isTest } from "./launch.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const argv = process.argv.slice(2), has = (f) => argv.includes(f);
const labelAt = argv.indexOf("--label"), label = labelAt >= 0 ? argv[labelAt + 1] : null;
const dry = has("--dry"), test = has("--test"), regen = has("--regen"), publish = !has("--no-publish");
let slugs = argv.filter((a, i) => !a.startsWith("--") && !(labelAt >= 0 && i === labelAt + 1));
if (has("--all")) {
  const l = loadLaunch(ROOT);
  const live = Object.values(loadProposals(ROOT).proposals).filter((p) => p.mode === "live" && p.state === "published" && p.publish?.print_url).map((p) => p.slug);
  slugs = [...new Set([...slugs, ...live.filter((s) => !(l.designs[s]?.published?.ok && !l.designs[s].published.test))])];
}
if (!slugs.length) { console.error("usage: node designs/backfill_launch.mjs <slug> [...] | --all  [--dry] [--test] [--regen] [--no-publish] [--label <x>]"); process.exit(1); }

const ts = () => new Date().toISOString().slice(11, 19);
const ctx = { rootDir: ROOT, outDir: path.join(ROOT, "design-test"), vettaKey: envKey(ROOT, "VETTA_API_KEY"), openaiKey: envKey(ROOT, "OPENAI_API_KEY"), log: (m) => console.log(`${ts()} ${m}`) };
console.log(`launch images for ${slugs.join(", ")}${dry ? " (dry run: nothing generated or written)" : ""}; today ${gensToday(loadLaunch(ROOT))}/${MAX_PER_DAY()} generations used`);
for (const slug of slugs) {
  if (dry) {
    try {
      const info = await designInfo(ROOT, ctx.outDir, slug);
      const d = loadLaunch(ROOT).designs[slug];
      console.log(JSON.stringify({ slug, design_id: info.design_id, mode: info.mode, test: isTest(info, test), text: info.text, refs: { back: info.back_url, front: info.front_url, flat: info.flat_url },
        reusable_passes: (d?.passes || []).length, published: d?.published || null, shots: shotPlan(slug).map((s) => ({ n: s.n, view: s.view, setting: s.setting, person: s.person })),
        first_prompt: shotPrompt(shotPlan(slug)[0], info) }, null, 1));
    } catch (e) { console.log(`${slug}: ${e.message}`); }
    continue;
  }
  try {
    const r = await startLaunchImages(ctx, slug, { test, regen, publish, ...(label ? { label: slugs.length > 1 ? `${label}-${slug}` : label } : {}) });
    const final = await r.done;
    console.log(JSON.stringify(final ? { slug, job_id: final.job_id, state: final.state, passes: final.passes, generations: final.generations, cost: final.cost, published: final.published, run_dir: final.run_dir, error: final.error } : { slug, ...r, done: undefined }, null, 1));
  } catch (e) { console.log(`${slug}: ${e.message}`); }
}
process.exit(0);
