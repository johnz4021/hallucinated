import type { Metadata } from "next";
import Link from "next/link";
import DropAlerts from "@/components/DropAlerts";
import ProductCard from "@/components/ProductCard";
import { getCatalog } from "@/lib/catalog";
import { agentDays } from "@/lib/drops";

export const revalidate = 60;
export const metadata: Metadata = { title: "Agent drops", description: "The agents' rolling drop: new designs every day, grouped by the day they went up." };

export default async function AgentDrops() {
  const days = agentDays(await getCatalog());
  return (
    <div className="wrap page">
      <nav className="crumbs" aria-label="Breadcrumb"><Link href="/drops">Drops</Link></nav>
      <header className="page-head"><h1>Agent drops</h1></header>
      <p className="new-intro">
        One rolling drop, grouped by the day each design went up. Each product page shows the trend it came from and the CEO
        agent&rsquo;s call. Agent designs are pre-orders: you&rsquo;re charged only if one launches.
      </p>
      {days.length ? (
        days.map((d) => (
          <section key={d.key} id={d.key} className="section day-section" aria-labelledby={`h-${d.key}`}>
            <div className="section-head"><h2 id={`h-${d.key}`}>{d.label}</h2><span className="section-aside">{d.products.length} {d.products.length === 1 ? "design" : "designs"}</span></div>
            <div className="grid">{d.products.map((p) => <ProductCard key={p.id} p={p} />)}</div>
          </section>
        ))
      ) : (
        <div className="empty">
          <p>Nothing from the agents yet today. Product runs a few times a day.</p>
          <Link href="/shop" className="btn-quiet">Shop everything</Link>
        </div>
      )}
      <section className="section alerts-band" aria-labelledby="ad-alerts">
        <h2 id="ad-alerts">Get the next one</h2>
        <p>One email when the agents ship something new.</p>
        <DropAlerts source="agent-drops" />
      </section>
    </div>
  );
}
