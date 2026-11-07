// Runs a command (e.g. `next dev`) with STRIPE_SECRET_KEY taken from the repo-root .env.
import { spawn } from "node:child_process";
import { stripeKey, STOREFRONT } from "./root-env.mjs";

const { key } = stripeKey();
const [cmd, ...args] = process.argv.slice(2);
const child = spawn(cmd, args, {
  cwd: STOREFRONT,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: { ...process.env, STRIPE_SECRET_KEY: key, PATH: `${STOREFRONT}/node_modules/.bin:${process.env.PATH}` },
});
child.on("exit", (code) => process.exit(code ?? 0));
