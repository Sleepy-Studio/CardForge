import type { ReplayRecord } from "@cardforge/rules-kernel";
import type {
  CompetitiveProfile,
  MatchOutcomeReason,
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
  OwnedCard,
} from "@cardforge/economy";
import type { CardDefinition } from "@cardforge/card-schema";
import type { LiveOpsDefinition } from "@cardforge/live-ops";

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

export interface TrainingCompletionResult {
  readonly firstCompletion: boolean;
  readonly scenarioId: string;
  readonly snapshot: EconomySnapshot;
}

export interface AuditRecord {
  readonly auditId: string;
  readonly actorId: string;
  readonly action: string;
  readonly targetId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly createdAt: string;
}

export interface SupportCase {
  readonly caseId: string;
  readonly accountId: string;
  readonly status: "open" | "resolved";
  readonly summary: string;
  readonly notes: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type MatchQueue = "casual" | "ranked" | "friend" | "practice" | "pve";

export interface MatchParticipantInput {
  readonly seat: PlayerId;
  readonly accountId: string | null;
  readonly displayName: string;
  readonly deckId: string | null;
  readonly deckName: string | null;
  readonly leaderId: string;
}

/** Server-derived per-seat statistics; never client-reported. */
export interface ParticipantStats {
  readonly cardsPlayed: number;
  readonly cardIdsPlayed: Readonly<Record<string, number>>;
  readonly cardsDrawn: number;
  readonly mulliganCount: number;
  readonly reactions: number;
  readonly choices: number;
  readonly dominion: number;
  readonly integrity: number;
  readonly actions: number;
  readonly actionMsTotal: number;
  readonly disconnects: number;
  readonly reconnects: number;
  readonly timeouts: number;
}

export interface MatchOutcomeInput {
  readonly matchId: string;
  readonly winnerId: PlayerId;
  readonly reason: MatchOutcomeReason;
  readonly cycles: number;
  readonly stats: Readonly<Record<PlayerId, ParticipantStats>>;
}

export interface MatchMeta {
  readonly matchId: string;
  readonly queue: MatchQueue | null;
  readonly status: MatchRecordStatus;
  readonly winnerId: PlayerId | null;
  readonly reason: MatchOutcomeReason | null;
  readonly cycles: number | null;
  readonly commandCount: number;
  readonly createdAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export interface MatchParticipantRecord extends MatchParticipantInput {
  readonly result: "win" | "loss" | null;
  readonly stats: Partial<ParticipantStats>;
}

export interface MatchRewardInput {
  readonly matchId: string;
  readonly accountId: string;
  readonly queue: MatchQueue;
  readonly seasonId: string;
  readonly participant: RankedParticipant;
  readonly won: boolean;
  readonly cycles: number;
  readonly shards: number;
  /** Unranked XP; ranked XP is granted by the ranked settlement. */
  readonly grantUnrankedXp: boolean;
}

export interface MatchRewardReceipt {
  readonly matchId: string;
  readonly accountId: string;
  readonly shards: number;
  readonly xp: number;
  readonly levelBefore: number;
  readonly levelAfter: number;
  readonly newlyUnlockedLeaderIds: readonly string[];
}

export interface MatchHistoryEntry {
  readonly matchId: string;
  readonly queue: MatchQueue | null;
  readonly status: MatchRecordStatus;
  readonly seat: PlayerId;
  readonly result: "win" | "loss" | null;
  readonly reason: MatchOutcomeReason | null;
  readonly leaderId: string;
  readonly deckId: string | null;
  readonly deckName: string | null;
  readonly opponent: {
    readonly displayName: string;
    readonly leaderId: string;
  } | null;
  readonly cycles: number | null;
  readonly commandCount: number;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly ratingDelta: number | null;
  readonly reward: { readonly shards: number; readonly xp: number } | null;
}

export interface InviteRecord {
  readonly code: string;
  readonly hostAccountId: string;
  readonly guestAccountId: string | null;
  readonly status: "open" | "claimed" | "started" | "cancelled";
  readonly matchId: string | null;
  readonly createdAt: string;
  readonly expiresAt: string;
}

export class InviteError extends Error {
  constructor(
    readonly code:
      | "INVITE_NOT_FOUND"
      | "INVITE_EXPIRED"
      | "INVITE_USED"
      | "INVITE_OWN"
      | "INVITE_CODE_TAKEN",
  ) {
    super(code);
    this.name = "InviteError";
  }
}

export interface QuestActivity {
  readonly matchesPlayed: number;
  readonly matchesWon: number;
  readonly dominion: number;
  readonly reactions: number;
  readonly scenarios: number;
}

export interface ProductEventRecord {
  readonly eventId: string;
  readonly accountId: string | null;
  readonly name: string;
  readonly properties: Readonly<Record<string, string | number | boolean>>;
  readonly createdAt: string;
}

export interface CompletedMatchSummary {
  readonly meta: MatchMeta;
  readonly participants: readonly MatchParticipantRecord[];
}

export type AccountRole = "player" | "admin";

export interface AccountRecord {
  readonly accountId: string;
  readonly displayName: string;
  readonly role: AccountRole;
  readonly status: "active" | "suspended";
  readonly starterLeaderId: string | null;
  readonly onboardingCompletedAt: string | null;
  readonly createdAt: string;
}

export interface SessionRecord {
  readonly accountId: string;
  readonly expiresAt: string;
  readonly lastSeenAt: string;
}

export type OAuthProvider = "discord";

export interface PasswordRegistration {
  /** Account ID used when no claim code is supplied. */
  readonly accountId: string;
  readonly displayName: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: AccountRole;
  /** SHA-256 digest of an operator-issued legacy account claim code. */
  readonly claimCodeHash?: string;
}

export class AuthStoreError extends Error {
  constructor(
    readonly code: "EMAIL_TAKEN" | "CLAIM_INVALID" | "ACCOUNT_HAS_CREDENTIAL",
  ) {
    super(code);
    this.name = "AuthStoreError";
  }
}

export interface CardForgeStore {
  /** Applies pending migrations and returns the IDs applied by this call. */
  migrate(
    log?: (event: {
      readonly migrationId: string;
      readonly durationMs: number;
    }) => void,
  ): Promise<readonly string[]>;
  /** Cheap connectivity probe used by the readiness endpoint. */
  ping(): Promise<void>;
  upsertAccount(accountId: string, displayName: string): Promise<void>;
  getAccount(accountId: string): Promise<AccountRecord | null>;
  updateAccountProfile(
    accountId: string,
    update: { readonly displayName?: string; readonly role?: AccountRole },
  ): Promise<AccountRecord | null>;
  /** Creates (or claims) an account and its password credential atomically. */
  registerPasswordAccount(input: PasswordRegistration): Promise<string>;
  getPasswordCredential(
    email: string,
  ): Promise<{ readonly accountId: string; readonly passwordHash: string } | null>;
  /** Finds or atomically creates the account bound to an OAuth identity. */
  resolveOAuthAccount(input: {
    readonly provider: OAuthProvider;
    readonly subject: string;
    readonly newAccountId: string;
    readonly displayName: string;
    readonly role: AccountRole;
  }): Promise<{ readonly accountId: string; readonly created: boolean }>;
  findOAuthAccount(
    provider: OAuthProvider,
    subject: string,
  ): Promise<string | null>;
  createSession(input: {
    readonly tokenHash: string;
    readonly accountId: string;
    readonly expiresAt: string;
  }): Promise<void>;
  /** Returns only unexpired sessions. */
  getSession(tokenHash: string): Promise<SessionRecord | null>;
  touchSession(tokenHash: string, expiresAt: string): Promise<void>;
  deleteSession(tokenHash: string): Promise<void>;
  deleteAccountSessions(accountId: string): Promise<void>;
  createAccountClaim(input: {
    readonly codeHash: string;
    readonly accountId: string;
    readonly expiresAt: string;
  }): Promise<void>;
  /**
   * Grants the starter collection and saves the starter deck exactly once.
   * Returns false (and changes nothing) if a starter was already chosen.
   */
  grantStarter(input: {
    readonly accountId: string;
    readonly starterLeaderId: string;
    readonly grant: readonly OwnedCard[];
    readonly deck: DeckRecord;
  }): Promise<boolean>;
  markOnboardingComplete(accountId: string): Promise<AccountRecord | null>;
  deleteDeck(accountId: string, deckId: string): Promise<boolean>;
  recordMatchStart(input: {
    readonly matchId: string;
    readonly queue: MatchQueue;
    readonly participants: readonly MatchParticipantInput[];
  }): Promise<void>;
  /** Records the outcome once; returns false if already recorded. */
  recordMatchOutcome(input: MatchOutcomeInput): Promise<boolean>;
  getMatchMeta(matchId: string): Promise<MatchMeta | null>;
  getMatchParticipants(
    matchId: string,
  ): Promise<readonly MatchParticipantRecord[]>;
  /** Exactly-once per (match, account); returns null for a repeat. */
  settleMatchReward(input: MatchRewardInput): Promise<MatchRewardReceipt | null>;
  listMatchHistory(
    accountId: string,
    options?: { readonly limit?: number; readonly before?: string },
  ): Promise<readonly MatchHistoryEntry[]>;
  listCompletedMatches(options: {
    readonly since?: string;
    readonly limit: number;
  }): Promise<readonly CompletedMatchSummary[]>;
  createInvite(input: {
    readonly code: string;
    readonly hostAccountId: string;
    readonly expiresAt: string;
  }): Promise<InviteRecord>;
  getInvite(code: string): Promise<InviteRecord | null>;
  /** Host re-entry is allowed; the first other account becomes the guest. */
  admitToInvite(code: string, accountId: string): Promise<InviteRecord>;
  markInviteStarted(code: string, matchId: string): Promise<void>;
  cancelInvite(code: string, hostAccountId: string): Promise<boolean>;
  questActivity(accountId: string, since: string): Promise<QuestActivity>;
  listQuestClaims(
    accountId: string,
  ): Promise<readonly { readonly questId: string; readonly periodKey: string }[]>;
  /** Exactly-once per (account, quest, period). */
  claimQuestReward(input: {
    readonly accountId: string;
    readonly questId: string;
    readonly periodKey: string;
    readonly reward: {
      readonly shards?: number;
      readonly styleTokens?: number;
      readonly cosmetic?: CosmeticDefinition;
    };
  }): Promise<{ readonly claimed: boolean; readonly snapshot: EconomySnapshot }>;
  recordProductEvent(
    input: Omit<ProductEventRecord, "createdAt">,
  ): Promise<void>;
  listProductEvents(options: {
    readonly since?: string;
    readonly limit: number;
  }): Promise<readonly ProductEventRecord[]>;
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
  completeTrainingScenario(
    completionId: string,
    accountId: string,
    scenarioId: string,
    reward: { readonly shards: number; readonly styleTokens: number },
  ): Promise<TrainingCompletionResult>;
  listTrainingCompletions(accountId: string): Promise<readonly string[]>;
  saveLiveOpsDefinition(definition: LiveOpsDefinition): Promise<void>;
  listLiveOpsDefinitions(): Promise<readonly LiveOpsDefinition[]>;
  appendAudit(record: Omit<AuditRecord, "createdAt">): Promise<AuditRecord>;
  listAudit(limit?: number): Promise<readonly AuditRecord[]>;
  createSupportCase(input: {
    readonly caseId: string;
    readonly accountId: string;
    readonly summary: string;
  }): Promise<SupportCase>;
  updateSupportCase(input: {
    readonly caseId: string;
    readonly status?: SupportCase["status"];
    readonly note?: string;
  }): Promise<SupportCase>;
  listSupportCases(input?: {
    readonly accountId?: string;
    readonly status?: SupportCase["status"];
  }): Promise<readonly SupportCase[]>;
  close(): Promise<void>;
}
