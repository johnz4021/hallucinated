import type { Metadata } from "next";
import Link from "next/link";
import type Stripe from "stripe";
import ClearCart from "@/components/ClearCart";
import { config, formatPrice, sentence } from "@/lib/config";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Thanks", robots: { index: false } };

type View =
  | { kind: "order"; name: string | null; email: string | null; total: number; currency: string; lines: string[] }
  | { kind: "preorder"; name: string | null; email: string | null; total: number; window: string; lines: string[] };

async function load(id?: string): Promise<View | null> {
  if (!id || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return null;
  try {
    const stripe = getStripe();
    const s = await stripe.checkout.sessions.retrieve(id, { expand: ["line_items.data.price.product"] });
    const name = s.customer_details?.name ?? null;
    const email = s.customer_details?.email ?? null;
    if (s.mode === "setup" && s.status === "complete") {
      const items = JSON.parse(s.metadata?.preorder_items ?? "[]") as { price_id: string; qty: number }[];
      const lines = await Promise.all(
        items.map(async (it) => {
          const p = await stripe.prices.retrieve(it.price_id, { expand: ["product"] });
          return `${it.qty} × ${(p.product as Stripe.Product).name}, ${p.metadata.size === "OS" ? "one size" : `size ${p.metadata.size}`}`;
        }),
      );
      return { kind: "preorder", name, email, total: Number(s.metadata?.preorder_total ?? 0), window: s.metadata?.launch_window ?? "", lines };
    }
    if (s.mode === "payment" && s.payment_status === "paid") {
      const lines = (s.line_items?.data ?? []).map((li) => {
        const pr = li.price as Stripe.Price | null;
        const size = pr?.metadata?.size ?? s.metadata?.size ?? "";
        return `${li.quantity} × ${(pr?.product as Stripe.Product | undefined)?.name ?? li.description}${size ? `, size ${size}` : ""}`;
      });
      return { kind: "order", name, email, total: s.amount_total ?? 0, currency: s.currency ?? config.currency, lines };
    }
  } catch {}
  return null;
}

export default async function Success({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const v = await load((await searchParams).session_id);
  const first = v?.name?.split(" ")[0];
  return (
    <div className="wrap page note-page">
      <ClearCart />
      <h1 className="mono-title">
        <span className="prompt" aria-hidden="true">&gt;</span> {v?.kind === "preorder" ? "git stash save \"pre-order\"" : "git commit -m \"bought the shirt\""}
      </h1>
      {v ? (
        <>
          <p className="note-lead">{first ? `Thanks, ${first}.` : "Thanks."} {v.kind === "preorder" ? "Your pre-order is in." : "Your order is in."}</p>
          <ul className="note-lines">{v.lines.map((l) => <li key={l}>{l}</li>)}</ul>
          {v.kind === "preorder" ? (
            <p>
              Nothing was charged today. We&rsquo;ll charge {formatPrice(v.total)} to the card you saved when the drop launches
              {v.window ? ` (est. ${v.window})` : ""}. If it never launches, you&rsquo;re never charged. To cancel, email {config.contactEmail}.
            </p>
          ) : (
            <p>{formatPrice(v.total, v.currency)} paid. {sentence(config.fulfilment)}</p>
          )}
          {v.email && <p>Updates go to {v.email}.</p>}
        </>
      ) : (
        <p className="note-lead">Thanks. {sentence(config.fulfilment)}</p>
      )}
      <p>
        The ops agent batches orders into the next print run. Watch it happen at <a href={config.xUrl}>{config.xHandle}</a>.
      </p>
      <p><Link href="/shop" className="section-link">Keep shopping</Link></p>
    </div>
  );
}
