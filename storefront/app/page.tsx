import Image from "next/image";
import Link from "next/link";
import DropAlerts from "@/components/DropAlerts";
import Hero from "@/components/Hero";
import ProductCard from "@/components/ProductCard";
import { getCatalog } from "@/lib/catalog";
import { config, formatPrice } from "@/lib/config";
import { activeSorted, getContent } from "@/lib/content";

export const revalidate = 60;

const LOG = [
  { who: "product", did: "designed the back: > git reset --hard over a line-art map of SF (design bc1dbe9d9aae), then ran it through its own print check until it passed" },
  { who: "ceo", did: "approved it, in writing, with reasons" },
  { who: "ops", did: "uploaded the front and back to a print shop on 20th Ave, placed them to the inch and checked out four black tees" },
  { who: "a human", did: "paid. The agents don't get a card yet." },
];

export default async function Home() {
  const [catalog, content] = await Promise.all([getCatalog(), getContent()]);
  const banners = activeSorted(content.banners).slice(0, 3);
  const lookbook = activeSorted(content.lookbook);
  const featured = catalog.find((p) => p.status === "live") ?? catalog[0];
  const featuredDrop = content.drops.find((d) => d.id === featured?.drop);
  const preorders = catalog.filter((p) => p.status === "preorder");
  const cats = config.categories
    .map((c) => ({ ...c, items: catalog.filter((p) => p.category === c.slug) }))
    .filter((c) => c.items.length);

  return (
    <>
      <Hero banners={banners} />

      {featured && (
        <section className="feature wrap" aria-labelledby="feature-title">
          <div className="feature-img">
            {(lookbook[0]?.image ?? featured.images[2] ?? featured.images[0]) && (
              <Image src={lookbook[0]?.image ?? featured.images[0]} alt={lookbook[0]?.alt ?? featured.name} fill sizes="(max-width: 900px) 100vw, 50vw" />
            )}
          </div>
          <div className="feature-copy">
            <p className="kicker">{featuredDrop ? `Drop ${featuredDrop.n}, out now` : "Out now"}</p>
            <h2 id="feature-title" className="mono-title">
              <span className="prompt" aria-hidden="true">&gt;</span> <span className="nw">git reset</span> <span className="nw">--hard</span>
            </h2>
            <p className="feature-pitch">{featured.description}</p>
            <p className="feature-price">{featured.priceFrom != null && formatPrice(featured.priceFrom)}</p>
            <div className="feature-actions">
              <Link href={`/p/${featured.slug}`} className="btn">Shop the tee</Link>
              {featuredDrop && <Link href={`/drops/${featuredDrop.n}`} className="btn-quiet">See drop {featuredDrop.n}</Link>}
            </div>
          </div>
        </section>
      )}

      {preorders.length > 0 && (
        <section className="wrap section" aria-labelledby="pre-title">
          <div className="section-head">
            <h2 id="pre-title">Drop 2, in pre-order</h2>
            <Link href="/drops/2" className="section-link">See the drop</Link>
          </div>
          <div className="grid">
            {preorders.map((p) => <ProductCard key={p.id} p={p} />)}
          </div>
        </section>
      )}

      <section className="wrap section" aria-labelledby="cat-title">
        <div className="section-head">
          <h2 id="cat-title">Shop by category</h2>
          <Link href="/shop" className="section-link">Shop everything</Link>
        </div>
        <div className="cats">
          {cats.map((c) => (
            <Link key={c.slug} href={`/shop?category=${c.slug}`} className="cat">
              <div className="cat-img">
                {c.items[0].images[0] && <Image src={c.items[0].images[0]} alt="" fill sizes="(max-width: 700px) 50vw, 25vw" />}
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

      <section className="wrap section log" aria-labelledby="log-title">
        <div className="log-head">
          <h2 id="log-title">How this shirt happened</h2>
          <p className="log-intro">
            Hallucinated is run by AI agents. A product agent designs, a CEO agent approves or kills, an ops agent orders from the
            print shop and a growth agent posts. A person steps in where money moves.
          </p>
          <a href={config.xUrl} className="section-link">Watch them work on X</a>
        </div>
        <ol className="log-lines">
          {LOG.map((l) => (
            <li key={l.who}>
              <span className="log-who">{l.who}</span>
              <span className="log-did">{l.did}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="wrap section alerts-band" aria-labelledby="alerts-title">
        <h2 id="alerts-title">The agents ship when they ship.</h2>
        <p>Get one email when a drop goes live or opens for pre-order.</p>
        <DropAlerts source="home" />
      </section>
    </>
  );
}
