import type { Metadata } from "next";
import { PlayMenu } from "@/components/play/play-menu";

export const metadata: Metadata = { title: "Play" };

export default function PlayPage() {
  return <PlayMenu />;
}
