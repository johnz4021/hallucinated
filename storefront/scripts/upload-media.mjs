// Uploads local images to the public Blob store and prints { name: url } JSON.
// Usage: node scripts/upload-media.mjs <prefix> <file> [file...]   e.g. media/drop-1 a.jpg b.jpg
import { put } from "@vercel/blob";
import { readFileSync } from "node:fs";
import path from "node:path";
import { envVar } from "./root-env.mjs";

const token = envVar("BLOB_READ_WRITE_TOKEN");
if (!token) { console.error("BLOB_READ_WRITE_TOKEN missing (run: npx vercel@latest env pull .env.local)"); process.exit(2); }
const [prefix, ...files] = process.argv.slice(2);
const out = {};
for (const f of files) {
  const name = path.basename(f);
  const type = name.endsWith(".png") ? "image/png" : name.endsWith(".webp") ? "image/webp" : "image/jpeg";
  const r = await put(`${prefix.replace(/\/$/, "")}/${name}`, readFileSync(f), { access: "public", token, contentType: type, addRandomSuffix: false, allowOverwrite: true });
  out[path.parse(name).name] = r.url;
}
console.log(JSON.stringify(out, null, 2));
