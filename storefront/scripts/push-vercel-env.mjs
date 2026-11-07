// Pipes secrets into Vercel env vars without echoing them.
// Usage: node scripts/push-vercel-env.mjs [--env preview|production]   (default: preview)
// STRIPE_SECRET_KEY comes from the repo-root .env (test keys only unless ALLOW_LIVE_STRIPE=1);
// STORE_ADMIN_SECRET from ../.env or storefront/.env.admin.
// Production is the lead's call: it needs --env production AND CONFIRM_PRODUCTION=1.
import { spawnSync } from "node:child_process";
import { stripeKey, envVar, STOREFRONT } from "./root-env.mjs";

const i = process.argv.indexOf("--env");
const target = i > -1 ? process.argv[i + 1] : "preview";
if (!["preview", "production"].includes(target)) { console.error("--env must be preview or production"); process.exit(1); }
if (target === "production" && process.env.CONFIRM_PRODUCTION !== "1") {
  console.error("Refusing to write production env vars without CONFIRM_PRODUCTION=1 (it would replace the live key).");
  process.exit(1);
}
const { key, mode } = stripeKey();
const vars = { STRIPE_SECRET_KEY: key, STORE_ADMIN_SECRET: envVar("STORE_ADMIN_SECRET") };
for (const [name, value] of Object.entries(vars)) {
  if (!value) { console.log(`${name}: missing locally, skipped`); continue; }
  const r = spawnSync("npx", ["--yes", "vercel@latest", "env", "add", name, "--environment", target, "--sensitive", "--force", "--yes"], {
    cwd: STOREFRONT, input: value, stdio: ["pipe", "ignore", "pipe"],
  });
  console.log(`${name} -> ${target}: ${r.status === 0 ? "set" : "FAILED"}${name === "STRIPE_SECRET_KEY" ? ` (${mode} key)` : ""}`);
  if (r.status !== 0) console.error((r.stderr || "").toString().split(value).join("[redacted]").slice(-600));
}
