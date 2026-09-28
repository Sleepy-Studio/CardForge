import type { Metadata } from "next";
import { ReplayViewer } from "@/components/replay/replay-viewer";

export const metadata: Metadata = { title: "Replay" };

export default async function ReplayPage({
  params,
}: {
  params: Promise<{ matchId: string }>;
}) {
  const { matchId } = await params;
  return <ReplayViewer matchId={decodeURIComponent(matchId)} />;
}
