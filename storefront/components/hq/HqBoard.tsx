"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { Hq, HqAgent, HqFeedItem, HqFlow } from "@/lib/hq-types";

const POLL_MS = 15_000;
const PULSE_MS = 5 * 60_000;

// The company as a map (percent positions inside the workspace). Agents are cards; outside systems are pills.
const NODES: Record<string, { x: number; y: number; kind: "agent" | "ext"; label?: string }> = {
  ceo: { x: 50, y: 11, kind: "agent" },
  product: { x: 13, y: 45, kind: "agent" },
  creative: { x: 38, y: 45, kind: "agent" },
  reviewer: { x: 62, y: 45, kind: "agent" },
  growth: { x: 87, y: 45, kind: "agent" },
  ops: { x: 32, y: 80, kind: "agent" },
  support: { x: 62, y: 80, kind: "agent" },
  store: { x: 9, y: 80, kind: "ext", label: "Store" },
  x: { x: 89, y: 80, kind: "ext", label: "X" },
  customania: { x: 22, y: 97, kind: "ext", label: "Customania" },
  courier: { x: 44, y: 97, kind: "ext", label: "Courier" },
};
const LABEL_T: Record<string, number> = { "ceo-store": 0.3, "store-ceo": 0.7, "ops-customania": 0.72, "ops-courier": 0.72 };
const AGENT_ORDER = ["ceo", "product", "creative", "reviewer", "growth", "ops", "support"];
const INITIAL: Record<string, string> = { ceo: "C", product: "P", creative: "Cr", reviewer: "R", growth: "G", ops: "O", support: "S", founder: "H" };
const STATUS: Record<string, string> = { running: "Running", idle: "Idle", paused: "Paused", waiting_human: "Waiting on a human" };

const ms = (iso?: string | null) => (iso ? Date.parse(iso) : NaN);
const usd = (n?: number | null, cents = false) =>
  n == null ? "–" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: cents || n % 1 ? 2 : 0 }).format(n);
