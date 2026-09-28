import type { Metadata } from "next";
import { Competitive } from "@/components/competitive/competitive";

export const metadata: Metadata = { title: "Competitive" };

export default function CompetitivePage() {
  return <Competitive />;
}
