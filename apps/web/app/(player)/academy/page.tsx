import type { Metadata } from "next";
import { Academy } from "@/components/academy/academy";

export const metadata: Metadata = { title: "Academy" };

export default function AcademyPage() {
  return <Academy />;
}
