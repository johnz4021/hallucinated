import raw from "../store.config.json";

// Single source of truth for price + fulfilment wording. Edit store.config.json, not this file.
export const config = {
  unitAmount: raw.unit_amount,
  currency: raw.currency,
  fulfilment: raw.fulfilment,
  lookupKey: raw.lookup_key,
  drop: raw.drop,
  designId: raw.design_id,
  productName: raw.product_name,
  sizes: raw.sizes as readonly string[],
  maxQuantity: raw.max_quantity,
  xUrl: raw.x_url,
  xHandle: raw.x_handle,
};

export type Size = (typeof raw.sizes)[number];

export function formatPrice(cents: number, currency = config.currency) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
