// Proposals ledger for the autonomous design loop (repo-root design-proposals.json, git-ignored).
// state: pending (CEO deciding) -> rejected | published | publish_failed. Caps count per Pacific day AND per Stripe
// mode, so sandbox test runs never use up the live store's daily allowance.
import path from "node:path";
import crypto from "node:crypto";
import { readJson, writeJson } from "../lib/state.mjs";

export const MAX_PROPOSALS_PER_DAY = () => Number(process.env.DESIGN_MAX_PROPOSALS_PER_DAY || 6);
export const MAX_PUBLISHES_PER_DAY = () => Number(process.env.DESIGN_MAX_PUBLISHES_PER_DAY || 6);
export const ptDay = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(d));

const file = (rootDir) => path.join(rootDir, "design-proposals.json");
export const loadProposals = (rootDir) => readJson(file(rootDir), { proposals: {} });
export const saveProposals = (rootDir, l) => writeJson(file(rootDir), l);
export const newProposalId = () => `prop_${crypto.randomBytes(5).toString("hex")}`;

export function proposalsToday(l, mode, now = new Date()) {
  // "abandoned" = never reached the CEO (a tool error), so it doesn't use up the day's allowance
  return Object.values(l.proposals).filter((p) => p.mode === mode && p.state !== "abandoned" && ptDay(p.proposed_at) === ptDay(now));
}
export function publishesToday(l, mode, now = new Date()) {
  return Object.values(l.proposals).filter((p) => p.mode === mode && p.publish?.published_at && ptDay(p.publish.published_at) === ptDay(now));
}
// The same design is never published twice in one mode, and never proposed twice while a proposal is open.
export const publishedDesign = (l, mode, design_id) => Object.values(l.proposals).find((p) => p.mode === mode && p.design_id === design_id && p.state === "published") || null;
export const openProposal = (l, mode, design_id) => Object.values(l.proposals).find((p) => p.mode === mode && p.design_id === design_id && ["pending", "publishing"].includes(p.state)) || null;
export const slugTaken = (l, mode, slug) => Object.values(l.proposals).some((p) => p.mode === mode && p.slug === slug && ["pending", "publishing", "published"].includes(p.state));

export function updateProposal(rootDir, id, patch) {
  const l = loadProposals(rootDir);
  if (!l.proposals[id]) throw new Error(`no proposal ${id}`);
  l.proposals[id] = { ...l.proposals[id], ...patch, updated_at: new Date().toISOString() };
  saveProposals(rootDir, l);
  return l.proposals[id];
}
