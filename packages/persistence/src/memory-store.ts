import type { CardForgeStore, DeckRecord, StoredMatchRecord } from "./types.js";

export class MemoryCardForgeStore implements CardForgeStore {
  readonly #accounts = new Map<string, string>();
  readonly #decks = new Map<string, DeckRecord>();
  readonly #matches = new Map<string, StoredMatchRecord>();

  #deckKey(accountId: string, deckId: string): string {
    return `${accountId}\u0000${deckId}`;
  }

  migrate(): Promise<void> {
    return Promise.resolve();
  }

  upsertAccount(accountId: string, displayName: string): Promise<void> {
    this.#accounts.set(accountId, displayName);
    return Promise.resolve();
  }

  saveDeck(deck: DeckRecord): Promise<void> {
    if (!this.#accounts.has(deck.accountId))
      return Promise.reject(new Error(`Unknown account: ${deck.accountId}`));
    this.#decks.set(
      this.#deckKey(deck.accountId, deck.deckId),
      structuredClone(deck),
    );
    return Promise.resolve();
  }

  getDeck(accountId: string, deckId: string): Promise<DeckRecord | null> {
    const deck = this.#decks.get(this.#deckKey(accountId, deckId));
    return Promise.resolve(
      deck?.accountId === accountId ? structuredClone(deck) : null,
    );
  }

  listDecks(accountId: string): Promise<readonly DeckRecord[]> {
    return Promise.resolve(
      [...this.#decks.values()]
        .filter((deck) => deck.accountId === accountId)
        .map((deck) => structuredClone(deck)),
    );
  }

  saveMatch(record: StoredMatchRecord): Promise<void> {
    this.#matches.set(record.replay.matchId, structuredClone(record));
    return Promise.resolve();
  }

  getMatch(matchId: string): Promise<StoredMatchRecord | null> {
    const record = this.#matches.get(matchId);
    return Promise.resolve(record ? structuredClone(record) : null);
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
