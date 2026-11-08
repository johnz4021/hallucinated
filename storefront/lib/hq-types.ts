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
// v2 (workspace view)
export type HqAgentKey = "ceo" | "product" | "creative" | "reviewer" | "growth" | "ops" | "support";
export type HqMoney = Partial<Record<
  "revenue_usd" | "orders_paid" | "preorders_count" | "preorders_usd" | "items_live" | "posts_today" | "replies_today" | "agent_spend_today_usd" | "agent_spend_total_usd",
  number
>>;
export type HqAgent = {
  key: HqAgentKey | string;
  name?: string;
  role?: string;
  status?: "running" | "idle" | "paused" | "waiting_human";
  now?: string | null;
  running_since?: string | null;
  last_run_at?: string | null;
  next_run_at?: string | null;
  schedule?: string | null;
  last_shipped?: { at?: string; text?: string; url?: string; thumb?: string } | null;
  today?: { runs?: number; shipped?: number };
};
export type HqFlow = { from: string; to: string; label?: string; count_today?: number; last_at?: string | null };
export type HqFeedItem = { at?: string; agent?: string; text: string; url?: string };

export type Hq = {
  version: 1 | 2;
  money?: HqMoney;
  agents?: HqAgent[];
  flows?: HqFlow[];
  feed?: HqFeedItem[];
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

// hq-agents.json v1: per-agent drill-down (/hq/agent/[key]).
export type HqToolIcon =
  | "search" | "trends" | "design" | "image" | "video" | "review" | "check" | "post" | "reply" | "browser"
  | "store" | "money" | "courier" | "inbox" | "plan" | "flag" | "catalog" | "mail" | "other";
export type HqTool = { name: string; label?: string; icon?: HqToolIcon | string; permission?: "allow" | "ask" | string };
export type HqShipped = { at?: string; kind?: "design" | "ad" | "post" | "reply" | "verdict" | "plan" | string; title?: string; url?: string | null; thumb?: string | null; status?: string };
export type HqStep = { at?: string; tool?: string; label?: string; icon?: HqToolIcon | string; ok?: boolean; summary?: string; url?: string | null; thumb?: string | null };
export type HqRun = { id: string; started_at?: string; ended_at?: string | null; status?: string; trigger?: "schedule" | "manual" | "handoff" | string; spend_usd?: number; result?: string; steps?: HqStep[] };
export type HqAgentDetail = {
  key: string; name?: string; role?: string; model?: string; schedule?: string; next_run_at?: string | null;
  tools?: HqTool[]; shipped?: HqShipped[]; runs?: HqRun[];
};
export type HqAgentsDoc = { version: 1; generated_at?: string; agents: Record<string, HqAgentDetail> };
