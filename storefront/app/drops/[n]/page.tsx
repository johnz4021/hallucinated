import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import DropAlerts from "@/components/DropAlerts";
import ProductCard from "@/components/ProductCard";
import { getCatalog } from "@/lib/catalog";
import { activeSorted, getContent } from "@/lib/content";

export const revalidate = 60;

async function load(n: string) {
  const [content, catalog] = await Promise.all([getContent(), getCatalog()]);
  const id = `drop-${Number(n)}`;
  const drop = content.drops.find((d) => d.id === id);
  const products = catalog.filter((p) => p.drop === id);
  if (!drop && !products.length) return null;
  return { drop, products, lookbook: activeSorted(content.lookbook).filter((l) => l.drop === id), n: Number(n) };
}

export async function generateMetadata({ params }: { params: Promise<{ n: string }> }): Promise<Metadata> {
  const d = await load((await params).n);
  return { title: d ? `Drop ${d.n}${d.drop ? `: ${d.drop.title}` : ""}` : "Not found" };
}

export default async function DropPage({ params }: { params: Promise<{ n: string }> }) {
  const d = await load((await params).n);
  if (!d) notFound();
  const status = d.drop?.status ?? (d.products.every((p) => p.status === "preorder") ? "preorder" : "live");
  return (
    <div className="page">
      <header className="drop-hero">
        {d.drop?.image && (
          <div className="drop-hero-img"><Image src={d.drop.image} alt="" fill priority sizes="100vw" /></div>
        )}
        <div className="drop-hero-copy wrap">
          <p className="kicker">
            Drop {d.n}, {status === "preorder" ? "in pre-order" : status === "archived" ? "sold through" : "out now"}
          </p>
          <h1 className={d.n === 1 ? "mono-title big" : "drop-title"}>
            {d.n === 1 ? <><span className="prompt" aria-hidden="true">&gt;</span> {d.drop?.title}</> : d.drop?.title ?? `Drop ${d.n}`}
          </h1>
          {d.drop?.tagline && <p className="drop-tagline">{d.drop.tagline}</p>}
        </div>
      </header>
      <div className="wrap">
        {d.drop?.description && <p className="drop-desc">{d.drop.description}</p>}
        <section className="section" aria-label="Pieces">
          <div className="grid">{d.products.map((p, i) => <ProductCard key={p.id} p={p} priority={i < 2} />)}</div>
        </section>
        {d.lookbook.length > 0 && (
          <section className="section" aria-labelledby="dlb">
            <div className="section-head"><h2 id="dlb">Lookbook</h2><span className="section-aside">AI-generated imagery.</span></div>
            <div className="drop-lb">
              {d.lookbook.map((l) => (
                <figure key={l.id}>
                  <div className="lb-img"><Image src={l.image} alt={l.alt} fill sizes="(max-width: 700px) 50vw, 33vw" /></div>
                  {l.caption && <figcaption>{l.caption}</figcaption>}
                </figure>
              ))}
            </div>
          </section>
        )}
        {status === "preorder" && (
          <section className="section alerts-band" aria-labelledby="da">
            <h2 id="da">Not ready to pre-order?</h2>
            <p>Get one email when drop {d.n} launches.</p>
            <DropAlerts source={`drop-${d.n}`} />
          </section>
        )}
        <p className="back-row"><Link href="/shop" className="section-link">Shop everything</Link></p>
      </div>
    </div>
  );
}
