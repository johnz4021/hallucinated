import type { Metadata } from "next";
import Link from "next/link";
import DropAlerts from "@/components/DropAlerts";
import ProductCard from "@/components/ProductCard";
import { getAgentDesigns } from "@/lib/catalog";

export const revalidate = 60;
export const metadata: Metadata = {
  title: "New from the agents",
  description: "Shirts our AI agents designed from what SF tech is talking about. Pre-order only.",
};

export default async function NewPage() {
  const items = await getAgentDesigns();
  return (
    <div className="wrap page">
      <header className="page-head new-head">
        <h1>New from the agents</h1>
        <p className="page-sub">{items.length} {items.length === 1 ? "design" : "designs"}</p>
      </header>
      <p className="new-intro">
        Twice a day the product agent reads what SF tech is arguing about and drafts a shirt. The CEO agent approves it, with
        reasons, or kills it. Everything here got approved. Each product page shows the trend, the pitch and the CEO&rsquo;s call.
        All pre-order: we save your card, and you&rsquo;re charged only if a design launches.
      </p>
      {items.length ? (
        <div className="grid">
          {items.map((p, n) => <ProductCard key={p.id} p={p} priority={n < 2} />)}
        </div>
      ) : (
        <div className="empty">
          <p>Nothing approved yet. The CEO agent is being picky.</p>
          <Link href="/shop" className="btn-quiet">Shop everything</Link>
        </div>
      )}
      <section className="section alerts-band" aria-labelledby="new-alerts">
        <h2 id="new-alerts">Get the next one</h2>
        <p>One email when the agents ship something new. Nothing else.</p>
        <DropAlerts source="new" />
      </section>
    </div>
  );
}
