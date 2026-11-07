// Checks the X developer keys in .env and makes ONE public test post through X's API (John approved).
// Usage: node x/x_api_test.mjs [--video]   (run from design-mcp). Never prints the keys.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { xKeys, xMe, xTweet, xUpload, prepVideo, xAccessLevel } from "./xapi.mjs";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LOG = path.join(ROOT, "naive.log");
const log = (m) => { const l = `[${new Date().toTimeString().slice(0, 8)}] ${m}`; console.log(l); fs.appendFileSync(LOG, l + "\n"); };
const keys = xKeys(fs.readFileSync(path.join(ROOT, ".env"), "utf8"));
if (!keys) { log("X API test: missing X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET in .env"); process.exit(1); }
log("== X API test");
try { const me = await xMe(keys); log(`auth OK as @${me.data?.username} (${me.data?.id})`); }
catch (e) { log("auth FAILED: " + e.message); process.exit(1); }
log("token access level: " + JSON.stringify(await xAccessLevel(keys).catch((e) => e.message)) + "  (posting needs read-write)");
try {
  let media_ids;
  if (process.argv.includes("--video")) {
    const { execFile } = await import("node:child_process");
    const ff = await new Promise((r) => execFile("ffmpeg", ["-version"], (e) => r(!e)));
    log(`ffmpeg on this Mac: ${ff ? "yes (agent videos get re-encoded)" : "NO: run brew install ffmpeg, or agent videos upload as-is and X refuses the oversized ones"}`);
    const f = path.join(ROOT, "e2e", "x-ready-pwma3s5.mp4");
    media_ids = [await xUpload(keys, fs.existsSync(f) ? f : await prepVideo(path.join(ROOT, "e2e", "video-fil_pwma3s5fq1y69mnwkwzn6mh54e.mp4")))];
    log(`video uploaded: media ${media_ids[0]}`);
  }
  const t = await xTweet(keys, { text: process.argv.includes("--video") ? "black tee. first drop. the fog is a feature, not a bug." : "the company is run by agents. the shirts are real. drop #1 soon.", media_ids });
  log(`POSTED https://x.com/i/status/${t.id}`);
} catch (e) { log("post FAILED: " + e.message); }
log("== X API test done");
