import Link from "next/link";
import type { Campaign } from "@/lib/content-schema";

// "As seen in": the agents' ads that feature this product. Hidden when there are none.
export default function SeenIn({ ads }: { ads: Campaign[] }) {
  if (!ads.length) return null;
  return (
    <section className="section seen-in" aria-labelledby="seen-title">
      <div className="section-head">
        <h2 id="seen-title">As seen in</h2>
        <Link href="/campaigns" className="section-link">All the ads the agents made</Link>
      </div>
      <ul className="seen-list">
        {ads.map((c) => {
          const img = c.kind === "video" ? c.poster_url : c.media_url;
          const inner = (
            <>
              <div className="seen-img">
                {img ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={img} alt={`Ad: ${c.caption}`} loading="lazy" decoding="async" />
                ) : (
                  <span>Video ad</span>
                )}
                {c.kind === "video" && <span className="badge seen-video">Video</span>}
              </div>
              <p className="seen-caption">{c.caption}</p>
              <span className="seen-where">{c.x_url ? "See the post on X" : "See it with the other ads"}</span>
            </>
          );
          return (
            <li key={c.id}>
              {c.x_url ? (
                <a href={c.x_url} className="seen-item" rel="noopener noreferrer" target="_blank">{inner}</a>
              ) : (
                <Link href="/campaigns" className="seen-item">{inner}</Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
