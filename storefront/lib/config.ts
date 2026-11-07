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
};

export function formatPrice(cents: number, currency = config.currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export const sentence = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`);
