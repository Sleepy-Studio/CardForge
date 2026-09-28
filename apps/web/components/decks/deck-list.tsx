"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { messageFor, useApi } from "@/lib/api";
import { leaderCards, leaderInfo, starterDeckFor } from "@/lib/cards";
import { useRequireAccount } from "@/lib/session";
import type { SavedDeck } from "@/lib/types";
import { useApiData } from "@/lib/use-api-data";
import { deckProblem } from "../play/deck-picker";
import { EmptyState, PageHeader } from "../ui/bits";

export function newDeckId(): string {
  return `deck-${Math.random().toString(36).slice(2, 10)}`;
}

export function DeckList() {
  const account = useRequireAccount();
  const api = useApi();
  const router = useRouter();
  const { data, error, reload } = useApiData<{ decks: SavedDeck[] }>(
    account ? "/api/me/decks" : null,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{
    deckId: string;
    name: string;
  } | null>(null);
  const [importLeader, setImportLeader] = useState("");

  if (!account) return <p className="loading-line">Loading…</p>;

  const save = async (
    deckId: string,
    deck: Pick<SavedDeck, "name" | "leaderId" | "cardIds">,
  ) =>
    api(`/api/me/decks/${encodeURIComponent(deckId)}`, {
      method: "PUT",
      body: { name: deck.name, leaderId: deck.leaderId, cardIds: deck.cardIds },
    });

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    setActionError(null);
    try {
      await action();
      await reload();
    } catch (caught) {
      setActionError(messageFor(caught));
    } finally {
      setBusy(null);
    }
  };

  const decks = data?.decks ?? [];
  return (
    <div className="decks-page">
      <PageHeader
        actions={
          <Link className="button button--primary" href="/decks/new">
            New deck
          </Link>
        }
        eyebrow="Decks"
        title="Your decks"
      >
        <p className="muted">
          40 cards, up to 3 copies each (Unique cards: 1), matching your
          Leader&apos;s Aspects.
        </p>
      </PageHeader>
      {error || actionError ? (
        <p className="form-error">{error ?? actionError}</p>
      ) : null}
      {decks.length ? (
        <ul className="deck-grid">
          {decks.map((deck) => {
            const problem = deckProblem(deck);
            const leader = leaderInfo(deck.leaderId);
            return (
              <li
                className={`deck-tile ${problem ? "has-problem" : ""}`}
                data-deck={deck.deckId}
                key={deck.deckId}
              >
                {renaming?.deckId === deck.deckId ? (
                  <form
                    className="rename-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(deck.deckId, () =>
                        save(deck.deckId, { ...deck, name: renaming.name }),
                      ).then(() => setRenaming(null));
                    }}
                  >
                    <input
                      aria-label="Deck name"
                      autoFocus
                      maxLength={60}
                      onChange={(event) =>
                        setRenaming({
                          deckId: deck.deckId,
                          name: event.target.value,
                        })
                      }
                      value={renaming.name}
                    />
                    <button
                      className="button button--small button--primary"
                      type="submit"
                    >
                      Save
                    </button>
                  </form>
                ) : (
                  <h2>{deck.name}</h2>
                )}
                <p className="muted">
                  {leader.name} · {leader.archetype}
                </p>
                <p className={problem ? "deck-tile__problem" : "deck-tile__ok"}>
                  {problem ?? "Ready to play"}
                </p>
                <div className="deck-tile__actions">
                  <Link
                    className="button button--small"
                    href={`/decks/${encodeURIComponent(deck.deckId)}`}
                  >
                    Edit
                  </Link>
                  <button
                    className="button button--quiet button--small"
                    onClick={() =>
                      setRenaming({ deckId: deck.deckId, name: deck.name })
                    }
                    type="button"
                  >
                    Rename
                  </button>
                  <button
                    className="button button--quiet button--small"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(`dup-${deck.deckId}`, () =>
                        save(newDeckId(), {
                          ...deck,
                          name: `${deck.name} (copy)`.slice(0, 60),
                        }),
                      )
                    }
                    type="button"
                  >
                    Duplicate
                  </button>
                  <button
                    className="button button--quiet button--small button--danger-text"
                    disabled={busy !== null}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete “${deck.name}”? This cannot be undone.`,
                        )
                      )
                        void run(`del-${deck.deckId}`, () =>
                          api(
                            `/api/me/decks/${encodeURIComponent(deck.deckId)}`,
                            { method: "DELETE" },
                          ),
                        );
                    }}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : data ? (
        <EmptyState title="No decks yet">
          <Link href="/decks/new">Build your first deck</Link>
        </EmptyState>
      ) : (
        <p className="loading-line">Loading decks…</p>
      )}

      <section className="panel-card">
        <h2>Import a starter list</h2>
        <p className="muted">
          Every Leader has a ready-made 40-card list. Cards you do not own yet
          are marked, and you can craft them in your Collection.
        </p>
        <div className="inline-form">
          <select
            aria-label="Starter Leader"
            onChange={(event) => setImportLeader(event.target.value)}
            value={importLeader}
          >
            <option value="">Choose a Leader…</option>
            {leaderCards.map((card) => (
              <option key={card.cardId} value={card.cardId}>
                {card.name} — {leaderInfo(card.cardId).archetype}
              </option>
            ))}
          </select>
          <button
            className="button button--quiet"
            disabled={!importLeader || busy !== null}
            onClick={() => {
              const deckId = newDeckId();
              void run("import", () =>
                save(deckId, {
                  name: `${leaderInfo(importLeader).archetype} Starter`,
                  leaderId: importLeader,
                  cardIds: starterDeckFor(importLeader),
                }),
              ).then(() => router.push(`/decks/${deckId}`));
            }}
            type="button"
          >
            Import
          </button>
        </div>
      </section>
    </div>
  );
}
