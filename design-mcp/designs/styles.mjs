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

// Ad scenarios for Creative (John, Sat 18:00: "based on real-life wear, not those animated posters"): every ad is a
// PHOTOREALISTIC photo of a (fictional) person WEARING our clothes, the garment the clear centre of the frame. The joke is
// the situation + the X caption. Rotated like the design styles (in ads.json), each paired with a photo style.
export const AD_FORMATS = {
  beanbag_3am: "a founder asleep on an office beanbag at 3am, laptop still open, cold pizza, monitor glow",
  whiteboard_boxes: "two engineers at a whiteboard covered in boxes and arrows, one pointing with total confidence",
  caltrain_fog: "someone waiting on a foggy Caltrain platform at dawn, hands in pockets, train lights in the mist",
  demo_day_stage: "a demo-day stage photo: a nervous founder mid-pitch under hard stage lights, audience silhouettes",
  waymo_selfie: "a back-seat selfie in a driverless robotaxi (unbranded), empty driver's seat in frame",
  coffee_shop_laptop: "a coffee-shop laptop shot: a founder hunched over a laptop, oat-milk latte, three chargers",
  rto_badge_line: "an office return-to-office badge line, a queue of tired engineers at the turnstiles at 9am",
  dolores_park: "Dolores Park on a sunny afternoon, someone 'working' on a laptop on the grass, city skyline behind",
  server_room: "a server room: someone in the aisle between blinking racks, holding a single sad cable",
  standup_meeting: "a daily standup in a glass meeting room, everyone standing, one person very much not listening",
  rooftop_party: "a startup rooftop party at golden hour, someone explaining their pivot to a polite stranger",
  scooter_commute: "someone on an electric scooter in the Mission at rush hour, laptop bag, determined face",
  vc_coffee: "a pitch over coffee at a Sand Hill Road cafe, the founder leaning in, the investor checking their phone",
  hackathon_floor: "a hackathon floor at 4am: energy drinks, sleeping bags, one person still coding",
};
// Photo styles for the scenarios (photorealistic only)
export const AD_PHOTO_STYLES = {
  editorial: "editorial fashion photography: natural light, shallow depth of field, real skin texture, magazine quality",
  street: "street photography: candid, 35mm, available light, slight motion, real city grit",
  flash: "direct-flash party/night photography: hard flash, deep shadows, candid, a little chaotic",
  phone_candid: "an iPhone candid: slightly imperfect framing, natural colours, as if a friend took it",
  film_35mm: "35mm film photo: Portra colours, grain, soft highlights",
};
export const AD_PHOTO_STYLE_IDS = Object.keys(AD_PHOTO_STYLES);
export const AD_FORMAT_IDS = Object.keys(AD_FORMATS);
