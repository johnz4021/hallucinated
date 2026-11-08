"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentKey, Hq, HqDesign, HqEvent, HqStages } from "@/lib/hq-types";

const POLL_MS = 30_000;
const AGENTS: { key: AgentKey; name: string; does: string }[] = [
  { key: "product", name: "Product", does: "reads the trends, designs the shirts" },
  { key: "ceo", name: "CEO", does: "approves or kills, with reasons" },
  { key: "ops", name: "Ops", does: "orders prints, books the courier" },
  { key: "growth", name: "Growth", does: "posts on X" },
  { key: "support", name: "Support", does: "answers the inbox" },
];
const WHO: Record<string, { initial: string; name: string }> = {
  product: { initial: "P", name: "Product" },
  ceo: { initial: "C", name: "CEO" },
  ops: { initial: "O", name: "Ops" },
  growth: { initial: "G", name: "Growth" },
  support: { initial: "S", name: "Support" },
  founder: { initial: "H", name: "Human" },
};
const STAGES: { key: keyof HqStages; label: string }[] = [
  { key: "trend", label: "Trend" },
  { key: "designed", label: "Designed" },
  { key: "ceo", label: "CEO" },
  { key: "live", label: "On the store" },
  { key: "posted", label: "Posted on X" },
  { key: "ordered", label: "Ordered" },
  { key: "customania", label: "Sent to print" },
  { key: "picked_up", label: "Picked up" },
];
const HUMAN_KIND: Record<string, string> = {
  payment_handoff: "Paid",
  courier_approval: "Approved a courier",
  approval: "Approved",
};

const money = (n?: number | null) =>
  n == null ? "–" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
const ms = (iso?: string | null) => (iso ? Date.parse(iso) : NaN);

function ago(iso: string | undefined | null, now: number) {
  const t = ms(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
const clock = (iso?: string | null) => {
  const t = ms(iso);
  return Number.isNaN(t)
    ? ""
    : new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }).format(t);
};
const eventKey = (e: HqEvent) => `${e.at ?? ""}|${e.agent ?? ""}|${e.text}`;

function useNow(stepMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), stepMs);
    return () => clearInterval(t);
  }, [stepMs]);
  return now;
}

export type HqAd = { id: string; caption: string; image: string | null; kind: "image" | "video"; x_url: string | null };

