"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCart } from "./cart";

const NAV = [
  { href: "/shop", label: "Shop" },
  { href: "/drops/1", label: "Drop 1" },
  { href: "/drops/2", label: "Drop 2" },
  { href: "/info", label: "Info" },
];

export default function Header() {
  const { count, ready } = useCart();
  const path = usePathname();
  return (
    <header className="site-header">
      <div className="header-row">
        <Link href="/" className="header-mark" aria-label="Hallucinated, home">
          <img src="/wordmark-forest.svg" alt="Hallucinated" width={160} height={26} />
        </Link>
        <nav className="header-nav" aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} aria-current={path === n.href || (n.href === "/shop" && path.startsWith("/p/")) ? "page" : undefined}>
              {n.label}
            </Link>
          ))}
        </nav>
        <Link href="/cart" className="bag-link" aria-label={`Bag, ${count} item${count === 1 ? "" : "s"}`}>
          Bag{ready && count > 0 ? <span className="bag-count">{count}</span> : null}
        </Link>
      </div>
    </header>
  );
}
