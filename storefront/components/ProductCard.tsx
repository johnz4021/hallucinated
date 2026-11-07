import Image from "next/image";
import Link from "next/link";
import { isAgentDesign, type Product } from "@/lib/catalog";
import { formatPrice, localImage, windowLabel } from "@/lib/config";

export default function ProductCard({ p, priority = false }: { p: Product; priority?: boolean }) {
  const img = p.images[0] ? localImage(p.images[0]) : null;
  const agent = isAgentDesign(p);
  return (
    <Link href={`/p/${p.slug}`} className="card">
      <div className="card-img">
        {img && (
          <Image src={img.src} unoptimized={img.unoptimized} alt={p.name} fill sizes="(max-width: 700px) 50vw, (max-width: 1100px) 33vw, 25vw" priority={priority} />
        )}
        <span className="badges">
          {agent && <span className="badge badge-agents">Designed by the agents</span>}
          {p.status === "preorder" && <span className="badge">Pre-order</span>}
        </span>
      </div>
      <div className="card-text">
        <span className="card-name">{p.name}</span>
        <span className="card-price">{p.priceFrom != null ? formatPrice(p.priceFrom) : ""}</span>
        <span className="card-meta">
          {p.status === "preorder" ? windowLabel(p.launchWindow) ?? "Charged only if it launches" : p.variants.map((v) => v.size).join(" ")}
        </span>
      </div>
    </Link>
  );
}
