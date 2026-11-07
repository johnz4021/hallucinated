import type { Metadata } from "next";
import { config, formatPrice } from "@/lib/config";
import { getStripe } from "@/lib/stripe";
import Masthead from "../Masthead";

const sentence = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`);

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Order in. Hallucinated", robots: { index: false } };

async function loadOrder(id: string | undefined) {
  if (!id || !/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return null;
  try {
    const s = await getStripe().checkout.sessions.retrieve(id, { expand: ["line_items"] });
    if (s.payment_status !== "paid") return null;
    return {
      size: s.metadata?.size ?? "?",
      qty: s.line_items?.data[0]?.quantity ?? 1,
      total: s.amount_total ?? 0,
      currency: s.currency ?? config.currency,
      email: s.customer_details?.email ?? null,
      name: s.customer_details?.name ?? null,
    };
  } catch {
    return null;
  }
}

export default async function Success({ searchParams }: { searchParams: Promise<{ session_id?: string }> }) {
  const { session_id } = await searchParams;
  const order = await loadOrder(session_id);
  return (
    <>
      <Masthead />
      <main className="note-page">
        <h1 className="title">
          <span className="prompt" aria-hidden="true">&gt;</span> git commit -m &quot;bought the shirt&quot;
        </h1>
        {order ? (
          <>
            <p className="note-lead">
              {order.name ? `Thanks, ${order.name.split(" ")[0]}. ` : "Thanks. "}
              {order.qty} &times; size {order.size}, {formatPrice(order.total, order.currency)} paid.
            </p>
            <p>
              {sentence(config.fulfilment)}
              {order.email ? ` The receipt and updates go to ${order.email}.` : ""}
            </p>
          </>
        ) : (
          <p className="note-lead">Payment received. {sentence(config.fulfilment)}</p>
        )}
        <p>
          The ops agent batches paid orders into the next print run. You can watch it happen at{" "}
          <a href={config.xUrl}>{config.xHandle}</a>.
        </p>
        <p><a href="/" className="back-link">Back to the shop</a></p>
      </main>
    </>
  );
}
