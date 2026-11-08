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
  /** Bring the bag in line with Stripe (kind, price, archived prices). Returns human-readable changes. */
  reconcile: () => Promise<string[]>;
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
      if (Array.isArray(saved)) {
        setLines(
          saved
            .filter((l) => l && typeof l.priceId === "string" && typeof l.qty === "number")
            .map((l) => ({ ...l, kind: l.kind === "preorder" ? "preorder" : "live" })),
        );
      }
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

  // The bag lives in localStorage, so it can outlive a price change, a status change (pre-order <-> buy now)
  // or a whole deploy. Stripe is the truth: re-check every line and fix the bag before checkout.
  const reconcile = useCallback(async (): Promise<string[]> => {
    const current = lines;
    if (!current.length) return [];
    const res = await fetch("/api/cart/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ price_ids: current.map((l) => l.priceId) }),
    }).catch(() => null);
    if (!res?.ok) return [];
    const { lines: checked } = (await res.json()) as {
      lines: ({ price_id: string; ok: true; replaced_by?: string; kind: Kind; unit_amount: number; name: string; launch_window: string | null } | { price_id: string; ok: false })[];
    };
    const notes: string[] = [];
    const next: CartLine[] = [];
    for (const l of current) {
      const c = checked.find((x) => x.price_id === l.priceId);
      if (!c) { next.push(l); continue; }
      if (!c.ok) { notes.push(`${l.name} (${l.size}) is no longer available, so we took it out.`); continue; }
      if (c.unit_amount !== l.unitAmount) notes.push(`${c.name} is now ${money(c.unit_amount)}.`);
      if (c.kind !== l.kind) notes.push(c.kind === "preorder" ? `${c.name} is a pre-order now.` : `${c.name} is in stock now.`);
      next.push({ ...l, priceId: c.replaced_by ?? l.priceId, unitAmount: c.unit_amount, kind: c.kind, name: c.name, launchWindow: c.launch_window });
    }
    // Merge duplicates created by a replaced price id.
    const merged: CartLine[] = [];
    for (const l of next) {
      const m = merged.find((x) => x.priceId === l.priceId);
      if (m) m.qty = Math.min(MAX_QTY, m.qty + l.qty);
      else merged.push({ ...l });
    }
    const changed = JSON.stringify(merged) !== JSON.stringify(current);
    if (changed) setLines(merged);
    return notes;
  }, [lines]);

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
      reconcile,
    }),
    [lines, kind, ready, add, setQty, remove, clear, reconcile],
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
