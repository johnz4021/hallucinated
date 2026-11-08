// Video ads without garbled text (John, Sat: phase 8). Kling/Veo animate a TEXT-FREE visual gag; this code then burns in
// the headline with ffmpeg drawtext (bone on a forest band, top or bottom) and appends a short end card (our wordmark,
// optionally the featured product's mockup, and the store URL). Output: H.264 MP4 (yuv420p, 30 fps, 720 px wide, no audio,
// +faststart: inside X's limits) and a JPEG poster. The reviewer then checks frames of THIS final file.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LOGO = path.join(HERE, "..", "refs", "logo.png");   // the exact wordmark, bone + eucalyptus ghost, transparent
export const STORE_HOST = "hallucinated-store.vercel.app";
// a heavy grotesk for the headline (brand.json typography), from macOS; no font files are bundled (licensing)
const FONT_CANDIDATES = ["/System/Library/Fonts/Supplemental/Arial Black.ttf", "/System/Library/Fonts/Supplemental/Impact.ttf", "/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial Unicode.ttf"];
const MONO_CANDIDATES = ["/System/Library/Fonts/SFNSMono.ttf", "/System/Library/Fonts/Menlo.ttc", "/System/Library/Fonts/Supplemental/Courier New Bold.ttf"];
export const fontFile = (list = FONT_CANDIDATES) => list.find((f) => fs.existsSync(f)) || null;
export const VIDEO_NO_TEXT = "No text of any kind anywhere in the video: no words, letters, numbers, captions, subtitles, signs, labels, screens with writing, logos or watermarks. A purely visual gag.";
export const COLORS = { bone: "0xF2EEE6", forest: "0x2F3B2A", black: "0x1A1A1A" };

