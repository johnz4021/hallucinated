import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { config, datedWindows, formatPrice, shipping } from "@/lib/config";
import { shippingOptionsFor } from "@/lib/shipping";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Line = { price: Stripe.Price; product: Stripe.Product; quantity: number };

function siteOrigin(req: Request) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  let body: { items?: unknown; fulfilment?: unknown };
  try {
    body = await req.json();
  } catch {
    return bad("Send JSON: { items: [{ price_id, quantity }] }.");
  }
  const raw = Array.isArray(body.items) ? body.items : [];
  if (raw.length < 1) return bad("Your bag is empty.");
  if (raw.length > config.maxLines) return bad(`Up to ${config.maxLines} different items per checkout.`);

  const wanted = new Map<string, number>();
  for (const it of raw as { price_id?: unknown; quantity?: unknown }[]) {
    const id = typeof it?.price_id === "string" ? it.price_id : "";
    const qty = Number(it?.quantity ?? 1);
    if (!/^price_[A-Za-z0-9]+$/.test(id)) return bad("Unknown item in your bag. Remove it and try again.");
    if (!Number.isInteger(qty) || qty < 1 || qty > config.maxQtyPerLine) return bad(`Quantity must be 1 to ${config.maxQtyPerLine} per item.`);
    wanted.set(id, Math.min(config.maxQtyPerLine, (wanted.get(id) ?? 0) + qty));
  }

  const stripe = getStripe();
  let lines: Line[];
  try {
    lines = await Promise.all(
      [...wanted].map(async ([id, quantity]) => {
        const price = await stripe.prices.retrieve(id, { expand: ["product"] });
        return { price, product: price.product as Stripe.Product, quantity };
      }),
    );
  } catch {
    return bad("Something in your bag is no longer available. Remove it and try again.");
  }
  for (const l of lines) {
    const status = l.product.metadata?.status;
    if (!l.price.active || !l.product.active || !l.price.metadata.size || l.price.unit_amount == null || !["live", "preorder"].includes(status)) {
      return bad(`${l.product.name ?? "An item"} is no longer available. Remove it and try again.`);
    }
  }
  const kinds = new Set(lines.map((l) => l.product.metadata.status));
  if (kinds.size > 1) return bad("Pre-orders check out on their own. Check out the in-stock items first, then the pre-orders.");

  const origin = siteOrigin(req);
  const drops = [...new Set(lines.map((l) => l.product.metadata.drop).filter(Boolean))].join(",");
  const summary = lines
    .map((l) => `${l.product.metadata.slug}:${l.price.metadata.size}x${l.quantity}`)
    .join(";")
    .slice(0, 500);
  const common = {
    name_collection: { individual: { enabled: true, optional: false } },
    success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/cancel`,
  } satisfies Partial<Stripe.Checkout.SessionCreateParams>;

  try {
    let session: Stripe.Checkout.Session;
    if (kinds.has("live")) {
      const metadata: Record<string, string> = { kind: "order", drop: drops, items: summary };
      if (lines.length === 1) {
        // Back-compat with the first single-item sessions.
        metadata.design_id = lines[0].price.metadata.design_id ?? "";
        metadata.size = lines[0].price.metadata.size;
      }
      const subtotal = lines.reduce((s, l) => s + l.price.unit_amount! * l.quantity, 0);
      // The customer picks shipping or pickup inside Checkout; the chosen rate's metadata.fulfilment says which,
      // and the success page copies it onto the session/PaymentIntent metadata as `fulfilment`.
      metadata.fulfilment_options = "ship,pickup";
      session = await stripe.checkout.sessions.create({
        ...common,
        mode: "payment",
        line_items: lines.map((l) => ({ price: l.price.id, quantity: l.quantity })),
        shipping_address_collection: { allowed_countries: config.shipping.countries as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[] },
        shipping_options: await shippingOptionsFor(subtotal),
        metadata,
        payment_intent_data: { metadata },
        invoice_creation: { enabled: true, invoice_data: { metadata } },
        custom_text: {
          shipping_address: { message: `Picking up in SF instead? Choose pickup below; we only use this address if we ship.` },
          submit: { message: `US shipping takes ${shipping.days()} with tracking; orders over ${shipping.freeOver()} ship free. SF pickup is free.` },
        },
      });
    } else {
      const fulfilment = body.fulfilment === "ship" || body.fulfilment === "pickup" ? body.fulfilment : null;
      if (!fulfilment) return bad("Choose shipping or pickup in your bag first.");
      const total = lines.reduce((s, l) => s + l.price.unit_amount! * l.quantity, 0);
      const shipCents = fulfilment === "ship" && total < config.shipping.free_threshold ? config.shipping.rates.ship.amount : 0;
      const windows = datedWindows(lines.map((l) => l.product.metadata.launch_window));
      const preorderItems = JSON.stringify(lines.map((l) => ({ price_id: l.price.id, qty: l.quantity })));
      if (preorderItems.length > 500) return bad("Too many different pre-order items for one checkout. Split it in two.");
      const metadata: Record<string, string> = {
        kind: "preorder",
        drop: drops,
        preorder_items: preorderItems,
        preorder_total: String(total),
        currency: config.currency,
        launch_window: windows,
        items: summary,
        fulfilment,
        preorder_shipping: String(shipCents),
      };
      const what = lines.map((l) => `${l.quantity} x ${l.product.name} (${l.price.metadata.size})`).join(", ");
      session = await stripe.checkout.sessions.create({
        ...common,
        mode: "setup",
        currency: config.currency,
        allowed_payment_method_types: ["card"],
        customer_creation: "always",
        metadata,
        setup_intent_data: { metadata, description: `Pre-order: ${what}`.slice(0, 1000) },
        shipping_address_collection: { allowed_countries: config.shipping.countries as Stripe.Checkout.SessionCreateParams.ShippingAddressCollection.AllowedCountry[] },
        custom_text: {
          shipping_address: {
            message: fulfilment === "pickup"
              ? "You chose pickup in SF. Stripe still asks for an address; we only use it if we ship."
              : "Where we ship it when it launches.",
          },
          submit: {
            message:
              `${lines.every((l) => l.product.metadata.origin === "agents") ? "Designed by the agents. " : ""}` +
              `Pre-order: ${what}. You'll be charged ${formatPrice(total)}` +
              `${shipCents ? ` + ${formatPrice(shipCents)} shipping` : fulfilment === "ship" ? " (free shipping)" : " (free SF pickup)"} only if it launches` +
              `${windows ? ` (est. ${windows})` : ""}. If it never launches, you're never charged. ` +
              `Cancel any time before launch: email ${config.contactEmail}.`,
          },
        },
      });
    }
    if (!session.url) throw new Error("Stripe returned no checkout URL");
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("checkout session failed:", err instanceof Error ? err.message : err);
    return bad("Checkout is down for a moment. Try again shortly.", 502);
  }
}

function sentence(t: string) {
  return /[.!?]$/.test(t) ? t : `${t}.`;
}
