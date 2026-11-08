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

// -> { out, poster, width, height, duration, bytes, lines }
export async function composeVideo({ input, out, poster, headline, position = "bottom", productImage = null, endSeconds = 1.3, width = 720, font = fontFile(), mono = fontFile(MONO_CANDIDATES) }) {
  if (!font) throw new Error("no headline font found");
  const lines = wrapHeadline(headline);
  if (!lines) throw new Error("headline doesn't fit in 2 lines");
  const src = await probe(input);
  if (!src.width || !src.height) throw new Error("input has no video stream");
  const W = width, H = Math.round((W * src.height) / src.width / 2) * 2;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vcomp-"));
  const tf = path.join(tmp, "headline.txt"); fs.writeFileSync(tf, lines.join("\n"));
  const uf = path.join(tmp, "url.txt"); fs.writeFileSync(uf, STORE_HOST);
  const fs1 = Math.round(Math.min(W * 0.085, (W * 0.88) / (0.68 * Math.max(...lines.map((l) => l.length)))));   // Arial Black is wide
  const band = Math.round(fs1 * lines.length * 1.25 + fs1 * 0.9);
  const bandY = position === "top" ? Math.round(H * 0.06) : H - band - Math.round(H * 0.07);
  const esc = (p) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
  const dur = Math.max(1, src.duration || 5);
  const logoW = Math.round(W * 0.78), prodW = Math.round(W * 0.62);
  const urlSize = Math.round(W * 0.045);
  // main: scale, band, headline. end card: forest plate, (product), wordmark, URL. Then concat.
  const filter = [
    `[0:v]scale=${W}:${H},setsar=1,fps=30,format=yuv420p,drawbox=x=0:y=${bandY}:w=${W}:h=${band}:color=${COLORS.forest}@0.96:t=fill,` +
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
  await run("ffmpeg", args, { timeout: 60_000 });
  await run("ffmpeg", ["-v", "error", "-y", "-ss", String(Math.min(1, dur / 2)), "-i", out, "-frames:v", "1", "-q:v", "3", poster], { timeout: 20_000 });
  const o = await probe(out);
  fs.rmSync(tmp, { recursive: true, force: true });
  return { out, poster, width: o.width, height: o.height, duration: o.duration, bytes: fs.statSync(out).size, lines };
}
