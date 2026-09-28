import type { Metadata } from "next";
import { DeckBuilder } from "@/components/decks/deck-builder";

export const metadata: Metadata = { title: "Deck builder" };

export default async function DeckBuilderPage({
  params,
}: {
  params: Promise<{ deckId: string }>;
}) {
  const { deckId } = await params;
  return <DeckBuilder deckId={decodeURIComponent(deckId)} />;
}
