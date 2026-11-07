import type { Metadata } from "next";
import Link from "next/link";
import ProductCard from "@/components/ProductCard";
import { getCatalog } from "@/lib/catalog";
import { config } from "@/lib/config";

export const metadata: Metadata = { title: "Shop" };

const AVAIL = [
  { slug: "all", label: "All" },
  { slug: "live", label: "In stock" },
  { slug: "preorder", label: "Pre-order" },
  { slug: "agents", label: "Designed by the agents" },
];

export default async function Shop({ searchParams }: { searchParams: Promise<{ category?: string; availability?: string }> }) {
  const { category = "all", availability = "all" } = await searchParams;
  const catalog = await getCatalog();
  const items = catalog.filter(
    (p) => (category === "all" || p.category === category) && (availability === "all" || (availability === "agents" ? p.origin === "agents" : p.status === availability)),
  );
  const label = config.categories.find((c) => c.slug === category)?.label ?? "Everything";
  const href = (c: string, a: string) => {
    const q = new URLSearchParams();
    if (c !== "all") q.set("category", c);
    if (a !== "all") q.set("availability", a);
    const s = q.toString();
    return s ? `/shop?${s}` : "/shop";
  };

  return (
    <div className="wrap page">
      <header className="page-head">
        <h1>{label}</h1>
        <p className="page-sub">{items.length} {items.length === 1 ? "piece" : "pieces"}</p>
      </header>
      <nav className="filters" aria-label="Filter">
        <div className="chips" role="list" aria-label="Category">
          {[{ slug: "all", label: "Everything" }, ...config.categories].map((c) => (
            <Link key={c.slug} role="listitem" href={href(c.slug, availability)} className="chip" aria-current={category === c.slug ? "true" : undefined}>
              {c.label}
            </Link>
          ))}
        </div>
        <div className="chips" role="list" aria-label="Availability">
          {AVAIL.map((a) => (
            <Link key={a.slug} role="listitem" href={href(category, a.slug)} className="chip chip-quiet" aria-current={availability === a.slug ? "true" : undefined}>
              {a.label}
            </Link>
          ))}
        </div>
      </nav>
      {items.length ? (
        <div className="grid">
          {items.map((p, n) => <ProductCard key={p.id} p={p} priority={n < 2} />)}
        </div>
      ) : (
        <div className="empty">
          <p>Nothing here yet. The agents are working on it.</p>
          <Link href="/shop" className="btn-quiet">Shop everything</Link>
        </div>
      )}
    </div>
  );
}
