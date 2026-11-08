// Unit checks for serve's single-instance lock (no network). node agents/serve_lock_test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { acquireLock, releaseLock, unlinkIfOurs, isServePid } from "./serve_lock.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lock-")), L = path.join(dir, ".serve.lock"), S = path.join(dir, ".serve.json");
const alive = (set) => (pid) => set.has(pid);
// first launch takes it; a second live launch is refused and changes nothing
assert.deepEqual(acquireLock(L, { pid: 100, alive: alive(new Set([100])) }), { ok: true });
assert.deepEqual(acquireLock(L, { pid: 200, alive: alive(new Set([100, 200])) }), { ok: false, holder: 100 });
assert.equal(JSON.parse(fs.readFileSync(L, "utf8")).pid, 100);
// re-acquire by the holder is fine; release by a non-holder does nothing
assert.equal(acquireLock(L, { pid: 100, alive: alive(new Set([100])) }).ok, true);
releaseLock(L, { pid: 200 }); assert.ok(fs.existsSync(L));
// stale (holder dead, or pid reused by a non-serve process): taken over
assert.deepEqual(acquireLock(L, { pid: 300, alive: alive(new Set([300])) }), { ok: true });
assert.equal(JSON.parse(fs.readFileSync(L, "utf8")).pid, 300);
releaseLock(L, { pid: 300 }); assert.ok(!fs.existsSync(L));
// garbage in the lock file counts as stale
fs.writeFileSync(L, "not json"); assert.equal(acquireLock(L, { pid: 400, alive: () => true }).ok, true);
console.log("lock: acquire / refuse / stale takeover / release: OK");
// .serve.json is only deleted by the serve it names
fs.writeFileSync(S, JSON.stringify({ url: "https://x", pid: 70062 }));
assert.equal(unlinkIfOurs(S, { pid: 71111 }), false); assert.ok(fs.existsSync(S));
assert.equal(unlinkIfOurs(S, { pid: 70062 }), true); assert.ok(!fs.existsSync(S));
console.log(".serve.json only removed by its own pid: OK");
// real process check: this test process is alive but not serve.mjs; a dead pid is not alive
assert.equal(isServePid(process.pid), false); assert.equal(isServePid(999999), false); assert.equal(isServePid(NaN), false);
console.log("isServePid: OK");
console.log("serve lock tests: all OK");
