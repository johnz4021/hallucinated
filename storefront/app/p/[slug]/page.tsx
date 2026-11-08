import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Gallery from "@/components/Gallery";
import ProductBuy from "@/components/ProductBuy";
import ProductCard from "@/components/ProductCard";
import SizeGuide from "@/components/SizeGuide";
import WhyPanel from "@/components/WhyPanel";
import SeenIn from "@/components/SeenIn";
import { dropNumber, getCatalog, getProduct, isAgentDesign } from "@/lib/catalog";
import { config, formatPrice, shipping, windowLabel } from "@/lib/config";
import { getContent, visibleCampaigns } from "@/lib/content";

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
  const agent = isAgentDesign(p);
  // A dossier shows only for a product that exists in this deployment's own catalog (we're on its page).
  const dossier = agent ? ((await getContent()).designs ?? []).find((d) => d.slug === p.slug) ?? null : null;
  const when = windowLabel(p.launchWindow);
  const seenIn = visibleCampaigns(await getContent()).filter((c) => c.featured_products.includes(p.slug)).slice(0, 3);

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
            <p className="kicker">
              {agent && <span className="badge inline badge-agents">Designed by the agents</span>}
              <span className="badge inline">Pre-order</span> {when ?? ""}
            </p>
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
            agent={agent}
            shippingLine={shipping.oneLiner()}
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
                {agent
                  ? `The product agent spotted a trend, designed this (design ${p.designId}) and pitched it; the CEO agent approved it. Nobody has printed it yet: the ops agent orders a run only if it launches, and a human approves that spend.`
                  : p.status === "live"
                    ? `Designed by our product agent (design ${p.designId}), approved by the CEO agent and ordered from an SF print shop by the ops agent. A human paid for the print run.`
                    : "Our wordmark, put on new blanks by the agents for drop 2. The ops agent orders the run once pre-orders are in; a human approves the spend."}
              </p>
            </details>
            {p.status === "preorder" && (
              <details>
                <summary>How pre-orders work</summary>
                <p>
                  Your card is saved at checkout and charged only if it launches{when ? ` (${when.toLowerCase()})` : ""}. If it never
                  launches, you&rsquo;re never charged. To cancel before launch, email {config.contactEmail}.
                </p>
              </details>
            )}
            <details>
              <summary>Shipping &amp; pickup</summary>
              <ul className="ship-list">
                <li>US shipping: {shipping.flat()} flat, free on orders over {shipping.freeOver()}. Ships within {shipping.days()}{p.status === "preorder" ? " of launch" : ""}, with tracking by email.</li>
                <li>Pickup in San Francisco: free. We email the address and a pickup window.</li>
                <li>Outside the US: {config.shipping.international}</li>
                {p.status === "preorder" && <li>Pre-orders: Checkout can&rsquo;t take a shipping choice for something you pay for later, so we&rsquo;ll ask whether you want shipping or pickup before we charge at launch.</li>}
                <li>Wrong size? Exchange it within {config.shipping.returns_days} days. Anything wrong with the shirt: full refund. <Link href="/info#returns">Returns</Link></li>
              </ul>
            </details>
          </div>
        </div>
      </div>
      {dossier && <WhyPanel d={dossier} />}
      <SeenIn ads={seenIn} />
      {more.length > 0 && (
        <section className="section" aria-labelledby="more-title">
          <div className="section-head"><h2 id="more-title">More from Hallucinated</h2></div>
          <div className="grid">{more.map((x) => <ProductCard key={x.id} p={x} />)}</div>
        </section>
      )}
    </div>
  );
}