// Pure: wrap a headline into at most 2 lines of ~maxChars, return null if it won't fit
export function wrapHeadline(text, maxChars = 22) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return null;
  const lines = [""];
  for (const w of words) {
    const cur = lines.at(-1);
    if (!cur) lines[lines.length - 1] = w;
    else if ((cur + " " + w).length <= maxChars) lines[lines.length - 1] = cur + " " + w;
    else lines.push(w);
  }
  return lines.length <= 2 && lines.every((l) => l.length <= maxChars + 6) ? lines : null;
}
// Pure: a headline the tool accepts: 1-8 words, <= 48 chars, plain printable ASCII (drawtext + our fonts), no links/hashtags
export function headlineCheck(h) {
  const s = String(h || "").trim();
  if (!s) return "empty headline";
  if (s.length > 48) return `headline is ${s.length} chars (max 48)`;
  if (s.split(/\s+/).length > 8) return "headline is over 8 words (the caption carries the rest)";
  if (/[^\x20-\x7E]/.test(s)) return "headline must be plain ASCII (no emoji, curly quotes or dashes)";
  if (/https?:|www\.|#\w/.test(s)) return "no links or hashtags in the headline";
  return null;
}

const probe = async (f) => {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", f]);
  const j = JSON.parse(stdout);
  return { width: j.streams?.[0]?.width, height: j.streams?.[0]?.height, duration: parseFloat(j.format?.duration) || 0 };
};

// Black letterbox bars (Veo pads a 4:5 still to 9:16): detect them so the composed ad is the picture only. -> "w:h:x:y" | null
export async function detectBars(input, src) {
  try {
    const { stderr } = await run("ffmpeg", ["-v", "info", "-i", input, "-vf", "cropdetect=limit=24:round=2:reset=0", "-frames:v", "60", "-f", "null", "-"], { timeout: 30_000 });
    const m = [...String(stderr).matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].at(-1);
    if (!m) return null;
    const [w, h, x, y] = m.slice(1).map(Number);
    // only real bars: at least 4% of the frame cut, and the picture keeps most of its size
    if (w * h >= src.width * src.height * 0.96 || w < src.width * 0.5 || h < src.height * 0.5) return null;
    return { w, h, x, y };
  } catch { return null; }
}

// Pure: the headline band for a W x H frame: one line if it fits at a readable size, else two; band <= 14% of H.
export const BAND_MAX = 0.14;
export function bandLayout(headline, W, H) {
  const text = String(headline || "").replace(/\s+/g, " ").trim();
  const fit = (lines) => {
    const longest = Math.max(...lines.map((l) => l.length));
    let f = Math.min(W * 0.075, (W * 0.9) / (0.68 * longest));            // width limit (Arial Black is wide)
    f = Math.min(f, (H * BAND_MAX) / (lines.length * 1.25 + 0.7));       // height limit: the band stays within 14%
    return { lines, fontSize: Math.round(f), band: Math.round(f * lines.length * 1.25 + f * 0.7) };
  };
  const one = fit([text]);
  if (one.fontSize >= W * 0.042) return one;                              // readable as one line
  const two = wrapHeadline(text, Math.ceil(text.length / 2) + 3) || wrapHeadline(text);
  return fit(two || [text]);
}

// Output frame (John, Sat 20:40: video ads in 2:3, 1080x1620). ADS_VIDEO_ASPECT = "2:3" (default) | "9:16" (1080x1920).
export function outputSize(aspect = process.env.ADS_VIDEO_ASPECT || "2:3") {
  const [a, b] = String(aspect).split(":").map(Number);
  if (!(a > 0 && b > 0)) return { W: 1080, H: 1620, aspect: "2:3" };
  return { W: 1080, H: Math.round((1080 * b) / a / 2) * 2, aspect: `${a}:${b}` };
}

// -> { out, poster, width, height, duration, bytes, lines, cropped }
export async function composeVideo({ input, out, poster, headline, position = "bottom", productImage = null, endSeconds = 1.3, aspect, font = fontFile(), mono = fontFile(MONO_CANDIDATES) }) {
  if (!font) throw new Error("no headline font found");
  if (!wrapHeadline(headline)) throw new Error("headline doesn't fit in 2 lines");
  const src = await probe(input);
  if (!src.width || !src.height) throw new Error("input has no video stream");
  const bars = await detectBars(input, src);
  // fill the output frame: scale up to cover, then crop centred (horizontally centred; vertically a touch above centre, where
  // faces and chest prints sit). No letterbox.
  const { W, H } = outputSize(aspect);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vcomp-"));
  const tf = path.join(tmp, "headline.txt");
  const uf = path.join(tmp, "url.txt"); fs.writeFileSync(uf, STORE_HOST);
  // The band is ALWAYS at the top (lead, Sat 20:50: a bottom band covered the shirt print, and the shirt is the point of the
  // ad), at most 14% of the frame height, semi-opaque. One line if it fits at a readable size, else two.
  const { lines, fontSize: fs1, band } = bandLayout(headline, W, H);
  const bandY = Math.round(H * 0.035);
  fs.writeFileSync(tf, lines.join("\n"));
  const esc = (p) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  const dur = Math.max(1, src.duration || 5);
  const logoW = Math.round(W * 0.78), prodW = Math.round(W * 0.62);
  const urlSize = Math.round(W * 0.045);
  // main: scale, band, headline. end card: forest plate, (product), wordmark, URL. Then concat.
  const filter = [
    `[0:v]${bars ? `crop=${bars.w}:${bars.h}:${bars.x}:${bars.y},` : ""}scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-${W})/2:(ih-${H})*0.45,setsar=1,fps=30,format=yuv420p,drawbox=x=0:y=${bandY}:w=${W}:h=${band}:color=${COLORS.forest}@0.85:t=fill,` +
      `drawtext=fontfile='${esc(font)}':textfile='${esc(tf)}':fontcolor=${COLORS.bone}:fontsize=${fs1}:line_spacing=${Math.round(fs1 * 0.22)}:x=(w-text_w)/2:y=${bandY}+(${band}-text_h)/2[main]`,
    `color=c=${COLORS.forest}:s=${W}x${H}:r=30:d=${endSeconds},format=yuv420p[plate]`,
    `[1:v]scale=${logoW}:-1[logo]`,
    ...(productImage ? [`[2:v]scale=${prodW}:-1[prod]`, `[plate][prod]overlay=x=(W-w)/2:y=H*0.12[p1]`, `[p1][logo]overlay=x=(W-w)/2:y=H*0.66[p2]`] : [`[plate][logo]overlay=x=(W-w)/2:y=(H-h)/2-H*0.04[p2]`]),
    `[p2]drawtext=fontfile='${esc(mono || font)}':textfile='${esc(uf)}':fontcolor=${COLORS.bone}:fontsize=${urlSize}:x=(w-text_w)/2:y=${productImage ? "h*0.66+" + Math.round(logoW * 0.2) + "+" + Math.round(urlSize * 1.2) : "h/2+" + Math.round(logoW * 0.12) + "+" + urlSize},format=yuv420p,setsar=1[end]`,
    `[main][end]concat=n=2:v=1:a=0[v]`,
  ].join(";");
  const args = ["-v", "error", "-y", "-i", input, "-loop", "1", "-t", String(endSeconds), "-i", LOGO,
    ...(productImage ? ["-loop", "1", "-t", String(endSeconds), "-i", productImage] : []),
    "-filter_complex", filter, "-map", "[v]", "-t", String(dur + endSeconds), "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-profile:v", "high", "-pix_fmt", "yuv420p",
    "-movflags", "+faststart", "-an", out];
  await run("ffmpeg", args, { timeout: 80_000 });
  await run("ffmpeg", ["-v", "error", "-y", "-ss", String(Math.min(1, dur / 2)), "-i", out, "-frames:v", "1", "-q:v", "3", poster], { timeout: 20_000 });
  const o = await probe(out);
  fs.rmSync(tmp, { recursive: true, force: true });
  return { out, poster, width: o.width, height: o.height, duration: o.duration, bytes: fs.statSync(out).size, lines, band, band_pct: Number((band / H).toFixed(3)), position: "top", cropped: bars };
}
