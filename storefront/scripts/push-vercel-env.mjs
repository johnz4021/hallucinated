// Pipes STRIPE_SECRET_KEY from the repo-root .env into Vercel env vars (production) without echoing it.
// Run from storefront/ after `npx vercel@latest link`.
import { spawnSync } from "node:child_process";
import { stripeKey, STOREFRONT } from "./root-env.mjs";

const { key, mode } = stripeKey();
for (const target of ["production"]) {
  spawnSync("npx", ["--yes", "vercel@latest", "env", "rm", "STRIPE_SECRET_KEY", target, "--yes"], { cwd: STOREFRONT, stdio: ["ignore", "ignore", "ignore"] });
  const r = spawnSync("npx", ["--yes", "vercel@latest", "env", "add", "STRIPE_SECRET_KEY", target, "--sensitive"], {
    cwd: STOREFRONT,
    input: key,
    stdio: ["pipe", "ignore", "pipe"],
  });
  const err = (r.stderr || "").toString().split(key).join("[redacted]");
  console.log(`${target}: ${r.status === 0 ? "set" : "FAILED"} (${mode} key)`);
  if (r.status !== 0) console.error(err.slice(-800));
}
