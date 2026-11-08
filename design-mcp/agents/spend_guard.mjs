// Spend guard: Naïve credits spent since Sat 13:00 PT (all org debits from the credits ledger: sessions, images, videos,
// proxy calls), or the hq publisher's agent_spend_usd if that's higher. Thresholds (each acted on once):
//   >= $100  flag_john
//   >= $175  Creative's video paused (ad_video_start refuses) and image variants cut to 1; flag_john
// State in <root>/spend-guard.json. checkSpend() is cached 5 min; Creative's tools call it before deciding, and serve can
// call it on a timer (startSpendGuard) so the flags fire even when nobody is making ads.
import path from "node:path";
import { createClient } from "@usenaive-sdk/vetta";
import { readJson, writeJson, envKey } from "../lib/state.mjs";
import { flagJohn } from "../agentmail/tools.mjs";

export const SPEND_SINCE = process.env.SPEND_SINCE || "2026-11-07T21:00:00.000Z";   // Sat 13:00 PT
export const FLAG_AT = () => Number(process.env.SPEND_FLAG_USD || 100);
export const CUT_AT = () => Number(process.env.SPEND_CUT_USD || 175);
const file = (rootDir) => path.join(rootDir, "spend-guard.json");
export const guardState = (rootDir) => readJson(file(rootDir), { since: SPEND_SINCE, ledger_micro: 0, last_at: null, crossed: {} });
export const videoPaused = (rootDir) => !!guardState(rootDir).crossed?.cut;
export const imageVariants = (rootDir) => (videoPaused(rootDir) ? 1 : Number(process.env.ADS_IMAGE_VARIANTS || 1));
// tries per concept (regenerations after a failed review): 3 normally, 1 once spend is over the cut line
export const maxAttempts = (rootDir) => (videoPaused(rootDir) ? 1 : 3);

// Pure: which thresholds a spend total newly crosses.
export function newCrossings(totalUsd, crossed = {}) {
  const out = [];
  if (totalUsd >= FLAG_AT() && !crossed.flag) out.push("flag");
  if (totalUsd >= CUT_AT() && !crossed.cut) out.push("cut");
  return out;
}

let lastCheck = 0, running = null;
export async function checkSpend({ rootDir, vettaKey, log = () => {}, force = false, client = null }) {
  if (!force && Date.now() - lastCheck < 5 * 60_000) return guardState(rootDir);
  if (running) return running;
  running = (async () => {
    const v = client || createClient({ baseUrl: "https://api.vetta.sh", apiKey: vettaKey || envKey(rootDir, "VETTA_API_KEY") });   // client: tests
    const st = guardState(rootDir);
    // newest first: read until we reach what we already counted (or the start)
    const stopAt = st.last_at || st.since;
    let add = 0, newest = st.last_at, after;
    for (let page = 0; page < 200; page++) {
      const r = await v.credits.ledger({ limit: 100, ...(after ? { after } : {}) });
      let done = false;
      for (const e of r.data || []) {
        if (e.created_at <= stopAt) { done = true; break; }
        if (!newest || e.created_at > newest) newest = e.created_at;
        const amt = e.amount_micro_usd ?? e.amount ?? 0;
        if (amt < 0) add += -amt;
      }
      if (done || !r.has_more) break;
      after = r.next_cursor;
    }
    st.ledger_micro = (st.ledger_micro || 0) + add; st.last_at = newest || st.last_at;
    const hq = readJson(path.join(rootDir, "hq.json"), null);
    const hqUsd = Number(hq?.counters?.agent_spend_usd ?? hq?.agent_spend_usd ?? 0) || 0;   // hq publisher: session spend only
    st.total_usd = Math.round(Math.max(st.ledger_micro / 1e6, hqUsd) * 100) / 100;
    st.checked_at = new Date().toISOString();
    for (const c of newCrossings(st.total_usd, st.crossed)) {
      st.crossed = { ...st.crossed, [c]: new Date().toISOString() };
      if (c === "flag") { log(`[spend] crossed $${FLAG_AT()} (now $${st.total_usd} since Sat 13:00 PT)`); flagJohn({ rootDir, log }, { reason: "money", from_agent: "spend guard", summary: `Naïve spend since Sat 13:00 PT is $${st.total_usd} (flag threshold $${FLAG_AT()}). Nothing changed yet; at $${CUT_AT()} Creative's video pauses and image variants drop to 1.` }); }
      if (c === "cut") { log(`[spend] crossed $${CUT_AT()} (now $${st.total_usd}): Creative video paused, variants 1`); flagJohn({ rootDir, log }, { reason: "money", from_agent: "spend guard", summary: `Naïve spend since Sat 13:00 PT is $${st.total_usd}, over $${CUT_AT()}: Creative's video ads are paused and image variants cut to 1. Edit spend-guard.json (crossed.cut) to undo.` }); }
    }
    writeJson(file(rootDir), st);
    lastCheck = Date.now();
    return st;
  })().finally(() => { running = null; });
  return running;
}

// For serve: check every 5 min (one line logged only when a threshold is crossed).
export function startSpendGuard({ rootDir, vettaKey, log }) {
  const tick = () => checkSpend({ rootDir, vettaKey, log, force: true }).catch((e) => log(`[spend] check failed: ${String(e.message).slice(0, 160)}`));
  tick();
  return setInterval(tick, 5 * 60_000);
}
