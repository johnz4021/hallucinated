// Small shared helpers: read one key from .env (never logged), and JSON / JSONL state files in the repo root.
import fs from "node:fs";
import path from "node:path";

// Same regex the other scripts use. Tolerates a doubled name ("NAME=NAME=value"), which .env has had once.
export function envKey(rootDir, name) {
  const f = path.join(rootDir, ".env");
  if (!fs.existsSync(f)) return undefined;
  const v = (fs.readFileSync(f, "utf8").match(new RegExp(`^${name}\\s*=\\s*["']?([^\\s"']+)`, "m")) || [])[1];
  return v ? v.replace(new RegExp(`^${name}=`), "") : undefined;
}

export function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

// write-then-rename so a crash never leaves half a ledger
export function writeJson(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function appendJsonl(file, row) {
  fs.appendFileSync(file, JSON.stringify({ at: new Date().toISOString(), ...row }) + "\n");
}

export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

export const txt = (o) => ({ content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o, null, 2) }] });
export const err = (m) => ({ isError: true, content: [{ type: "text", text: m }] });
