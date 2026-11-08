import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Checked =
  | { price_id: string; ok: true; replaced_by?: string; kind: "live" | "preorder"; unit_amount: number; name: string; slug: string; size: string; launch_window: string | null }
  | { price_id: string; ok: false; reason: "gone" };

// POST /api/cart/check {"price_ids":[...]} -> the current truth for each bag line, from Stripe:
// pre-order vs buy-now, price, and a replacement when a price was archived (repricing moves lookup keys).
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { price_ids?: unknown };
  const ids = Array.isArray(body.price_ids) ? body.price_ids.filter((x): x is string => typeof x === "string" && /^price_[A-Za-z0-9]+$/.test(x)).slice(0, 8) : [];
  const stripe = getStripe();
  const out: Checked[] = await Promise.all(
    ids.map(async (id): Promise<Checked> => {
      try {
        let price: Stripe.Price = await stripe.prices.retrieve(id, { expand: ["product"] });
        let replaced_by: string | undefined;
        if (!price.active && price.metadata.slug && price.metadata.size) {
          const lk = `${price.metadata.slug}-${price.metadata.size.toLowerCase()}`;
          const cur = (await stripe.prices.list({ lookup_keys: [lk], active: true, expand: ["data.product"], limit: 1 })).data[0];
          if (cur) {
            price = cur;
            replaced_by = cur.id;
          }
        }
        const product = price.product as Stripe.Product;
        const status = product?.metadata?.status;
        if (!price.active || !product?.active || !price.metadata.size || price.unit_amount == null || (status !== "live" && status !== "preorder")) {
          return { price_id: id, ok: false, reason: "gone" };
        }
        return {
          price_id: id, ok: true, replaced_by, kind: status, unit_amount: price.unit_amount, name: product.name,
          slug: product.metadata.slug, size: price.metadata.size, launch_window: product.metadata.launch_window || null,
        };
      } catch {
        return { price_id: id, ok: false, reason: "gone" };
      }
    }),
  );
  return NextResponse.json({ lines: out }, { headers: { "cache-control": "no-store" } });
}
