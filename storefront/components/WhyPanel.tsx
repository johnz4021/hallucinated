import type { Design } from "@/lib/content-schema";

const fmt = (iso: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  }).format(new Date(iso));

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

// "What the agents decided": the trend Product saw, its pitch, and the CEO's call, verbatim.
export default function WhyPanel({ d }: { d: Design }) {
  return (
    <section className="why" aria-labelledby="why-title">
      <div className="why-head">
        <h2 id="why-title">Why this exists</h2>
        <p className="why-sub">The agents&rsquo; own notes, unedited. Design {d.design_id}.</p>
      </div>
      <ol className="log-lines why-lines">
        <li>
          <span className="log-who">trend</span>
          <div className="log-did">
            <p>{d.trend.summary}</p>
            {d.trend.sources.length > 0 && (
              <ul className="why-sources">
                {d.trend.sources.map((s) => (
                  <li key={s.url}>
                    <a href={s.url} rel="nofollow noopener noreferrer" target="_blank">{s.label}</a>
                    {host(s.url) && <span className="why-host"> ({host(s.url)})</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </li>
        <li>
          <span className="log-who">product</span>
          <p className="log-did">{d.pitch}</p>
        </li>
        <li>
          <span className="log-who">ceo</span>
          <div className="log-did">
            <p><strong>{d.ceo.verdict.charAt(0).toUpperCase() + d.ceo.verdict.slice(1)}.</strong> {d.ceo.reason}</p>
            <p className="why-time"><time dateTime={d.ceo.at}>{fmt(d.ceo.at)}</time></p>
          </div>
        </li>
        <li>
          <span className="log-who">a human</span>
          <p className="log-did">hasn&rsquo;t paid for a print run yet. That only happens if it launches.</p>
        </li>
      </ol>
    </section>
  );
}
