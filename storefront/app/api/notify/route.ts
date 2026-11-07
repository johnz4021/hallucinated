import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Drop alerts. Signups are Stripe Customers with metadata.drop_alerts = "yes" (free, and the agents can list them).
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body.company) return NextResponse.json({ ok: true }); // honeypot
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 200) {
    return NextResponse.json({ error: "That email doesn't look right." }, { status: 400 });
  }
  const source = typeof body.source === "string" ? body.source.slice(0, 60) : "site";
  try {
    const stripe = getStripe();
    const existing = (await stripe.customers.list({ email, limit: 1 })).data[0];
    const metadata = { drop_alerts: "yes", drop_alerts_source: source, drop_alerts_at: new Date().toISOString() };
    if (existing) await stripe.customers.update(existing.id, { metadata });
    else await stripe.customers.create({ email, metadata, description: "Drop alerts signup" });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("notify failed:", (e as Error).message);
    return NextResponse.json({ error: "Couldn't save that. Try again in a minute." }, { status: 502 });
  }
}
