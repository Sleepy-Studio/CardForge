import type { Metadata } from "next";
import { DeckList } from "@/components/decks/deck-list";

export const metadata: Metadata = { title: "Decks" };

export default function DecksPage() {
  return <DeckList />;
}