const clip = (s: string, n = 80) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function ago(iso: string | null | undefined, now: number) {
  const t = ms(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}
function until(iso: string | null | undefined, now: number) {
  const t = ms(iso);
  if (Number.isNaN(t)) return null;
  const s = Math.round((t - now) / 1000);
  if (s <= 0) return "due now";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${String(sec).padStart(2, "0")}s` : `${sec}s`;
}

function useNow() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

// v1 documents (no `money`) still fill the strip from `counters`.
function moneyOf(hq: Hq) {
  const m = hq.money ?? {};
  const c = hq.counters ?? {};
  return {
    revenue: m.revenue_usd ?? c.revenue_usd,
    orders: m.orders_paid ?? c.orders,
    preUsd: m.preorders_usd,
    preCount: m.preorders_count,
    live: m.items_live ?? c.live_items,
    posts: m.posts_today ?? c.x_posts,
    spend: m.agent_spend_today_usd ?? c.agent_spend_usd,
    approvals: c.human_approvals ?? hq.human?.length,
  };
}

export default function HqBoard({ initial, initialSource }: { initial: Hq; initialSource: string }) {
  const [hq, setHq] = useState<Hq>(initial);
  const [source, setSource] = useState(initialSource);
  const [stale, setStale] = useState(false);
  const now = useNow();

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const res = await fetch("/api/hq", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const next = (await res.json()) as Hq;
        if (!alive) return;
        setHq(next);
        setSource(res.headers.get("x-hq-source") ?? "live");
        setStale(false);
      } catch {
        if (alive) setStale(true);
      }
    };
    const t = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const money = moneyOf(hq);
  const agents = useMemo(() => {
    const byKey = new Map((hq.agents ?? []).map((a) => [a.key, a]));
    return AGENT_ORDER.map((k) => byKey.get(k) ?? ({ key: k, name: k[0].toUpperCase() + k.slice(1), status: undefined } as HqAgent));
  }, [hq.agents]);
  const flows = (hq.flows ?? []).filter((f) => NODES[f.from] && NODES[f.to]);
  const feed: HqFeedItem[] = useMemo(() => {
    const items = hq.feed?.length ? hq.feed : (hq.timeline ?? []).map((e) => ({ at: e.at, agent: e.agent, text: e.text, url: e.url }));
    return [...items].sort((a, b) => (ms(b.at) || 0) - (ms(a.at) || 0)).slice(0, 15);
  }, [hq.feed, hq.timeline]);
  const pt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(now);

  return (
    <div className="hq2">
      <header className="hq2-top">
        <Link href="/" className="hq2-mark" aria-label="Hallucinated store">
          <img src="/wordmark-forest.svg" alt="Hallucinated" width={180} height={30} />
        </Link>
        <h1>HQ</h1>
        <span className={`hq2-live${stale ? " is-stale" : ""}`}>
          <span className="hq2-dot" aria-hidden="true" />
          {stale ? "reconnecting" : "live"}
          <span className="hq2-ago">updated {ago(hq.generated_at, now) || "just now"}</span>
        </span>
        {source === "fixture" && <span className="hq2-sample">sample data</span>}
        <span className="hq2-clock">{pt} <small>PT</small></span>
      </header>

      <section className="hq2-money" aria-label="Money">
        <Stat value={usd(money.revenue)} label="revenue" />
        <Stat value={money.orders ?? "–"} label="paid orders" />
        <Stat value={usd(money.preUsd)} label={`pre-orders${money.preCount != null ? ` (${money.preCount})` : ""}`} />
        <Stat value={money.live ?? "–"} label="items live" />
        <Stat value={money.posts ?? "–"} label="posts today" />
        <Stat value={usd(money.spend, true)} label="agent spend today" />
        <span className="hq2-chip">human approvals today: {money.approvals ?? 0}</span>
      </section>

      <div className="hq2-main">
        <section className="hq2-map" aria-label="Agents and how work moves between them">
          <svg className="hq2-edges" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {flows.map((f) => {
              const a = NODES[f.from], b = NODES[f.to];
              const hot = now - ms(f.last_at) < PULSE_MS;
              return <line key={`${f.from}-${f.to}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className={hot ? "is-hot" : ""} />;
            })}
          </svg>
          {flows.map((f) => {
            const a = NODES[f.from], b = NODES[f.to];
            const hot = now - ms(f.last_at) < PULSE_MS;
            // Two-way pairs: each label sits nearer its own sender. Long diagonals keep clear of the middle row.
            const twoWay = flows.some((g) => g.from === f.to && g.to === f.from);
            const t = twoWay ? 0.3 : LABEL_T[`${f.from}-${f.to}`] ?? 0.5;
            return (
              <span key={`l-${f.from}-${f.to}`} className={`hq2-edge-label${hot ? " is-hot" : ""}`} style={{ left: `${a.x + (b.x - a.x) * t}%`, top: `${a.y + (b.y - a.y) * t}%` }}>
                {f.label ?? `${f.from} → ${f.to}`} <b>{f.count_today ?? 0}</b>
              </span>
            );
          })}
          {Object.entries(NODES).filter(([, n]) => n.kind === "ext").map(([k, n]) => (
            <span key={k} className="hq2-ext" style={{ left: `${n.x}%`, top: `${n.y}%` }}>{n.label}</span>
          ))}
          {agents.map((a) => <AgentNode key={a.key} a={a} now={now} />)}
        </section>

        <aside className="hq2-feed" aria-label="Latest">
          <h2>Latest</h2>
          {feed.length ? (
            <ol>
              {feed.map((e, i) => (
                <li key={`${e.at}-${i}`} className={`agent-${e.agent ?? "x"}`}>
                  <span className="hq2-av" aria-label={e.agent}>{INITIAL[e.agent ?? ""] ?? "?"}</span>
                  <span className="hq2-feed-text">{e.url ? <a href={e.url}>{e.text}</a> : e.text}</span>
                  <time dateTime={e.at}>{ago(e.at, now)}</time>
                </li>
              ))}
            </ol>
          ) : (
            <p className="hq2-empty">Nothing yet today.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="hq2-stat">
      <span className="hq2-num">{value}</span>
      <span className="hq2-label">{label}</span>
    </div>
  );
}

function AgentNode({ a, now }: { a: HqAgent; now: number }) {
  const n = NODES[a.key];
  if (!n) return null;
  const next = until(a.next_run_at, now);
  const ls = a.last_shipped;
  const shipped = ls?.text ? (
    <>
      {ls.thumb && <img src={ls.thumb} alt="" loading="lazy" />}
      <span>{clip(ls.text)}</span>
    </>
  ) : null;
  return (
    <article className={`hq2-node status-${a.status ?? "unknown"} agent-${a.key}`} style={{ left: `${n.x}%`, top: `${n.y}%` }}>
      <Link href={`/hq/agent/${a.key}`} className="hq2-node-link" aria-label={`Open ${a.name ?? a.key}: runs, tools and what it shipped`} />
      <header>
        <span className="hq2-av" aria-hidden="true">{INITIAL[a.key] ?? "?"}</span>
        <h3>{a.name ?? a.key}</h3>
        <span className="hq2-status">{STATUS[a.status ?? ""] ?? "No data"}</span>
      </header>
      {a.now && (a.status === "running" || a.status === "waiting_human") && <p className="hq2-now">{clip(a.now, 90)}</p>}
      <p className="hq2-next">
        {a.status === "running" && a.running_since
          ? `running for ${ago(a.running_since, now).replace(" ago", "")}`
          : a.status === "paused"
            ? "paused"
            : next
              ? `next run in ${next}`
              : a.schedule ?? "on demand"}
      </p>
      {shipped && (
        <p className="hq2-shipped">
          {ls?.url ? <a href={ls.url}>{shipped}</a> : <span>{shipped}</span>}
          <time dateTime={ls?.at}>{ago(ls?.at, now)}</time>
        </p>
      )}
    </article>
  );
}
