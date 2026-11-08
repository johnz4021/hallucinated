import type { Metadata } from "next";
import HqBoard from "@/components/hq/HqBoard";
import { getContent } from "@/lib/content";
import { loadHq } from "@/lib/hq";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "HQ",
  description: "Watch Hallucinated, a clothing company run by AI agents, work in real time: designs, the CEO's calls, orders, and where a human stepped in.",
};

export default async function HqPage() {
  const [{ doc, source }, content] = await Promise.all([loadHq(), getContent()]);
  // Newest real (non-test) ads, regardless of environment.
  const ads = (content.campaigns ?? [])
    .filter((c) => !c.test && c.active !== false)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, 6)
    .map((c) => ({ id: c.id, caption: c.caption, image: c.kind === "video" ? c.poster_url ?? null : c.media_url, kind: c.kind, x_url: c.x_url ?? null }));
  return <HqBoard initial={doc} initialSource={source} ads={ads} />;
}
