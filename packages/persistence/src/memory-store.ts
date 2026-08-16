import type { CardForgeStore, DeckRecord, StoredMatchRecord } from "./types.js";
import type {
  CompetitiveProfile,
  MatchTelemetry,
} from "@cardforge/competitive";
import {
  createCompetitiveProfile,
  settleRankedMatch,
  type RankedSettlement,
} from "@cardforge/competitive";
import type { RankedCompletion } from "./types.js";

export class MemoryCardForgeStore implements CardForgeStore {
  readonly #accounts = new Map<string, string>();
  readonly #decks = new Map<string, DeckRecord>();
  readonly #matches = new Map<string, StoredMatchRecord>();
  readonly #profiles = new Map<string, CompetitiveProfile>();
  readonly #telemetry = new Map<string, MatchTelemetry>();
  readonly #settlements = new Map<string, RankedSettlement>();

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

  #profileKey(accountId: string, seasonId: string): string {
    return `${accountId}\u0000${seasonId}`;
  }

  getCompetitiveProfile(
    accountId: string,
    seasonId: string,
  ): Promise<CompetitiveProfile | null> {
    const profile = this.#profiles.get(this.#profileKey(accountId, seasonId));
    return Promise.resolve(profile ? structuredClone(profile) : null);
  }

  saveCompetitiveProfile(profile: CompetitiveProfile): Promise<void> {
    if (!this.#accounts.has(profile.accountId))
      return Promise.reject(new Error(`Unknown account: ${profile.accountId}`));
    this.#profiles.set(
      this.#profileKey(profile.accountId, profile.seasonId),
      structuredClone(profile),
    );
    return Promise.resolve();
  }

  saveTelemetry(telemetry: MatchTelemetry): Promise<void> {
    this.#telemetry.set(telemetry.matchId, structuredClone(telemetry));
    return Promise.resolve();
  }

  listTelemetry(
    seasonId?: string,
    limit = 1_000,
  ): Promise<readonly MatchTelemetry[]> {
    return Promise.resolve(
      [...this.#telemetry.values()]
        .filter((row) => seasonId === undefined || row.seasonId === seasonId)
        .slice(-Math.max(0, limit))
        .map((row) => structuredClone(row)),
    );
  }

  completeRankedMatch(
    completion: RankedCompletion,
  ): Promise<RankedSettlement | null> {
    if (this.#settlements.has(completion.matchId)) return Promise.resolve(null);
    const profiles = {
      p1:
        this.#profiles.get(
          this.#profileKey(
            completion.participants.p1.accountId,
            completion.seasonId,
          ),
        ) ??
        createCompetitiveProfile(
          completion.participants.p1.accountId,
          completion.seasonId,
        ),
      p2:
        this.#profiles.get(
          this.#profileKey(
            completion.participants.p2.accountId,
            completion.seasonId,
          ),
        ) ??
        createCompetitiveProfile(
          completion.participants.p2.accountId,
          completion.seasonId,
        ),
    };
    const settlement = settleRankedMatch(
      completion.matchId,
      completion.seasonId,
      profiles,
      completion.participants,
      completion.winnerId,
      completion.cycles,
    );
    for (const profile of Object.values(settlement.profiles))
      this.#profiles.set(
        this.#profileKey(profile.accountId, profile.seasonId),
        structuredClone(profile),
      );
    this.#telemetry.set(
      completion.telemetry.matchId,
      structuredClone(completion.telemetry),
    );
    this.#settlements.set(completion.matchId, structuredClone(settlement));
    return Promise.resolve(structuredClone(settlement));
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}
