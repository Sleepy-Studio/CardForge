import type { ReplayRecord } from "@cardforge/rules-kernel";

export interface DeckRecord {
  readonly deckId: string;
  readonly accountId: string;
  readonly gameId: string;
  readonly formatId: string;
  readonly leaderId: string;
  readonly name: string;
  readonly revision: number;
  readonly cardIds: readonly string[];
}

export type MatchRecordStatus = "active" | "complete" | "abandoned";

export interface StoredMatchRecord {
  readonly status: MatchRecordStatus;
  readonly replay: ReplayRecord;
}

export interface CardForgeStore {
  migrate(): Promise<void>;
  upsertAccount(accountId: string, displayName: string): Promise<void>;
  saveDeck(deck: DeckRecord): Promise<void>;
  getDeck(accountId: string, deckId: string): Promise<DeckRecord | null>;
  listDecks(accountId: string): Promise<readonly DeckRecord[]>;
  saveMatch(record: StoredMatchRecord): Promise<void>;
  getMatch(matchId: string): Promise<StoredMatchRecord | null>;
  close(): Promise<void>;
}
