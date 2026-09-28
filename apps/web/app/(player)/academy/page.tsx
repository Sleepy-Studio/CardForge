import type { Metadata } from "next";
import { Academy } from "@/components/academy/academy";

export const metadata: Metadata = { title: "Learn" };

export default function AcademyPage() {
  return <Academy />;
}
