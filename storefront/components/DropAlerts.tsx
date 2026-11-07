"use client";

import { useState } from "react";

export default function DropAlerts({ source, label = "Get drop alerts" }: { source: string; label?: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setState("busy");
    const res = await fetch("/api/notify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: fd.get("email"), company: fd.get("company"), source }),
    }).catch(() => null);
    const data = await res?.json().catch(() => ({}));
    if (res?.ok) {
      setState("done");
      setMsg("You're on the list.");
    } else {
      setState("error");
      setMsg(data?.error ?? "Couldn't save that. Try again.");
    }
  }

  if (state === "done") return <p className="alerts-done" role="status">{msg}</p>;
  return (
    <form className="alerts-form" onSubmit={submit}>
      <label className="sr-only" htmlFor={`email-${source}`}>Email</label>
      <input id={`email-${source}`} name="email" type="email" required placeholder="you@example.com" autoComplete="email" />
      <input name="company" tabIndex={-1} autoComplete="off" className="hp" aria-hidden="true" />
      <button type="submit" disabled={state === "busy"}>{state === "busy" ? "Saving…" : label}</button>
      {state === "error" && <p className="form-error" role="alert">{msg}</p>}
    </form>
  );
}
