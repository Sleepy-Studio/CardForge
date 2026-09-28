import type { Metadata } from "next";
import { Suspense } from "react";
import { MatchClient } from "@/components/match/match-client";

export const metadata: Metadata = { title: "Match" };

/** Full-screen match surface, deliberately outside the navigation shell. */
export default function MatchPage() {
  return (
    <Suspense>
      <MatchClient />
    </Suspense>
  );
}
