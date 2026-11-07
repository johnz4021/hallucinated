import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { getPriceId, getStripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function siteOrigin(req: Request) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? url.host;
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}

export async function POST(req: Request) {
  let body: { size?: unknown; quantity?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Send JSON: { size, quantity }." }, { status: 400 });
  }

  const size = typeof body.size === "string" ? body.size.toUpperCase() : "";
  if (!config.sizes.includes(size)) {
    return NextResponse.json({ error: `Pick a size: ${config.sizes.join(", ")}.` }, { status: 400 });
  }
  const quantity = Number(body.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > config.maxQuantity) {
    return NextResponse.json({ error: `Quantity must be 1 to ${config.maxQuantity}.` }, { status: 400 });
  }

  const metadata = { drop: config.drop, design_id: config.designId, size };
  const origin = siteOrigin(req);

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: "payment",
      line_items: [{ price: await getPriceId(), quantity }],
      name_collection: { individual: { enabled: true, optional: false } },
      metadata,
      invoice_creation: { enabled: true, invoice_data: { metadata, description: `${config.productName}, size ${size}` } },
      payment_intent_data: { metadata, description: `${config.productName}, size ${size}` },
      custom_text: {
        submit: { message: `Size ${size}. ${config.fulfilment}` },
      },
      success_url: `${origin}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/cancel`,
    });
    if (!session.url) throw new Error("Stripe returned no checkout URL");
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("checkout session failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Checkout is down for a moment. Try again shortly." }, { status: 502 });
  }
}
