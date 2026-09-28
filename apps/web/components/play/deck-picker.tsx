"use client";

import Link from "next/link";
import { cardName, leaderInfo } from "@/lib/cards";
import type { SavedDeck } from "@/lib/types";

export function deckProblem(deck: SavedDeck): string | null {
  if (!deck.status.legal) return "Not legal yet";
  if (!deck.status.leaderUnlocked)
    return `${leaderInfo(deck.leaderId).name} is locked`;
  if (deck.status.missing.length)
    return `Missing ${deck.status.missing.reduce((total, card) => total + card.quantity, 0)} card(s), e.g. ${cardName(deck.status.missing[0].cardId)}`;
  return null;
}

export function DeckPicker({
  decks,
  value,
  onChange,
  allowUnplayable = false,
}: {
  readonly decks: readonly SavedDeck[];
  readonly value: string;
  readonly onChange: (deckId: string) => void;
  readonly allowUnplayable?: boolean;
}) {
  if (!decks.length)
    return (
      <p className="muted">
        No decks yet. <Link href="/decks">Build one</Link>.
      </p>
    );
  return (
    <div className="deck-picker" role="radiogroup" aria-label="Deck">
      {decks.map((deck) => {
        const problem = deckProblem(deck);
        const disabled = !allowUnplayable && problem !== null;
        return (
          <button
            aria-checked={value === deck.deckId}
            className={`deck-choice ${value === deck.deckId ? "is-selected" : ""}`}
            data-deck={deck.deckId}
            disabled={disabled && !deck.status.legal}
            key={deck.deckId}
            onClick={() => onChange(deck.deckId)}
            role="radio"
            type="button"
          >
            <strong>{deck.name}</strong>
            <small>{leaderInfo(deck.leaderId).name}</small>
            {problem ? (
              <em className="deck-choice__problem">{problem}</em>
            ) : (
              <em className="deck-choice__ok">Ready</em>
            )}
          </button>
        );
      })}
    </div>
  );
}
