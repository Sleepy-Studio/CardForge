import type { Metadata } from "next";
import { JoinInvite } from "@/components/play/join-invite";

export const metadata: Metadata = { title: "Friend match" };

export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return <JoinInvite code={code.toUpperCase()} />;
}
