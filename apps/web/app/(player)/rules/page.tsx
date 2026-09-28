import type { Metadata } from "next";
import { RulesReference } from "@/components/rules/rules-reference";

export const metadata: Metadata = { title: "How to play" };

export default function RulesPage() {
  return <RulesReference />;
}
