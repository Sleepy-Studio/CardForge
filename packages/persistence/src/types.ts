import type { ReplayRecord } from "@cardforge/rules-kernel";
import type {
  CompetitiveProfile,
  MatchTelemetry,
  RankedParticipant,
  RankedSettlement,
} from "@cardforge/competitive";
import type { PlayerId } from "@cardforge/card-schema";
import type {
  CosmeticDefinition,
  CurrencyId,
  EconomySnapshot,
  EconomyTransaction,
} from "@cardforge/economy";
import type { CardDefinition } from "@cardforge/card-schema";

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

export interface RankedCompletion {
  readonly matchId: string;
  readonly seasonId: string;
  readonly participants: Readonly<Record<PlayerId, RankedParticipant>>;
  readonly winnerId: PlayerId;
  readonly cycles: number;
  readonly telemetry: MatchTelemetry;
}

export interface CardForgeStore {
  migrate(): Promise<void>;
  upsertAccount(accountId: string, displayName: string): Promise<void>;
  saveDeck(deck: DeckRecord): Promise<void>;
  getDeck(accountId: string, deckId: string): Promise<DeckRecord | null>;
  listDecks(accountId: string): Promise<readonly DeckRecord[]>;
  saveMatch(record: StoredMatchRecord): Promise<void>;
  getMatch(matchId: string): Promise<StoredMatchRecord | null>;
  getCompetitiveProfile(
    accountId: string,
    seasonId: string,
  ): Promise<CompetitiveProfile | null>;
  saveCompetitiveProfile(profile: CompetitiveProfile): Promise<void>;
  saveTelemetry(telemetry: MatchTelemetry): Promise<void>;
  listTelemetry(
    seasonId?: string,
    limit?: number,
  ): Promise<readonly MatchTelemetry[]>;
  completeRankedMatch(
    completion: RankedCompletion,
  ): Promise<RankedSettlement | null>;
  bootstrapEconomy(accountId: string): Promise<EconomySnapshot>;
  getEconomySnapshot(accountId: string): Promise<EconomySnapshot>;
  craftCard(
    transactionId: string,
    accountId: string,
    card: CardDefinition,
    quantity: number,
  ): Promise<EconomySnapshot>;
  unlockCosmetic(
    transactionId: string,
    accountId: string,
    cosmetic: CosmeticDefinition,
  ): Promise<EconomySnapshot>;
  grantReward(
    transactionId: string,
    accountId: string,
    currencyId: CurrencyId,
    amount: number,
  ): Promise<EconomySnapshot>;
  listEconomyTransactions(
    accountId: string,
    limit?: number,
  ): Promise<readonly EconomyTransaction[]>;
  close(): Promise<void>;
}
