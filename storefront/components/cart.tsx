"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Kind = "live" | "preorder";
export type CartLine = {
  priceId: string;
  slug: string;
  name: string;
  size: string;
  unitAmount: number;
  image: string | null;
  kind: Kind;
  launchWindow: string | null;
  qty: number;
};

type AddResult = { ok: true } | { ok: false; reason: "mixed"; cartKind: Kind };

type Cart = {
  lines: CartLine[];
  count: number;
  subtotal: number;
  kind: Kind | null;
  ready: boolean;
  add: (line: Omit<CartLine, "qty">, qty: number, opts?: { replace?: boolean }) => AddResult;
  setQty: (priceId: string, qty: number) => void;
  remove: (priceId: string) => void;
  clear: () => void;
};

const KEY = "hallucinated.cart.v1";
const MAX_QTY = 5;
const MAX_LINES = 8;
const Ctx = createContext<Cart | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [lines, setLines] = useState<CartLine[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) ?? "[]");
      if (Array.isArray(saved)) setLines(saved);
    } catch {}
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) localStorage.setItem(KEY, JSON.stringify(lines));
  }, [lines, ready]);

  const kind = lines[0]?.kind ?? null;

  const add = useCallback<Cart["add"]>(
    (line, qty, opts) => {
      if (kind && kind !== line.kind && !opts?.replace) return { ok: false, reason: "mixed", cartKind: kind };
      setLines((cur) => {
        const base = opts?.replace ? [] : cur;
        const i = base.findIndex((l) => l.priceId === line.priceId);
        if (i >= 0) return base.map((l, j) => (j === i ? { ...l, qty: Math.min(MAX_QTY, l.qty + qty) } : l));
        if (base.length >= MAX_LINES) return base;
        return [...base, { ...line, qty: Math.min(MAX_QTY, qty) }];
      });
      return { ok: true };
    },
    [kind],
  );
  const setQty = useCallback((priceId: string, qty: number) => {
    setLines((cur) => cur.map((l) => (l.priceId === priceId ? { ...l, qty: Math.max(1, Math.min(MAX_QTY, qty)) } : l)));
  }, []);
  const remove = useCallback((priceId: string) => setLines((cur) => cur.filter((l) => l.priceId !== priceId)), []);
  const clear = useCallback(() => setLines([]), []);

  const value = useMemo<Cart>(
    () => ({
      lines,
      count: lines.reduce((s, l) => s + l.qty, 0),
      subtotal: lines.reduce((s, l) => s + l.qty * l.unitAmount, 0),
      kind,
      ready,
      add,
      setQty,
      remove,
      clear,
    }),
    [lines, kind, ready, add, setQty, remove, clear],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart outside CartProvider");
  return c;
}

export const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