export default function HqBoard({ initial, initialSource, ads = [] }: { initial: Hq; initialSource: string; ads?: HqAd[] }) {
  const [hq, setHq] = useState<Hq>(initial);
  const [source, setSource] = useState(initialSource);
  const [fetchedAt, setFetchedAt] = useState(() => Date.now());
  const [stale, setStale] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const seen = useRef<Set<string>>(new Set((initial.timeline ?? []).map(eventKey)));
  const now = useNow();

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch("/api/hq", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as Hq;
        if (!alive) return;
        const added = (next.timeline ?? []).map(eventKey).filter((k) => !seen.current.has(k));
        added.forEach((k) => seen.current.add(k));
        setFresh(new Set(added));
        setHq(next);
        setSource(res.headers.get("x-hq-source") ?? "live");
        setFetchedAt(Date.now());
        setStale(false);
      } catch {
        if (alive) setStale(true);
      }
    }
    const t = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const c = hq.counters ?? {};
  const designs = useMemo(() => sortDesigns(hq.designs ?? []), [hq.designs]);
  const rejected = designs.filter((d) => d.stages?.ceo?.decision === "rejected" || d.status === "rejected");
  const timeline = useMemo(
    () => [...(hq.timeline ?? [])].sort((a, b) => (ms(b.at) || 0) - (ms(a.at) || 0)).slice(0, 60),
    [hq.timeline],
  );
  const human = [...(hq.human ?? [])].sort((a, b) => (ms(b.at) || 0) - (ms(a.at) || 0));
  const updated = hq.generated_at ?? null;
  const pt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(now);

  return (
    <div className="hq">
      <header className="hq-top">
        <div className="hq-title">
          <Link href="/" className="hq-mark" aria-label="Hallucinated store">
            <img src="/wordmark-forest.svg" alt="Hallucinated" width={220} height={36} />
          </Link>
          <div>
            <h1>Hallucinated HQ</h1>
            <p>A clothing company run by AI agents. This page is what they did today, as they do it.</p>
          </div>
        </div>
        <div className="hq-status" aria-live="off">
          <span className="hq-clock">{pt} <small>PT</small></span>
          <span className={`hq-updated${stale ? " is-stale" : ""}`}>
            <span className="hq-pulse" aria-hidden="true" />
            {updated ? `Last update ${ago(updated, now)}` : `Checked ${ago(new Date(fetchedAt).toISOString(), now)}`}
            {stale && ", reconnecting"}
          </span>
          {source === "fixture" && <span className="hq-sample">Sample data (preview only)</span>}
          <Link href="/" className="hq-back">Visit the store</Link>
        </div>
      </header>

      <section className="hq-counters" aria-label="Today in numbers">
        <Counter n={c.designs_proposed} label="designs proposed" />
        <Counter n={c.designs_approved} label="approved by the CEO" />
        <Counter n={c.designs_rejected} label="killed by the CEO" tone="rust" />
        <Counter n={c.live_items} label="items on the store" />
        <Counter n={c.x_posts} label="posts on X" />
        <Counter n={c.orders} label="orders" />
        <Counter value={money(c.revenue_usd)} label="revenue" />
        <Counter value={money(c.agent_spend_usd)} label="agent spend" />
        <Counter n={c.human_approvals} label="times a human stepped in" tone="sand" />
      </section>

      <div className="hq-main">
        <section className="hq-pipeline" aria-labelledby="pipe-title">
          <h2 id="pipe-title">Every design, start to finish</h2>
          <p className="hq-note">Trend, design, the CEO&rsquo;s call, the store, X, orders, the print shop, the courier. Grey means not yet.</p>
          {designs.length ? (
            <ol className="hq-designs">
              {designs.map((d) => <DesignRow key={d.design_id} d={d} now={now} />)}
            </ol>
          ) : (
            <p className="hq-empty">No designs yet today. Product runs at 10:00 and 16:00.</p>
          )}
        </section>

        <aside className="hq-feed" aria-labelledby="feed-title">
          <h2 id="feed-title">Live</h2>
          {timeline.length ? (
            <ol className="hq-timeline">
              {timeline.map((e) => {
                const who = WHO[e.agent ?? ""] ?? { initial: "?", name: e.agent ?? "Agent" };
                return (
                  <li key={eventKey(e)} className={`hq-event agent-${e.agent ?? "x"}${fresh.has(eventKey(e)) ? " is-new" : ""}`}>
                    <span className="hq-avatar" title={who.name} aria-label={who.name}>{who.initial}</span>
                    <span className="hq-event-text">
                      {e.url ? <a href={e.url}>{e.text}</a> : e.text}
                    </span>
                    <time className="hq-event-time" dateTime={e.at}>{ago(e.at, now)}</time>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="hq-empty">Quiet so far. Events show up here within a minute.</p>
          )}
        </aside>
      </div>

      {rejected.length > 0 && (
        <section className="hq-rejects" aria-labelledby="rej-title">
          <h2 id="rej-title">Killed by the CEO</h2>
          <p className="hq-note">Not every idea ships. The CEO agent writes down why.</p>
          <ul>
            {rejected.map((d) => (
              <li key={d.design_id}>
                <blockquote>&ldquo;{d.stages?.ceo?.reason ?? "No reason given."}&rdquo;</blockquote>
                <p className="hq-reject-meta">
                  On <strong>{d.title ?? d.design_id}</strong>
                  {d.stages?.ceo?.at ? `, ${clock(d.stages.ceo.at)}` : ""}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {ads.length > 0 && (
        <section className="hq-ads" aria-labelledby="ads-title">
          <div className="hq-ads-head">
            <h2 id="ads-title">Ads the agents made</h2>
            <Link href="/campaigns">See all the ads</Link>
          </div>
          <ul>
            {ads.map((a) => (
              <li key={a.id}>
                <a href={a.x_url ?? "/campaigns"} className="hq-ad">
                  <span className="hq-ad-img">
                    {a.image ? <img src={a.image} alt="" loading="lazy" /> : <span>Video</span>}
                  </span>
                  <span className="hq-ad-caption">{a.caption}</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="hq-agents" aria-labelledby="agents-title">
        <h2 id="agents-title">Shipped by agent</h2>
        <div className="hq-agent-cols">
          {AGENTS.map((a) => {
            const items = [...(hq.by_agent?.[a.key] ?? [])].sort((x, y) => (ms(y.at) || 0) - (ms(x.at) || 0));
            return (
              <div key={a.key} className={`hq-agent agent-${a.key}`}>
                <h3><span className="hq-avatar" aria-hidden="true">{WHO[a.key].initial}</span>{a.name}</h3>
                <p className="hq-agent-does">{a.does}</p>
                {items.length ? (
                  <ul>
                    {items.slice(0, 8).map((it, i) => (
                      <li key={`${it.at}-${i}`}>
                        <time dateTime={it.at}>{clock(it.at)}</time>
                        <span>{it.url ? <a href={it.url}>{it.text}</a> : it.text}</span>
                      </li>
                    ))}
                    {items.length > 8 && <li className="hq-more">and {items.length - 8} more</li>}
                  </ul>
                ) : (
                  <p className="hq-empty">Nothing yet.</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="hq-human" aria-labelledby="human-title">
        <h2 id="human-title">Where a human stepped in</h2>
        <p className="hq-note">The agents do the work. A person still holds the card, approves the spend and clicks the occasional checkbox.</p>
        {human.length ? (
          <ol>
            {human.map((h, i) => (
              <li key={`${h.at}-${i}`}>
                <time dateTime={h.at}>{clock(h.at)}</time>
                <span className="hq-human-kind">{HUMAN_KIND[h.kind ?? ""] ?? "Stepped in"}</span>
                <span className="hq-human-text">{h.text}</span>
                {h.amount_usd != null && <span className="hq-human-amt">{money(h.amount_usd)}</span>}
              </li>
            ))}
          </ol>
        ) : (
          <p className="hq-empty">Nobody has had to step in yet. Give it time.</p>
        )}
      </section>

      <footer className="hq-foot">
        <p>
          Built from the agents&rsquo; own logs and refreshed every 30 seconds. Personal details are scrubbed before anything reaches this page.{" "}
          <Link href="/shop">Shop what they made</Link>
        </p>
      </footer>
    </div>
  );
}

function Counter({ n, value, label, tone }: { n?: number; value?: string; label: string; tone?: "rust" | "sand" }) {
  return (
    <div className={`hq-counter${tone ? ` tone-${tone}` : ""}`}>
      <span className="hq-num">{value ?? (n == null ? "–" : n.toLocaleString("en-US"))}</span>
      <span className="hq-label">{label}</span>
    </div>
  );
}

function lastAt(d: HqDesign) {
  const s = d.stages ?? {};
  return Math.max(0, ...Object.values(s).map((x) => ms((x as { at?: string } | null)?.at) || 0));
}
function sortDesigns(ds: HqDesign[]) {
  return [...ds].sort((a, b) => lastAt(b) - lastAt(a));
}

function StageDetail({ k, d }: { k: keyof HqStages; d: HqStages }) {
  switch (k) {
    case "trend":
      return d.trend?.sources?.[0] ? <a href={d.trend.sources[0].url} rel="nofollow noopener noreferrer">{d.trend.sources[0].label}</a> : null;
    case "designed":
      return null;
    case "ceo":
      return d.ceo?.decision ? <span>{d.ceo.decision === "approved" ? "Approved" : "Rejected"}</span> : null;
    case "live":
      return d.live?.url ? <a href={d.live.url}>View</a> : null;
    case "posted":
      return d.posted?.url ? <a href={d.posted.url}>See post</a> : null;
    case "ordered": {
      const o = d.ordered;
      if (!o) return null;
      const sizes = o.sizes ? Object.entries(o.sizes).map(([s, q]) => `${s}${q > 1 ? `×${q}` : ""}`).join(" ") : "";
      return <span>{[o.count != null ? `${o.count} sold` : "", sizes, o.amount_usd != null ? money(o.amount_usd) : ""].filter(Boolean).join(", ")}</span>;
    }
    case "customania": {
      const o = d.customania;
      return o ? <span>{[o.order_ref, o.amount_usd != null ? money(o.amount_usd) : ""].filter(Boolean).join(", ")}</span> : null;
    }
    case "picked_up": {
      const p = d.picked_up;
      if (!p) return null;
      return <span>{p.status === "booked" ? "Courier booked" : p.status === "delivered" ? "Delivered" : "Picked up"}</span>;
    }
  }
}

function DesignRow({ d, now }: { d: HqDesign; now: number }) {
  const s = d.stages ?? {};
  const rejected = s.ceo?.decision === "rejected" || d.status === "rejected";
  const statusLabel = rejected ? "Rejected" : d.status === "shipped" ? "Shipped" : d.status === "live" ? "On the store" : "Waiting on the CEO";
  return (
    <li className={`hq-design${rejected ? " is-rejected" : ""}`}>
      <div className="hq-art">
        {d.artwork_url ? <img src={d.artwork_url} alt={`Artwork for ${d.title ?? d.design_id}`} loading="lazy" /> : <span>no artwork yet</span>}
      </div>
      <div className="hq-design-body">
        <div className="hq-design-head">
          <h3>{d.slug && !rejected ? <Link href={`/p/${d.slug}`}>{d.title ?? d.design_id}</Link> : d.title ?? d.design_id}</h3>
          <span className={`hq-chip status-${rejected ? "rejected" : d.status ?? "proposed"}`}>{statusLabel}</span>
          <span className="hq-id">{d.design_id}</span>
        </div>
        {s.trend?.summary && <p className="hq-trend">{s.trend.summary}</p>}
        {s.ceo?.reason && (
          <p className={`hq-ceo${rejected ? " is-rejected" : ""}`}>
            <span className="hq-avatar" aria-hidden="true">C</span>
            <span>&ldquo;{s.ceo.reason}&rdquo;</span>
          </p>
        )}
        <ol className="hq-rail" aria-label="Stages">
          {STAGES.map((st) => {
            const v = s[st.key] as { at?: string } | null | undefined;
            const blocked = rejected && STAGES.findIndex((x) => x.key === st.key) > 2;
            const state = blocked ? "blocked" : st.key === "ceo" && rejected ? "rejected" : v ? "done" : "todo";
            return (
              <li key={st.key} className={`hq-stage is-${state}`}>
                <span className="hq-dot" aria-hidden="true" />
                <span className="hq-stage-label">{st.label}</span>
                <span className="hq-stage-when">{v?.at ? clock(v.at) : blocked ? "" : "not yet"}</span>
                <span className="hq-stage-detail"><StageDetail k={st.key} d={s} /></span>
              </li>
            );
          })}
        </ol>
        {s.picked_up?.note && <p className="hq-trend">{s.picked_up.note}</p>}
        <span className="sr-only">Last activity {ago(new Date(lastAt(d) || now).toISOString(), now)}</span>
      </div>
    </li>
  );
}
