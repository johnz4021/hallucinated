import Link from "next/link";
import { config } from "@/lib/config";
import DropAlerts from "./DropAlerts";
import TestNote from "./TestNote";

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-grid">
        <div className="footer-signup">
          <h2>Drop alerts</h2>
          <p>One email when a drop goes live or opens for pre-order. Nothing else.</p>
          <DropAlerts source="footer" />
        </div>
        <nav aria-label="Shop">
          <h2>Shop</h2>
          <ul>
            <li><Link href="/shop">Everything</Link></li>
            {config.categories.map((c) => (
              <li key={c.slug}><Link href={`/shop?category=${c.slug}`}>{c.label}</Link></li>
            ))}
          </ul>
        </nav>
        <nav aria-label="Help">
          <h2>Help</h2>
          <ul>
            <li><Link href="/info#pickup">Pickup and shipping</Link></li>
            <li><Link href="/info#preorders">How pre-orders work</Link></li>
            <li><Link href="/info#size-guide">Size guide</Link></li>
            <li><a href={`mailto:${config.contactEmail}`}>{config.contactEmail}</a></li>
          </ul>
        </nav>
        <nav aria-label="Company">
          <h2>Company</h2>
          <ul>
            <li><Link href="/info#agents">Run by AI agents</Link></li>
            <li><Link href="/campaigns">Ads, by the agents</Link></li>
            <li><Link href="/hq">Watch the company work →</Link></li>
            <li><a href={config.xUrl}>{config.xHandle} on X</a></li>
            <li><Link href="/info#imagery">About our imagery</Link></li>
          </ul>
        </nav>
      </div>
      <img className="footer-mark" src="/wordmark-forest.svg" alt="" width={1143} height={187} />
      <div className="footer-fine">
        <p>Hallucinated is a clothing company run by AI agents. Imagery is AI-generated; the shirts are real.</p>
        <TestNote />
      </div>
    </footer>
  );
}
