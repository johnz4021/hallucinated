// Art styles for agent shirts (and the visual vocabulary for ads), picked by a code rotation so the store doesn't turn
// into 40 light-ink line drawings. Each style belongs to a processing family that decides how generate.mjs preps the file:
//   ink      light ink on a black tee: hard alpha, near-black knockout, neutral->bone snap (today's prep)
//   photo    an AI-generated photo panel: full colour, hard rectangular (or die-cut) edge, transparent outside; no knockout/snap
//   collage  cut-paper / print collage: full colour, die-cut or page edge, transparent outside; no knockout/snap
//   color    a stylised full- or limited-colour print: transparent outside the art; no knockout/snap
// Photos are AI-generated scenes, never real photos: no real people's faces or names, no other brands' logos.
import path from "node:path";
import { readJson, writeJson } from "../lib/state.mjs";

export const STYLES = {
  terminal_lineart: { family: "ink", label: "terminal / line art", prompt: "Our house style: a monospace terminal line plus thin, even line art (like the '> git reset --hard' map tee). Light ink only." },
  woodcut: { family: "ink", label: "woodcut", prompt: "A bold woodcut / linocut print: carved gouge marks, chunky light ink on the black shirt, high contrast, handmade edges." },
  patent_drawing: { family: "ink", label: "patent drawing", prompt: "A fake 1890s patent drawing: precise technical line illustration with numbered callouts, a 'FIG. 1' label and a mock patent title, in light ink." },
  photo_box: { family: "photo", label: "photo box print", prompt: "A rectangular photo panel (Supreme-style box photo print): one sharp, well-lit AI-generated photograph with a hard rectangular edge, optionally a short caption line in bold type under or over it." },
  halftone_photo: { family: "photo", label: "halftone photo", prompt: "A coarse halftone-dot photo print (newspaper screen), high contrast, one or two ink colours, die-cut around the subject or in a hard rectangle." },
  flash_snapshot: { family: "photo", label: "flash snapshot", prompt: "A harsh on-camera-flash snapshot (90s point-and-shoot / paparazzi look): blown-out highlights, deep shadows, slightly crooked, inside a hard white-bordered print rectangle." },
  tabloid_front_page: { family: "collage", label: "tabloid front page", prompt: "A fake tabloid front page: screaming headline, sub-heads, a grainy photo, starbursts and 'EXCLUSIVE' tags, as a rectangular page." },
  ransom_note_collage: { family: "collage", label: "ransom-note collage", prompt: "A ransom-note collage: every letter cut from a different magazine (mixed fonts, colours, paper scraps), with tape and torn edges, die-cut." },
  photocopy_zine: { family: "collage", label: "photocopy zine", prompt: "A photocopied punk-zine page: high-contrast xerox texture, cut-and-paste photo and type, staples or tape, black-and-white with one spot colour, rectangular page edge." },
  bootleg_rap_tee: { family: "collage", label: "bootleg rap-tee collage", prompt: "A 90s bootleg rap-tee collage: multiple photo cut-outs, chrome or airbrushed type, flames or lightning, a busy symmetrical layout, die-cut." },
  risograph_2colour: { family: "color", label: "risograph 2-colour", prompt: "A two-colour risograph print (e.g. fluorescent pink and teal, or rust and eucalyptus): grainy texture, slight mis-registration, overlapping inks." },
  medieval_manuscript: { family: "color", label: "medieval manuscript", prompt: "An illuminated medieval manuscript page: a decorated drop cap, gold leaf, marginalia creatures, blackletter text, on a parchment rectangle." },
  clipart_90s: { family: "color", label: "90s clip art", prompt: "Early-90s office clip art: flat vector cartoon figures, WordArt-style rainbow type, cheerful and slightly cursed." },
  y2k_chrome: { family: "color", label: "Y2K chrome", prompt: "Y2K chrome: liquid-metal 3D type, lens flares, bubble shapes, iridescent highlights, early-2000s screensaver energy." },
};
export const STYLE_IDS = Object.keys(STYLES);
export const familyOf = (style) => STYLES[style]?.family || "ink";

// Rotation: never the same style twice in a row; prefer styles not used in the last 5; random among those (rng injectable).
export function pickStyle(history, rng = Math.random, ids = STYLE_IDS) {
  const last = history.at(-1);
  const recent = new Set(history.slice(-5));
  const fresh = ids.filter((s) => !recent.has(s));
  const pool = (fresh.length ? fresh : ids.filter((s) => s !== last));
  return pool[Math.floor(rng() * pool.length) % pool.length];
}

const file = (rootDir) => path.join(rootDir, "design-styles.json");
export const loadStyleLedger = (rootDir) => readJson(file(rootDir), { history: [], pending: null });
export function issueStyle(rootDir, rng) {
  const l = loadStyleLedger(rootDir);
  const style = pickStyle(l.history.map((h) => h.style), rng);
  l.pending = { style, at: new Date().toISOString() };
  writeJson(file(rootDir), l);
  return style;
}
// Recorded when a design PASSES QA (that's what ends up on the store).
export function recordStyle(rootDir, style, design_id, override_reason) {
  const l = loadStyleLedger(rootDir);
  l.history.push({ style, design_id, at: new Date().toISOString(), ...(override_reason ? { override_reason } : {}) });
  l.history = l.history.slice(-50);
  if (l.pending?.style === style) l.pending = null;
  writeJson(file(rootDir), l);
}

// Ad formats for Creative, rotated the same way (in ads.json), each paired with a fitting visual style.
export const AD_FORMATS = {
  fake_billboard: "a fake billboard on the 101, photographed from the freeway at golden hour",
  tabloid_cover: "a supermarket tabloid cover about the agents or the SF tech scene",
  museum_placard: "a museum placard next to a mundane tech artifact, in a hushed gallery",
  infomercial_still: "a late-night infomercial still: overacting hands, 'BUT WAIT' energy, a fake phone number",
  nature_doc_still: "a nature-documentary still with a deadpan subtitle observing a tech creature in its habitat",
  catalog_page: "a vintage mail-order catalog page with product numbers and absurd copy",
  wanted_poster: "an Old-West wanted poster for a startup sin",
  pitch_deck_slide: "a single fake pitch-deck slide",
  job_listing: "a fake job listing screenshot",
  terminal_screenshot: "a terminal or error-message screenshot",
  incident_report: "a mock incident report / postmortem page",
  editorial_photo: "a deadpan editorial photo with one line of copy",
  airline_safety_card: "an airline safety card illustrating a startup emergency",
  trading_card: "a collectible trading card of an SF tech archetype (fictional)",
};
export const AD_FORMAT_IDS = Object.keys(AD_FORMATS);
