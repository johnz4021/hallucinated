import type { Metadata } from "next";
import CartView from "@/components/CartView";
import { config, shipping } from "@/lib/config";

export const metadata: Metadata = { title: "Bag", robots: { index: false } };

export default function CartPage() {
  return (
    <div className="wrap page">
      <header className="page-head"><h1>Bag</h1></header>
      <CartView fulfilment={`${shipping.oneLiner()}. Choose shipping or pickup at checkout.`} contact={config.contactEmail} />
    </div>
  );
}
