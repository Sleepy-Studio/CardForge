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
import type { TrainingCompletionResult } from "./types.js";
import {
  economyBootstrap,
  quoteCraft,
  type CosmeticDefinition,
  type CurrencyId,
  type EconomySnapshot,
  type EconomyTransaction,
} from "@cardforge/economy";
import type { CardDefinition } from "@cardforge/card-schema";

export class MemoryCardForgeStore implements CardForgeStore {
  readonly #accounts = new Map<string, string>();
  readonly #decks = new Map<string, DeckRecord>();
  readonly #matches = new Map<string, StoredMatchRecord>();
  readonly #profiles = new Map<string, CompetitiveProfile>();
  readonly #telemetry = new Map<string, MatchTelemetry>();
  readonly #settlements = new Map<string, RankedSettlement>();
  readonly #wallets = new Map<string, Map<CurrencyId, number>>();
  readonly #inventory = new Map<string, Map<string, number>>();
  readonly #entitlements = new Map<
    string,
    Map<string, CosmeticDefinition["category"]>
  >();
  readonly #economyTransactions = new Map<string, EconomyTransaction>();
  readonly #trainingCompletions = new Map<string, string>();

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

  bootstrapEconomy(accountId: string): Promise<EconomySnapshot> {
    this.#assertAccount(accountId);
    if (!this.#wallets.has(accountId)) {
      this.#wallets.set(
        accountId,
        new Map<CurrencyId, number>([
          ["shards", economyBootstrap.shards],
          ["style_tokens", economyBootstrap.styleTokens],
        ]),
      );
      this.#inventory.set(accountId, new Map());
      this.#entitlements.set(
        accountId,
        new Map(
          economyBootstrap.cosmeticIds.map((id) => [
            id,
            id.startsWith("card-back") ? "card_back" : "board",
          ]),
        ),
      );
      this.#economyTransactions.set(`bootstrap:${accountId}`, {
        transactionId: `bootstrap:${accountId}`,
        accountId,
        kind: "bootstrap",
      });
    }
    return Promise.resolve(this.#economySnapshot(accountId));
  }

  async getEconomySnapshot(accountId: string): Promise<EconomySnapshot> {
    await this.bootstrapEconomy(accountId);
    return this.#economySnapshot(accountId);
  }

  async craftCard(
    transactionId: string,
    accountId: string,
    card: CardDefinition,
    quantity: number,
  ): Promise<EconomySnapshot> {
    await this.bootstrapEconomy(accountId);
    if (this.#isDuplicateTransaction(transactionId, accountId, "craft"))
      return this.#economySnapshot(accountId);
    const inventory = this.#inventory.get(accountId)!;
    const wallet = this.#wallets.get(accountId)!;
    const quote = quoteCraft(card, inventory.get(card.cardId) ?? 0, quantity);
    const balance = wallet.get("shards") ?? 0;
    if (balance < quote.totalCost) throw new Error("Insufficient shards");
    wallet.set("shards", balance - quote.totalCost);
    inventory.set(card.cardId, quote.resultingQuantity);
    this.#economyTransactions.set(transactionId, {
      transactionId,
      accountId,
      kind: "craft",
      currencyId: "shards",
      currencyDelta: -quote.totalCost,
      itemId: card.cardId,
      itemDelta: quantity,
    });
    return this.#economySnapshot(accountId);
  }

  async unlockCosmetic(
    transactionId: string,
    accountId: string,
    cosmetic: CosmeticDefinition,
  ): Promise<EconomySnapshot> {
    await this.bootstrapEconomy(accountId);
    if (
      this.#isDuplicateTransaction(transactionId, accountId, "cosmetic_unlock")
    )
      return this.#economySnapshot(accountId);
    const entitlements = this.#entitlements.get(accountId)!;
    if (entitlements.has(cosmetic.cosmeticId))
      throw new Error("Cosmetic already unlocked");
    const wallet = this.#wallets.get(accountId)!;
    const balance = wallet.get("style_tokens") ?? 0;
    if (balance < cosmetic.styleTokenCost)
      throw new Error("Insufficient style tokens");
    wallet.set("style_tokens", balance - cosmetic.styleTokenCost);
    entitlements.set(cosmetic.cosmeticId, cosmetic.category);
    this.#economyTransactions.set(transactionId, {
      transactionId,
      accountId,
      kind: "cosmetic_unlock",
      currencyId: "style_tokens",
      currencyDelta: -cosmetic.styleTokenCost,
      itemId: cosmetic.cosmeticId,
      itemDelta: 1,
    });
    return this.#economySnapshot(accountId);
  }

  async grantReward(
    transactionId: string,
    accountId: string,
    currencyId: CurrencyId,
    amount: number,
  ): Promise<EconomySnapshot> {
    await this.bootstrapEconomy(accountId);
    if (this.#isDuplicateTransaction(transactionId, accountId, "reward"))
      return this.#economySnapshot(accountId);
    if (!Number.isSafeInteger(amount) || amount <= 0)
      throw new Error("Reward amount must be a positive integer");
    const wallet = this.#wallets.get(accountId)!;
    wallet.set(currencyId, (wallet.get(currencyId) ?? 0) + amount);
    this.#economyTransactions.set(transactionId, {
      transactionId,
      accountId,
      kind: "reward",
      currencyId,
      currencyDelta: amount,
    });
    return this.#economySnapshot(accountId);
  }

  listEconomyTransactions(
    accountId: string,
    limit = 100,
  ): Promise<readonly EconomyTransaction[]> {
    return Promise.resolve(
      [...this.#economyTransactions.values()]
        .filter((transaction) => transaction.accountId === accountId)
        .slice(-Math.max(0, limit))
        .reverse()
        .map((transaction) => structuredClone(transaction)),
    );
  }

  async completeTrainingScenario(
    completionId: string,
    accountId: string,
    scenarioId: string,
    reward: { readonly shards: number; readonly styleTokens: number },
  ): Promise<TrainingCompletionResult> {
    await this.bootstrapEconomy(accountId);
    const key = `${accountId}\u0000${scenarioId}`;
    const existing = this.#trainingCompletions.get(key);
    if (existing)
      return {
        firstCompletion: false,
        scenarioId,
        snapshot: this.#economySnapshot(accountId),
      };
    if (!completionId) throw new Error("Completion id is required");
    if ([...this.#trainingCompletions.values()].includes(completionId))
      throw new Error("Completion id conflicts with an existing scenario");
    if (
      !Number.isSafeInteger(reward.shards) ||
      reward.shards < 0 ||
      !Number.isSafeInteger(reward.styleTokens) ||
      reward.styleTokens < 0
    )
      throw new Error("Training reward must use non-negative integers");
    const wallet = this.#wallets.get(accountId)!;
    wallet.set("shards", (wallet.get("shards") ?? 0) + reward.shards);
    wallet.set(
      "style_tokens",
      (wallet.get("style_tokens") ?? 0) + reward.styleTokens,
    );
    this.#trainingCompletions.set(key, completionId);
    this.#economyTransactions.set(`training:${accountId}:${scenarioId}`, {
      transactionId: `training:${accountId}:${scenarioId}`,
      accountId,
      kind: "reward",
      itemId: scenarioId,
      itemDelta: 1,
    });
    return {
      firstCompletion: true,
      scenarioId,
      snapshot: this.#economySnapshot(accountId),
    };
  }

  listTrainingCompletions(accountId: string): Promise<readonly string[]> {
    return Promise.resolve(
      [...this.#trainingCompletions.keys()]
        .filter((key) => key.startsWith(`${accountId}\u0000`))
        .map((key) => key.slice(accountId.length + 1)),
    );
  }

  close(): Promise<void> {
    return Promise.resolve();
  }

  #assertAccount(accountId: string): void {
    if (!this.#accounts.has(accountId))
      throw new Error(`Unknown account: ${accountId}`);
  }

  #isDuplicateTransaction(
    transactionId: string,
    accountId: string,
    kind: EconomyTransaction["kind"],
  ): boolean {
    if (!transactionId) throw new Error("Transaction id is required");
    const existing = this.#economyTransactions.get(transactionId);
    if (!existing) return false;
    if (existing.accountId !== accountId || existing.kind !== kind)
      throw new Error("Transaction id conflicts with an existing operation");
    return true;
  }

  #economySnapshot(accountId: string): EconomySnapshot {
    const wallets =
      this.#wallets.get(accountId) ?? new Map<CurrencyId, number>();
    const cards = this.#inventory.get(accountId) ?? new Map<string, number>();
    const entitlements =
      this.#entitlements.get(accountId) ??
      new Map<string, CosmeticDefinition["category"]>();
    return structuredClone({
      accountId,
      wallets: [...wallets].map(([currencyId, balance]) => ({
        currencyId,
        balance,
      })),
      cards: [...cards].map(([cardId, quantity]) => ({ cardId, quantity })),
      entitlements: [...entitlements].map(([entitlementId, category]) => ({
        entitlementId,
        category,
      })),
    });
  }
}
