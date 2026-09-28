import type { Metadata } from "next";
import { RulesReference } from "@/components/rules/rules-reference";

export const metadata: Metadata = { title: "Rules reference" };

export default function RulesPage() {
  return <RulesReference />;
}
