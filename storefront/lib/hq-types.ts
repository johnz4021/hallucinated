// hq.json schema v1 (built by design-mcp/agents/hq_publish.mjs). Every stage and most fields may be null/missing.
export type Source = { label: string; url: string };
export type HqStages = {
  trend?: { at?: string; summary?: string; sources?: Source[] } | null;
  designed?: { at?: string; session?: string } | null;
  ceo?: { decision?: "approved" | "rejected"; reason?: string; at?: string; session?: string } | null;
  live?: { at?: string; url?: string } | null;
  posted?: { at?: string; url?: string } | null;
  ordered?: { at?: string; count?: number; sizes?: Record<string, number>; amount_usd?: number } | null;
  customania?: { at?: string; order_ref?: string; amount_usd?: number } | null;
  picked_up?: { at?: string; status?: "booked" | "picked_up" | "delivered"; note?: string } | null;
};
export type HqDesign = {
  design_id: string;
  title?: string;
  slug?: string | null;
  artwork_url?: string | null;
  status?: "rejected" | "live" | "proposed" | "shipped";
  stages?: HqStages;
};
export type AgentKey = "product" | "ceo" | "ops" | "growth" | "support";
export type HqItem = { at?: string; text: string; url?: string };
export type HqEvent = { at?: string; agent?: AgentKey | "founder"; kind?: string; text: string; url?: string };
export type HqHuman = { at?: string; kind?: "payment_handoff" | "courier_approval" | "approval"; text: string; amount_usd?: number };
export type Hq = {
  version: 1;
  generated_at?: string;
  counters?: Partial<Record<
    "designs_proposed" | "designs_approved" | "designs_rejected" | "live_items" | "x_posts" | "orders" | "revenue_usd" | "agent_spend_usd" | "human_approvals",
    number
  >>;
  designs?: HqDesign[];
  by_agent?: Partial<Record<AgentKey, HqItem[]>>;
  timeline?: HqEvent[];
  human?: HqHuman[];
};
