import type { Metadata } from "next";
import { MatchLab } from "@/components/match-lab";

export const metadata: Metadata = { title: "Match Lab" };

/** Local engine sandbox for designers and developers. Not in player navigation. */
export default function LabPage() {
  return <MatchLab />;
}
