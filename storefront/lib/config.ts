import raw from "../store.config.json";

// Site-wide settings. Edit store.config.json, not this file.
export const config = {
  currency: raw.currency,
  fulfilment: raw.fulfilment,
  fulfilmentShort: raw.fulfilment_short,
  contactEmail: raw.contact_email,
  xUrl: raw.x_url,
  xHandle: raw.x_handle,
  maxQtyPerLine: raw.max_qty_per_line,
  maxLines: raw.max_lines,
  categories: raw.categories,
  sizeOrder: raw.size_order,
  blobHost: raw.blob_host,
  shipping: raw.shipping,
  storeHosts: raw.store_hosts,
};

export function formatPrice(cents: number, currency = config.currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export const sentence = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`);

// launch_window is free text from Stripe metadata. A real date ("Dec 2026") becomes "Est. Dec 2026";
// open-ended text ("When it launches") promises nothing, so we show no date at all.
export const isDatedWindow = (w: string | null | undefined): w is string => !!w && /\d/.test(w);
export const windowLabel = (w: string | null | undefined) => (isDatedWindow(w) ? `Est. ${w}` : null);
export const datedWindows = (ws: (string | null | undefined)[]) => [...new Set(ws.filter(isDatedWindow))].join(", ");

// Mockup URLs made by the agents point at the production host. Serve them from whichever deployment
// is rendering (preview, local), so they work before promotion and skip a round trip.
export function localImage(src: string) {
  try {
    const u = new URL(src);
    const ours = config.storeHosts.includes(u.hostname) || (u.hostname.startsWith("hallucinated-store") && u.hostname.endsWith(".vercel.app")) || u.hostname === "localhost";
    if (ours && u.pathname === "/api/mockup") return { src: `/api/mockup${u.search}`, unoptimized: true };
  } catch {}
  return { src, unoptimized: false };
}

// Shipping copy, all derived from store.config.json "shipping".
export const shipping = {
  freeOver: () => formatPrice(raw.shipping.free_threshold),
  flat: () => formatPrice(raw.shipping.rates.ship.amount),
  days: () => `${raw.shipping.rates.ship.min_days}–${raw.shipping.rates.ship.max_days} business days`,
  oneLiner: () => `Free US shipping over ${formatPrice(raw.shipping.free_threshold)} · SF pickup free`,
};
