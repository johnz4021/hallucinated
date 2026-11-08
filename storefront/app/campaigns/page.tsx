import type { Metadata } from "next";
import Link from "next/link";
import AdVideo from "@/components/AdVideo";
import { getCatalog } from "@/lib/catalog";
import { getContent, visibleCampaigns } from "@/lib/content";

export const revalidate = 60;
export const metadata: Metadata = {
  title: "Ads, by the agents",
  description: "Ads our creative agent made about the SF tech moment. A vision reviewer passed every one.",
};

const when = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export default async function Campaigns() {
  const [content, catalog] = await Promise.all([getContent(), getCatalog()]);
  const ads = visibleCampaigns(content);
  const products = new Map(catalog.map((p) => [p.slug, p]));

  return (
    <div className="wrap page">
      <header className="page-head"><h1>Ads, by the agents</h1><p className="page-sub">{ads.length} so far</p></header>
      <p className="new-intro">
        Our creative agent writes and makes these about whatever SF tech is doing this week. A second agent looks at each one before it
        goes up, and Growth posts them on X. Nobody here approved the jokes individually. The people in them aren&rsquo;t real.
      </p>
      {ads.length ? (
        <ul className="ad-wall">
          {ads.map((c) => {
            const product = c.featured_products.map((s) => products.get(s)).find(Boolean);
            return (
              <li key={c.id} className="ad">
                <div className="ad-frame">
                  {c.kind === "video" ? (
                    <AdVideo src={c.media_url} poster={c.poster_url} label={`Video ad: ${c.caption}`} />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img className="ad-media" src={c.media_url} alt={`Ad: ${c.caption}`} loading="lazy" decoding="async" />
                  )}
                  {c.test && <span className="badge ad-test">Test</span>}
                </div>
                <p className="ad-caption">{c.caption}</p>
                <p className="ad-concept"><span className="ad-label">The agent&rsquo;s note</span> {c.concept}</p>
                {c.event && c.sources.length > 0 && (
                  <div className="ad-sources">
                    <span className="ad-label">Reacting to</span>
                    <ul>
                      {c.sources.map((s) => (
                        <li key={s.url}>
                          <a href={s.url} rel="nofollow noopener noreferrer" target="_blank">{s.label}</a>
                          {host(s.url) && <span className="why-host"> ({host(s.url)})</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <p className="ad-meta">
                  <time dateTime={c.created_at}>{when(c.created_at)}</time>
                  {product && <>. Shirt: <Link href={`/p/${product.slug}`}>{product.name}</Link></>}
                  {c.x_url && <>. <a href={c.x_url} rel="noopener noreferrer" target="_blank">See the post on X</a></>}
                </p>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty">
          <p>No ads yet. The creative agent is still workshopping.</p>
          <Link href="/new" className="btn-quiet">See the agents&rsquo; designs</Link>
        </div>
      )}
    </div>
  );
}
