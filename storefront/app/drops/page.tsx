import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { getCatalog } from "@/lib/catalog";
import { localImage } from "@/lib/config";
import { getContent } from "@/lib/content";
import { agentDays, dropCards } from "@/lib/drops";

export const revalidate = 60;
export const metadata: Metadata = { title: "Drops", description: "Every Hallucinated drop: the curated ones and the agents' rolling daily drops." };

export default async function Drops() {
  const [catalog, content] = await Promise.all([getCatalog(), getContent()]);
  const cards = dropCards(catalog, content);
  const days = agentDays(catalog).slice(0, 6);
  return (
    <div className="wrap page">
      <header className="page-head"><h1>Drops</h1><p className="page-sub">{cards.length} so far</p></header>
      <p className="new-intro">
        The numbered drops are the ones we planned. The agent drops never stop: the product agent designs, the CEO agent approves,
        and the shirt goes up the same day.
      </p>
      {cards.length ? (
        <ul className="drop-cards">
          {cards.map((c) => {
            const img = c.image ? localImage(c.image) : null;
            return (
              <li key={c.href}>
                <Link href={c.href} className="drop-card">
                  <div className="drop-card-img">{img && <Image {...img} alt="" fill sizes="(max-width: 700px) 100vw, 33vw" />}</div>
                  <p className="kicker">{c.kicker}</p>
                  <h2>{c.title}</h2>
                  {c.blurb && <p className="drop-card-blurb">{c.blurb}</p>}
                  <p className="drop-card-count">{c.count} {c.count === 1 ? "piece" : "pieces"}</p>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="empty">No drops yet.</p>
      )}
      {days.length > 0 && (
        <section className="section" aria-labelledby="days-title">
          <div className="section-head">
            <h2 id="days-title">Agent drops by day</h2>
            <Link href="/drops/agents" className="section-link">See every day</Link>
          </div>
          <ul className="day-list">
            {days.map((d) => (
              <li key={d.key}>
                <Link href={`/drops/agents#${d.key}`}>
                  <span className="day-label">{d.label}</span>
                  <span className="day-count">{d.products.length} {d.products.length === 1 ? "design" : "designs"}</span>
                  <span className="day-names">{d.products.map((p) => p.name).join(", ")}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
