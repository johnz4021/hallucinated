import type { Metadata } from "next";
import Link from "next/link";
import type Stripe from "stripe";
import ClearCart from "@/components/ClearCart";
import { config, datedWindows, formatPrice, sentence, shipping } from "@/lib/config";
import { fulfilmentOf } from "@/lib/shipping";
import { getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Thanks", robots: { index: false } };

type View =
  | { kind: "order"; name: string | null; email: string | null; total: number; currency: string; lines: string[]; fulfilment: "ship" | "pickup" | null }
  | { kind: "preorder"; name: string | null; email: string | null; total: number; window: string; lines: string[]; fulfilment: string | null; shippingCents: number };

async function load(id?: string): Promise<View | null> {
  if (!id || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return null;
  try {
    const stripe = getStripe();
    const s = await stripe.checkout.sessions.retrieve(id, { expand: ["line_items.data.price.product", "shipping_cost.shipping_rate"] });
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
      return { kind: "preorder", name, email, total: Number(s.metadata?.preorder_total ?? 0), window: datedWindows((s.metadata?.launch_window ?? "").split(", ")), lines, fulfilment: s.metadata?.fulfilment ?? null, shippingCents: Number(s.metadata?.preorder_shipping ?? 0) };
    }
    if (s.mode === "payment" && s.payment_status === "paid") {
      const lines = (s.line_items?.data ?? []).map((li) => {
        const pr = li.price as Stripe.Price | null;
        const size = pr?.metadata?.size ?? s.metadata?.size ?? "";
        return `${li.quantity} × ${(pr?.product as Stripe.Product | undefined)?.name ?? li.description}${size ? `, size ${size}` : ""}`;
      });
      // Record the chosen method as metadata.fulfilment (ship|pickup) on the session and its PaymentIntent.
      // Never copies the address anywhere; it stays in Stripe.
      const fulfilment = fulfilmentOf(s);
      if (fulfilment && s.metadata?.fulfilment !== fulfilment) {
        await stripe.checkout.sessions.update(s.id, { metadata: { fulfilment } }).catch((e) => console.error("session fulfilment tag:", (e as Error).message));
        const pi = typeof s.payment_intent === "string" ? s.payment_intent : s.payment_intent?.id;
        if (pi) await stripe.paymentIntents.update(pi, { metadata: { fulfilment } }).catch(() => {});
      }
      return { kind: "order", name, email, total: s.amount_total ?? 0, currency: s.currency ?? config.currency, lines, fulfilment };
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
              Nothing was charged today. We&rsquo;ll charge {formatPrice(v.total)}
              {v.shippingCents ? ` + ${formatPrice(v.shippingCents)} shipping` : ""} to the card you saved only if it launches
              {v.window ? ` (est. ${v.window})` : ""}. If it never launches, you&rsquo;re never charged.{" "}
              {v.fulfilment === "pickup"
                ? "You chose free pickup in SF; we'll email the address and a window."
                : v.fulfilment === "ship"
                  ? `We'll ship it within ${shipping.days()} of launch and email the tracking link.`
                  : ""}{" "}
              To cancel, email {config.contactEmail}.
            </p>
          ) : (
            <p>
              {formatPrice(v.total, v.currency)} paid.{" "}
              {v.fulfilment === "pickup"
                ? "You chose free pickup in SF: we'll email the address and a pickup window when your order is ready."
                : v.fulfilment === "ship"
                  ? `We'll ship it within ${shipping.days()} and email you the tracking link.`
                  : sentence(config.fulfilment)}
            </p>
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
