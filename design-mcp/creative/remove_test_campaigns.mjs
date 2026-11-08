// Removes test campaigns from the store's content (only items with test:true, plus any ids passed on the command line).
//   node creative/remove_test_campaigns.mjs [extra-id ...]
import path from "node:path";
import { fileURLToPath } from "node:url";
import { storeAdmin } from "../designs/publish.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const admin = storeAdmin(ROOT);
if (admin.error) { console.error(admin.error); process.exit(1); }
const { content } = await admin.call("GET", "/api/admin/content");
const extra = process.argv.slice(2);
const doomed = (content.campaigns || []).filter((c) => c.test === true || extra.includes(c.id));
console.log(`campaigns: ${(content.campaigns || []).length}, removing ${doomed.length} (test:true or named): ${doomed.map((c) => c.id).join(", ") || "none"}`);
for (const c of doomed) {
  for (let i = 0; i < 3; i++) {
    try { await admin.call("PATCH", "/api/admin/content", { json: { op: "remove", collection: "campaigns", id: c.id } }); console.log("removed", c.id); break; }
    catch (e) { if (e.status !== 409) { console.log("failed", c.id, e.message); break; } await new Promise((r) => setTimeout(r, 800)); }
  }
}
const after = (await admin.call("GET", "/api/admin/content")).content.campaigns || [];
console.log(`left: ${after.length} campaign(s)${after.length ? ": " + after.map((c) => `${c.id}${c.test ? " (test)" : ""}`).join(", ") : ""}`);
process.exit(0);
