// Single-instance lock for serve.mjs (Sat 17:47: three overlapping serve.command launches each repointed the agents, and
// the strays' stop() deleted the shared .serve.json). <root>/.serve.lock holds the owner's pid, created with O_EXCL.
// A lock whose pid is dead, or alive but not a serve.mjs process (pid reuse), is stale and taken over.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

// Is `pid` a running serve.mjs? (injectable for tests)
export function isServePid(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); } catch (e) { if (e.code !== "EPERM") return false; }
  try { return /agents\/serve\.mjs/.test(execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" })); } catch { return false; }
}

const readPid = (file) => { try { return Number(JSON.parse(fs.readFileSync(file, "utf8")).pid); } catch { return NaN; } };

// -> { ok: true } (we hold it) | { ok: false, holder: pid } (another live serve holds it)
export function acquireLock(file, { pid = process.pid, alive = isServePid } = {}) {
  for (let i = 0; i < 2; i++) {
    try {
      const fd = fs.openSync(file, "wx");   // O_CREAT | O_EXCL
      fs.writeSync(fd, JSON.stringify({ pid, started: new Date().toISOString() }));
      fs.closeSync(fd);
      return { ok: true };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const holder = readPid(file);
      if (holder === pid) return { ok: true };
      if (Number.isInteger(holder) && holder > 0 && alive(holder)) return { ok: false, holder };
      try { fs.unlinkSync(file); } catch {}   // stale: take it over (one retry; a racing winner keeps it)
    }
  }
  return { ok: false, holder: readPid(file) };
}

// Release only our own lock.
export function releaseLock(file, { pid = process.pid } = {}) { if (readPid(file) === pid) try { fs.unlinkSync(file); } catch {} }
// Delete a state file only if it names our pid (.serve.json).
export function unlinkIfOurs(file, { pid = process.pid } = {}) { if (readPid(file) === pid) { try { fs.unlinkSync(file); return true; } catch {} } return false; }
