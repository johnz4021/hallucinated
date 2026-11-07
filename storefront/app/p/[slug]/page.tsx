import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Gallery from "@/components/Gallery";
import ProductBuy from "@/components/ProductBuy";
import ProductCard from "@/components/ProductCard";
import SizeGuide from "@/components/SizeGuide";
import { dropNumber, getCatalog, getProduct } from "@/lib/catalog";
import { config, formatPrice } from "@/lib/config";

export const revalidate = 60;
export const dynamicParams = true;

export async function generateStaticParams() {
  // Pages for products added later render on first visit (dynamicParams).
  return (await getCatalog().catch(() => [])).map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const p = await getProduct((await params).slug);
  if (!p) return { title: "Not found" };
  return { title: p.name, description: p.description, openGraph: { images: p.images.slice(0, 1) } };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const p = await getProduct((await params).slug);
  if (!p) notFound();
  const cat = config.categories.find((c) => c.slug === p.category);
  const n = dropNumber(p.drop);
  const more = (await getCatalog()).filter((x) => x.slug !== p.slug).slice(0, 4);
  const prices = [...new Set(p.variants.map((v) => v.unitAmount))];

  return (
    <div className="wrap page">
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/shop">Shop</Link>
        {cat && <> / <Link href={`/shop?category=${cat.slug}`}>{cat.label}</Link></>}
      </nav>
      <div className="pdp">
        <Gallery images={p.images} name={p.name} />
        <div className="pdp-info">
          {p.status === "preorder" ? (
            <p className="kicker"><span className="badge inline">Pre-order</span> {p.launchWindow ? `Est. ${p.launchWindow}` : ""}</p>
          ) : (
            <p className="kicker">{n ? `Drop ${n}, in stock` : "In stock"}</p>
          )}
          <h1 className="pdp-name">{p.name}</h1>
          <p className="pdp-price">{prices.length === 1 ? formatPrice(prices[0]) : `From ${formatPrice(Math.min(...prices))}`}</p>
          <ProductBuy
            slug={p.slug}
            name={p.name}
            image={p.images[0] ?? null}
            kind={p.status}
            launchWindow={p.launchWindow}
            variants={p.variants.map(({ priceId, size, unitAmount }) => ({ priceId, size, unitAmount }))}
            fulfilment={config.fulfilment}
          />
          <div className="pdp-details">
            <p>{p.description}</p>
            {p.features.length > 0 && (
              <ul className="features">
                {p.features.map((f) => <li key={f}>{f}</li>)}
              </ul>
            )}
            {p.garment === "tee" && <SizeGuide />}
            <details>
              <summary>Who made this</summary>
              <p>
                {p.status === "live"
                  ? `Designed by our product agent (design ${p.designId}), approved by the CEO agent and ordered from an SF print shop by the ops agent. A human paid for the print run.`
                  : "Our wordmark, put on new blanks by the agents for drop 2. The ops agent orders the run once pre-orders are in; a human approves the spend."}
              </p>
            </details>
            <details>
              <summary>{p.status === "preorder" ? "Pre-orders and pickup" : "Pickup and shipping"}</summary>
              <p>
                {p.status === "preorder"
                  ? `Your card is saved at checkout and charged when the drop launches${p.launchWindow ? ` (est. ${p.launchWindow})` : ""}. If it never launches, you're never charged. To cancel before launch, email ${config.contactEmail}. `
                  : ""}
                {config.fulfilment}. No shipping yet.
              </p>
            </details>
          </div>
        </div>
      </div>
      {more.length > 0 && (
        <section className="section" aria-labelledby="more-title">
          <div className="section-head"><h2 id="more-title">More from Hallucinated</h2></div>
          <div className="grid">{more.map((x) => <ProductCard key={x.id} p={x} />)}</div>
        </section>
      )}
    </div>
  );
}
