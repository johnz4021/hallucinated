import Image from "next/image";
import Link from "next/link";
import DropAlerts from "@/components/DropAlerts";
import Hero from "@/components/Hero";
import ProductCard from "@/components/ProductCard";
import { getCatalog, isAgentDesign } from "@/lib/catalog";
import { config } from "@/lib/config";
import { activeSorted, getContent, visibleCampaigns } from "@/lib/content";
import { localImage } from "@/lib/config";
import type { Banner } from "@/lib/content-schema";

export const revalidate = 60;

// The generic pipeline every piece goes through. Live proof is on /hq.
const PIPELINE = [
  { who: "trend", did: "The product agent reads what SF tech is arguing about this week." },
  { who: "product", did: "It designs a two-sided tee: our wordmark on the front, the joke on the back, then checks its own print file." },
  { who: "ceo", did: "The CEO agent approves it or kills it, and writes down why." },
  { who: "store", did: "Approved designs go up here, usually as pre-orders: you're charged only if one launches." },
  { who: "growth", did: "The growth agent makes the ads and posts them on X." },
  { who: "ops", did: "Paid orders are batched into a print run; a human pays the print shop and approves the courier." },
];
// Hero headlines: no trailing hashtags, at most ~70 chars cut at a word. Full captions live on /campaigns.
function heroCaption(caption: string, max = 70) {
  const clean = caption.replace(/(\s+#[\w-]+)+\s*$/u, "").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max + 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > 30 ? cut.slice(0, at) : clean.slice(0, max)).replace(/[\s,.;:—–-]+$/u, "")}…`;
}

export default async function Home() {
  const [catalog, content] = await Promise.all([getCatalog(), getContent()]);
  const live = new Set(catalog.map((p) => p.slug));
  // Hero: the newest 1-3 agent ads first, then the curated banners (test ads only off production).
  const adSlides: Banner[] = visibleCampaigns(content)
    .filter((c) => c.kind === "image")
    .slice(0, 3)
    .map((c) => {
      const slug = c.featured_products.find((s) => live.has(s));
      return {
        id: `ad-${c.id}`,
        title: heroCaption(c.caption),
        image: c.media_url,
        image_alt: `Ad by the agents: ${c.caption}`,
        cta_label: slug ? "Shop the shirt" : "See all the ads",
        cta_href: slug ? `/p/${slug}` : "/campaigns",
        focus: "right",
        fit: "contain",
        kicker: c.test ? "Ad by the agents (test)" : "Ad by the agents",
      };
    });
  const banners = [...adSlides, ...activeSorted(content.banners).slice(0, 3)];
  const lookbook = activeSorted(content.lookbook);
  const latest = [...catalog].sort((a, b) => b.created - a.created).slice(0, 6);
  const agentCount = catalog.filter(isAgentDesign).length;
  // Newest CEO verdict on a design that is actually in this deployment's catalog.
  const verdict = (content.designs ?? [])
    .filter((d) => live.has(d.slug) && d.ceo?.reason)
    .sort((a, b) => Date.parse(b.ceo.at) - Date.parse(a.ceo.at))[0];
  const verdictProduct = verdict ? catalog.find((p) => p.slug === verdict.slug) : undefined;
  const cats = config.categories
    .map((c) => ({ ...c, items: catalog.filter((p) => p.category === c.slug).sort((a, b) => b.created - a.created) }))
    .filter((c) => c.items.length);

  return (
    <>
      <Hero banners={banners} />

      <section className="wrap section latest" aria-labelledby="latest-title">
        <div className="section-head">
          <div>
            <h2 id="latest-title">This week from the agents</h2>
            <p className="section-note">
              The newest pieces across every drop. {agentCount > 0 ? `${agentCount} of the designs in the shop came straight from the agents.` : ""}
            </p>
          </div>
          <Link href="/shop" className="section-link">Shop everything</Link>
        </div>
        {latest.length ? (
          <div className="grid">{latest.map((p, n) => <ProductCard key={p.id} p={p} priority={n < 2} />)}</div>
        ) : (
          <p className="empty">The shelves are empty right now. The agents are working on it.</p>
        )}
        <p className="latest-links">
          <Link href="/drops" className="btn-quiet">Browse all drops</Link>
          <Link href="/new" className="btn-quiet">Everything the agents designed</Link>
        </p>
      </section>

      <section className="wrap section" aria-labelledby="cat-title">
        <div className="section-head">
          <h2 id="cat-title">Shop by category</h2>
          <Link href="/shop" className="section-link">Shop everything</Link>
        </div>
        <div className="cats">
          {cats.map((c) => (
            <Link key={c.slug} href={`/shop?category=${c.slug}`} className="cat">
              <div className="cat-img">
                {c.items[0].images[0] && <Image {...localImage(c.items[0].images[0])} alt="" fill sizes="(max-width: 700px) 50vw, 25vw" />}
              </div>
              <span className="cat-label">{c.label}</span>
              <span className="cat-count">{c.items.length} {c.items.length === 1 ? "piece" : "pieces"}</span>
            </Link>
          ))}
        </div>
      </section>

      {lookbook.length > 0 && (
        <section className="section lookbook" aria-labelledby="lb-title">
          <div className="wrap section-head">
            <h2 id="lb-title">Lookbook</h2>
            <span className="section-aside">AI-generated, like everything else here except the shirts.</span>
          </div>
          <ul className="lb-strip">
            {lookbook.map((l) => (
              <li key={l.id}>
                <Link href={l.product_slug ? `/p/${l.product_slug}` : "/shop"} className="lb-item">
                  <div className="lb-img"><Image src={l.image} alt={l.alt} fill sizes="(max-width: 700px) 70vw, 22vw" /></div>
                  {l.caption && <span className="lb-cap">{l.caption}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="wrap section log how" aria-labelledby="how-title">
        <div className="log-head">
          <h2 id="how-title">How this store works</h2>
          <p className="log-intro">
            Hallucinated is a clothing company run by AI agents. They find the joke, design the shirt, decide whether it ships,
            put it on sale and post the ads. A person steps in where money moves.
          </p>
          <Link href="/hq" className="section-link">Watch them work, live</Link>
        </div>
        <div>
          <ol className="log-lines">
            {PIPELINE.map((l) => (
              <li key={l.who}>
                <span className="log-who">{l.who}</span>
                <span className="log-did">{l.did}</span>
              </li>
            ))}
          </ol>
          {verdict && (
            <figure className="how-verdict">
              <blockquote>&ldquo;{verdict.ceo.reason.replace(/^["“]+|["”]+$/g, "")}&rdquo;</blockquote>
              <figcaption>
                The CEO agent on{" "}
                {verdictProduct ? <Link href={`/p/${verdict.slug}`}>{verdictProduct.name}</Link> : verdict.title}, its latest call.
              </figcaption>
            </figure>
          )}
        </div>
      </section>

      <section className="wrap section alerts-band" aria-labelledby="alerts-title">
        <h2 id="alerts-title">The agents ship when they ship.</h2>
        <p>Get one email when a drop goes live or opens for pre-order.</p>
        <DropAlerts source="home" />
      </section>
    </>
  );
}
