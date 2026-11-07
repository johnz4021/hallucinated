// content.json on Vercel Blob (stored as immutable versions under content/v/; newest wins). Usage:
//   node scripts/content.mjs pull            -> prints the live content.json
//   node scripts/content.mjs push <file>     -> publishes a new version (then POST /api/revalidate, or wait up to an hour)
// Agents should use the admin API instead (see CONTENT.md); this is for seeding and recovery.
import { list, put } from "@vercel/blob";
import { readFileSync } from "node:fs";
import { envVar } from "./root-env.mjs";

const token = envVar("BLOB_READ_WRITE_TOKEN");
if (!token) { console.error("BLOB_READ_WRITE_TOKEN missing"); process.exit(2); }
const PREFIX = "content/v/";
const [cmd, file] = process.argv.slice(2);
if (cmd === "pull") {
  const { blobs } = await list({ prefix: PREFIX, token, limit: 1000 });
  const latest = blobs.sort((a, b) => a.pathname.localeCompare(b.pathname)).at(-1);
  console.log(latest ? await (await fetch(latest.url)).text() : "{}");
} else if (cmd === "push" && file) {
  const doc = JSON.parse(readFileSync(file, "utf8"));
  doc.updated_at = new Date().toISOString();
  const pathname = `${PREFIX}${String(Date.now()).padStart(15, "0")}-${Math.random().toString(36).slice(2, 8)}.json`;
  const r = await put(pathname, JSON.stringify(doc, null, 2), { access: "public", token, contentType: "application/json", addRandomSuffix: false });
  console.log(`pushed ${r.pathname}`);
} else {
  console.error("usage: content.mjs pull | push <file>");
  process.exit(1);
}
