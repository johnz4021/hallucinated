"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Hq, HqAgent, HqAgentDetail, HqRun } from "@/lib/hq-types";
import Icon from "./Icon";

const POLL_MS = 15_000;
const STATUS: Record<string, string> = { running: "Running", idle: "Idle", paused: "Paused", waiting_human: "Waiting on a human" };
const KIND_ICON: Record<string, string> = { design: "design", ad: "image", post: "post", reply: "reply", verdict: "check", plan: "plan", order: "store" };
const INITIAL: Record<string, string> = { ceo: "C", product: "P", creative: "Cr", reviewer: "R", growth: "G", ops: "O", support: "S" };

const ms = (iso?: string | null) => (iso ? Date.parse(iso) : NaN);
const usd = (n?: number) => (n == null ? "" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n));
const clock = (iso?: string | null) =>
  Number.isNaN(ms(iso)) ? "" : new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit" }).format(ms(iso));
function ago(iso: string | null | undefined, now: number) {
  const t = ms(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}
function until(iso: string | null | undefined, now: number) {
  const t = ms(iso);
  if (Number.isNaN(t)) return null;
  const s = Math.round((t - now) / 1000);
  if (s <= 0) return "due now";
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}h ${m}m` : m ? `${m}m ${String(sec).padStart(2, "0")}s` : `${sec}s`;
}
const duration = (r: HqRun) => {
  const d = (ms(r.ended_at) - ms(r.started_at)) / 1000;
  if (Number.isNaN(d)) return "running";
  return d < 60 ? `${Math.round(d)}s` : `${Math.round(d / 60)} min`;
};

export default function AgentDetail({ agentKey, initialDetail, initialLive, source }: { agentKey: string; initialDetail: HqAgentDetail | null; initialLive: HqAgent | null; source: string }) {
  const [detail, setDetail] = useState(initialDetail);
  const [live, setLive] = useState(initialLive);
  const [open, setOpen] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const [a, m] = await Promise.all([
        fetch(`/api/hq/agents/${agentKey}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/hq", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (!alive) return;
      if (a?.agent) setDetail(a.agent);
      if (m) setLive(((m as Hq).agents ?? []).find((x) => x.key === agentKey) ?? null);
    };
    const t = setInterval(poll, POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, [agentKey]);

  const name = detail?.name ?? live?.name ?? agentKey;
  const status = live?.status;
  const next = until(detail?.next_run_at ?? live?.next_run_at, now);
  const shipped = [...(detail?.shipped ?? [])].sort((a, b) => (ms(b.at) || 0) - (ms(a.at) || 0)).slice(0, 12);
  const runs = [...(detail?.runs ?? [])].sort((a, b) => (ms(b.started_at) || 0) - (ms(a.started_at) || 0)).slice(0, 12);
  const pt = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(now);

  return (
    <div className={`hqa agent-${agentKey}`}>
      <header className="hqa-top">
        <Link href="/hq" className="hqa-back">← HQ</Link>
        <span className="hq2-av hqa-av" aria-hidden="true">{INITIAL[agentKey] ?? name[0]}</span>
        <div className="hqa-title">
          <h1>{name} <span className={`hqa-status status-${status ?? "unknown"}`}>{STATUS[status ?? ""] ?? "No live status"}</span></h1>
          <p>
            {[detail?.role ?? live?.role, detail?.model].filter(Boolean).join(". ")}
            {source === "fixture" && <span className="hq2-sample">sample data</span>}
          </p>
        </div>
        <div className="hqa-when">
          <span className="hqa-clock">{pt} <small>PT</small></span>
          <span>{detail?.schedule ?? live?.schedule ?? "on demand"}</span>
          <strong>{status === "running" ? `running ${live?.now ? `: ${live.now}` : ""}` : status === "paused" ? "paused" : next ? `next run in ${next}` : ""}</strong>
        </div>
      </header>

      {(detail?.tools?.length ?? 0) > 0 && (
        <ul className="hqa-tools" aria-label="Tools">
          {detail!.tools!.map((t) => (
            <li key={t.name} className={t.permission === "ask" ? "is-ask" : ""} title={t.name}>
              <Icon name={t.icon} size={16} />
              <span>{t.label ?? t.name}</span>
              {t.permission === "ask" && <span className="hqa-lock"><Icon name="lock" size={12} /> needs founder</span>}
            </li>
          ))}
        </ul>
      )}

      <div className="hqa-main">
        <section className="hqa-shipped" aria-labelledby="shipped-title">
          <h2 id="shipped-title">Shipped today <span>{shipped.length}</span></h2>
          {shipped.length ? (
            <ul className="hqa-grid">
              {shipped.map((s, i) => {
                const body = (
                  <>
                    <span className="hqa-thumb">
                      {s.thumb ? (
                        <img src={s.thumb} alt="" loading="lazy" />
                      ) : (
                        <span className="hqa-textcard">
                          <Icon name={KIND_ICON[s.kind ?? ""] ?? "other"} size={26} />
                          <q>{s.title}</q>
                        </span>
                      )}
                      <span className={`hqa-kind kind-${s.kind ?? "other"}`}>{s.kind ?? "item"}</span>
                      {s.status && s.status !== "live" && <span className={`hqa-state state-${s.status}`}>{s.status}</span>}
                    </span>
                    {s.thumb && <span className="hqa-cap">{s.title}</span>}
                    <time dateTime={s.at}>{ago(s.at, now)}</time>
                  </>
                );
                return <li key={`${s.at}-${i}`}>{s.url ? <a href={s.url} className="hqa-tile">{body}</a> : <div className="hqa-tile">{body}</div>}</li>;
              })}
            </ul>
          ) : (
            <p className="hq2-empty">Nothing shipped yet today.</p>
          )}
        </section>

        <section className="hqa-runs" aria-labelledby="runs-title">
          <h2 id="runs-title">Runs</h2>
          {runs.length ? (
            <ol>
              {runs.map((r) => {
                const isOpen = open === r.id;
                return (
                  <li key={r.id} className={`hqa-run run-${r.status ?? "ok"}${isOpen ? " is-open" : ""}`}>
                    <button type="button" className="hqa-run-head" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>
                      <span className="hqa-run-time">{clock(r.started_at)}</span>
                      <span className="hqa-run-meta">
                        <span className={`hqa-trigger trig-${r.trigger ?? "schedule"}`}>{r.trigger ?? "schedule"}</span>
                        {duration(r)}{r.spend_usd != null ? `, ${usd(r.spend_usd)}` : ""}
                      </span>
                      <span className="hqa-run-result">{r.result}</span>
                      <span className="hqa-strip" aria-label="Tools used, in order">
                        {(r.steps ?? []).map((s, i) => (
                          <span key={i} className={s.ok === false ? "is-bad" : ""} title={`${s.label ?? s.tool}: ${s.summary ?? ""}`}><Icon name={s.icon} size={15} /></span>
                        ))}
                      </span>
                    </button>
                    {isOpen && (
                      <ol className="hqa-steps">
                        {(r.steps ?? []).map((s, i) => (
                          <li key={i} className={s.ok === false ? "is-bad" : ""}>
                            <span className="hqa-step-icon"><Icon name={s.icon} size={16} /></span>
                            <span className="hqa-step-text"><b>{s.label ?? s.tool}</b> {s.summary}{s.url && <> <a href={s.url}>open</a></>}</span>
                            {s.thumb && <img src={s.thumb} alt="" loading="lazy" />}
                            <time dateTime={s.at}>{clock(s.at)}</time>
                          </li>
                        ))}
                      </ol>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="hq2-empty">No runs recorded yet.</p>
          )}
        </section>
      </div>
    </div>
  );
}
