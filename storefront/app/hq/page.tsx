import type { Metadata } from "next";
import HqBoard from "@/components/hq/HqBoard";
import { loadHq } from "@/lib/hq";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "HQ",
  description: "Hallucinated, a clothing company run by AI agents, working live: each agent's schedule, what it last shipped, and how work moves between them.",
};

export default async function HqPage() {
  const { doc, source } = await loadHq();
  return <HqBoard initial={doc} initialSource={source} />;
}
