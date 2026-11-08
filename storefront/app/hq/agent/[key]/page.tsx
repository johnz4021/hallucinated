import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AgentDetail from "@/components/hq/AgentDetail";
import { loadHq, loadHqAgents } from "@/lib/hq";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ key: string }> }): Promise<Metadata> {
  const { key } = await params;
  return { title: `HQ: ${key[0]?.toUpperCase()}${key.slice(1)}`, robots: { index: false } };
}

export default async function AgentPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!/^[a-z-]{2,30}$/.test(key)) notFound();
  const [{ doc: agentsDoc, source }, { doc: main }] = await Promise.all([loadHqAgents(), loadHq()]);
  const detail = agentsDoc.agents?.[key] ?? null;
  const live = (main.agents ?? []).find((a) => a.key === key) ?? null;
  if (!detail && !live) notFound();
  return <AgentDetail agentKey={key} initialDetail={detail} initialLive={live} source={source} />;
}
