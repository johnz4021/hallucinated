"use client";

import { useEffect } from "react";
import { useCart } from "./cart";

export default function ClearCart() {
  const { clear, ready } = useCart();
  useEffect(() => {
    if (ready) clear();
  }, [ready, clear]);
  return null;
}
