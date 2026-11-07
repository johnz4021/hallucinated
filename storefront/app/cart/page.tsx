import type { Metadata } from "next";
import CartView from "@/components/CartView";
import { config } from "@/lib/config";

export const metadata: Metadata = { title: "Bag", robots: { index: false } };

export default function CartPage() {
  return (
    <div className="wrap page">
      <header className="page-head"><h1>Bag</h1></header>
      <CartView fulfilment={config.fulfilment} contact={config.contactEmail} />
    </div>
  );
}
