import "server-only";
import { unstable_cache } from "next/cache";
import type Stripe from "stripe";
import { config } from "./config";
import { getStripe } from "./stripe";

export type Status = "live" | "preorder";
export type Variant = { priceId: string; size: string; unitAmount: number; currency: string };
export type Product = {
  id: string;
  slug: string;
  name: string;
  description: string;
  images: string[];
  category: string;
  garment: string;
  color: string;
  drop: string;
  designId: string;
  status: Status;
  launchWindow: string | null;
  features: string[];
  sort: number;
  variants: Variant[];
  priceFrom: number | null;
};

const STATUSES: Status[] = ["live", "preorder"];
const sizeRank = (s: string) => {
  const i = config.sizeOrder.indexOf(s);
  return i === -1 ? 99 : i;
};

async function fetchCatalog(): Promise<Product[]> {
  const stripe = getStripe();
  const products: Stripe.Product[] = [];
  for await (const p of stripe.products.list({ active: true, limit: 100 })) products.push(p);
  const prices: Stripe.Price[] = [];
  for await (const p of stripe.prices.list({ active: true, limit: 100, type: "one_time" })) prices.push(p);

  return products
    .filter((p) => p.metadata.slug && STATUSES.includes(p.metadata.status as Status))
    .map((p) => {
      const variants = prices
        .filter((pr) => (typeof pr.product === "string" ? pr.product : pr.product.id) === p.id && pr.metadata.size && pr.unit_amount != null)
        .map((pr) => ({ priceId: pr.id, size: pr.metadata.size, unitAmount: pr.unit_amount!, currency: pr.currency }))
        .sort((a, b) => sizeRank(a.size) - sizeRank(b.size));
      return {
        id: p.id,
        slug: p.metadata.slug,
        name: p.name,
        description: p.description ?? "",
        images: p.images ?? [],
        category: p.metadata.category ?? "other",
        garment: p.metadata.garment ?? "",
        color: p.metadata.color ?? "",
        drop: p.metadata.drop ?? "",
        designId: p.metadata.design_id ?? "",
        status: p.metadata.status as Status,
        launchWindow: p.metadata.launch_window || null,
        features: (p.marketing_features ?? []).map((f) => f.name).filter((n): n is string => !!n),
        sort: Number(p.metadata.sort ?? 100),
        variants,
        priceFrom: variants.length ? Math.min(...variants.map((v) => v.unitAmount)) : null,
      } satisfies Product;
    })
    .filter((p) => p.variants.length > 0)
    .sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

// Cached for 60 s and tagged, so POST /api/revalidate shows agent changes at once.
export const getCatalog = unstable_cache(fetchCatalog, ["catalog-v1"], { revalidate: 60, tags: ["catalog"] });

export async function getProduct(slug: string) {
  return (await getCatalog()).find((p) => p.slug === slug) ?? null;
}

export const dropNumber = (drop: string) => Number(drop.replace(/^drop-/, "")) || null;
