// Quotes and (after you press Enter) buys a $1 Naïve prepaid card on the Hallucinated identity, for the payment dry run.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { createClient } from "@usenaive-sdk/vetta";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const env = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
const v = createClient({ baseUrl: "https://api.vetta.sh", apiKey: (env.match(/VETTA_API_KEY\s*=\s*["']?([^\s"']+)/) || [])[1] });
const identity = ((await v.identities.list({ limit: 50 })).data || []).find((i) => /hallucinated/i.test(i.name));
const existing = (await v.identities.cards.list(identity.id).catch(() => ({ data: [] }))).data || [];
console.log("existing cards:", existing.map((c) => `${c.id} ${c.status} $${c.load_micro_usd / 1e6} spent $${c.spent_micro_usd / 1e6} ${c.brand || ""} ${c.last4 || ""}`).join(" | ") || "none");
const q = await v.identities.cards.quote(identity.id, { load_micro_usd: 1_000_000 });
console.log(`\nA $1.00 test card costs $${(q.price_micro_usd / 1e6).toFixed(2)} total (brand ${q.brand ?? "?"}), from your Naïve balance.`);
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const a = await rl.question("Press Enter to buy it, or type n then Enter to cancel: ");
rl.close();
if (a.trim().toLowerCase().startsWith("n")) { console.log("Cancelled. Nothing bought."); process.exit(0); }
let card = await v.identities.cards.issue(identity.id, { label: "Hallucinated payment dry run", load_micro_usd: 1_000_000 });
for (let i = 0; i < 20 && ["pending_payment", "issuing"].includes(card.status); i++) { await new Promise((r) => setTimeout(r, 3000)); card = await v.identities.cards.get(identity.id, card.id); }
console.log(`\ncard ${card.id}: status ${card.status} ${card.brand || ""} ${card.last4 || ""}${card.failure_reason ? " reason: " + card.failure_reason : ""}`);
fs.writeFileSync(path.join(ROOT, "customania-runs", "test-card.txt"), card.id + "\n");
console.log("saved the card id to customania-runs/test-card.txt");
