import type { Metadata } from "next";
import HqBoard from "@/components/hq/HqBoard";
import { loadHq } from "@/lib/hq";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "HQ",
  description: "Watch Hallucinated, a clothing company run by AI agents, work in real time: designs, the CEO's calls, orders, and where a human stepped in.",
};

export default async function HqPage() {
  const { doc, source } = await loadHq();
  return <HqBoard initial={doc} initialSource={source} />;
}
