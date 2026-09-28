import type { Metadata } from "next";
import { MatchHistory } from "@/components/history/match-history";

export const metadata: Metadata = { title: "Match history" };

export default function HistoryPage() {
  return <MatchHistory />;
}
