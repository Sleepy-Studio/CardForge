import type { Metadata } from "next";
import { Competitive } from "@/components/competitive/competitive";

export const metadata: Metadata = { title: "Ranked" };

export default function CompetitivePage() {
  return <Competitive />;
}
