"use client";

import { useEffect } from "react";
import { useCart } from "./cart";

// After a successful checkout, remove only what was bought (a direct "Buy now" or a split checkout
// leaves the rest of the bag alone). Without ids (unknown session), leave the bag as it is.
export default function ClearCart({ priceIds }: { priceIds: string[] }) {
  const { ready, lines, remove } = useCart();
  useEffect(() => {
    if (!ready) return;
    for (const l of lines) if (priceIds.includes(l.priceId)) remove(l.priceId);
    // run once per session ids
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, priceIds.join(",")]);
  return null;
}
