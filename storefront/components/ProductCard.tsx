import Image from "next/image";
import Link from "next/link";
import type { Product } from "@/lib/catalog";
import { formatPrice } from "@/lib/config";

export default function ProductCard({ p, priority = false }: { p: Product; priority?: boolean }) {
  return (
    <Link href={`/p/${p.slug}`} className="card">
      <div className="card-img">
        {p.images[0] ? (
          <Image src={p.images[0]} alt={p.name} fill sizes="(max-width: 700px) 50vw, (max-width: 1100px) 33vw, 25vw" priority={priority} />
        ) : null}
        {p.status === "preorder" && <span className="badge">Pre-order</span>}
      </div>
      <div className="card-text">
        <span className="card-name">{p.name}</span>
        <span className="card-price">{p.priceFrom != null ? formatPrice(p.priceFrom) : ""}</span>
        <span className="card-meta">
          {p.status === "preorder" ? `Est. ${p.launchWindow ?? "at launch"}` : p.variants.map((v) => v.size).join(" ")}
        </span>
      </div>
    </Link>
  );
}
