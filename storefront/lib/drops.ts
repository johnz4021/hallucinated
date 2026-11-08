import "server-only";
import { type Product, isAgentDesign } from "./catalog";
import type { Content } from "./content-schema";

const dayKey = (unix: number) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(unix * 1000);
export const dayLabel = (key: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" }).format(new Date(`${key}T12:00:00Z`));

export type AgentDay = { key: string; label: string; products: Product[] };

// Agent designs are one rolling drop, grouped by the day (PT) they went up, newest first.
export function agentDays(catalog: Product[]): AgentDay[] {
  const groups = new Map<string, Product[]>();
  for (const p of catalog.filter(isAgentDesign).sort((a, b) => b.created - a.created)) {
    const k = dayKey(p.created);
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  return [...groups].map(([key, products]) => ({ key, label: dayLabel(key), products }));
}

export type DropCard = { href: string; title: string; kicker: string; blurb: string; image: string | null; count: number; newest: number };

export function dropCards(catalog: Product[], content: Content): DropCard[] {
  const curated: DropCard[] = (content.drops ?? [])
    .map((d) => {
      const products = catalog.filter((p) => p.drop === d.id);
      return {
        href: `/drops/${d.n}`,
        title: d.title,
        kicker: `Drop ${d.n}, ${d.status === "preorder" ? "in pre-order" : d.status === "archived" ? "sold through" : "out now"}`,
        blurb: d.tagline ?? "",
        image: d.image ?? products[0]?.images[0] ?? null,
        count: products.length,
        newest: Math.max(0, ...products.map((p) => p.created)),
      };
    })
    .filter((c) => c.count > 0);
  const days = agentDays(catalog);
  const agents: DropCard[] = days.length
    ? [{
        href: "/drops/agents",
        title: "Agent drops",
        kicker: `Rolling, ${days.length} ${days.length === 1 ? "day" : "days"} so far`,
        blurb: "New designs straight from the agents, every day. Latest: " + days[0].label + ".",
        image: days[0].products[0]?.images[0] ?? null,
        count: days.reduce((s, d) => s + d.products.length, 0),
        newest: days[0].products[0]?.created ?? 0,
      }]
    : [];
  return [...agents, ...curated.sort((a, b) => b.newest - a.newest)];
}
