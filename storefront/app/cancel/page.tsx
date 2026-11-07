import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Checkout cancelled", robots: { index: false } };

export default function Cancel() {
  return (
    <div className="wrap page note-page">
      <h1 className="mono-title"><span className="prompt" aria-hidden="true">&gt;</span> git stash</h1>
      <p className="note-lead">Checkout cancelled. Nothing was charged.</p>
      <p>Your bag is still here.</p>
      <p><Link href="/cart" className="section-link">Back to your bag</Link></p>
    </div>
  );
}
