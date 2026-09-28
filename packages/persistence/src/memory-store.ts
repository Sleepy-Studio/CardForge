import { admitInvite } from "./invites.js";
import {
  AuthStoreError,
  InviteError,
  type CompletedMatchSummary,
  type InviteRecord,
  type MatchHistoryEntry,
  type MatchMeta,
  type MatchOutcomeInput,
  type MatchParticipantInput,
  type MatchParticipantRecord,
  type MatchQueue,
  type MatchRewardInput,
  type MatchRewardReceipt,
  type ProductEventRecord,
  type QuestActivity,
  type AccountRecord,
  type AccountRole,
  type CardForgeStore,
  type DeckRecord,
  type OAuthProvider,
  type PasswordRegistration,
  type SessionRecord,
  type StoredMatchRecord,
} from "./types.js";
import type {
  CompetitiveProfile,
  MatchTelemetry,
} from "@cardforge/competitive";
import {
  createCompetitiveProfile,
  progressUnrankedProfile,
  settleRankedMatch,
  type RankedSettlement,
} from "@cardforge/competitive";
import type { RankedCompletion } from "./types.js";
import type {
  AuditRecord,
  SupportCase,
  TrainingCompletionResult,
} from "./types.js";
import type { LiveOpsDefinition } from "@cardforge/live-ops";
import {
  economyBootstrap,
  quoteCraft,
  type CosmeticDefinition,
  type CurrencyId,
  type EconomySnapshot,
  type EconomyTransaction,
  type OwnedCard,
} from "@cardforge/economy";
import type { CardDefinition } from "@cardforge/card-schema";

export class MemoryCardForgeStore implements CardForgeStore {
  readonly #accounts = new Map<string, AccountRecord>();
  readonly #matchMeta = new Map<string, MatchMeta>();
  readonly #participants = new Map<string, MatchParticipantRecord[]>();
  readonly #matchRewards = new Map<string, MatchRewardReceipt>();
  readonly #invites = new Map<string, InviteRecord>();
  readonly #questClaims = new Map<
    string,
    { questId: string; periodKey: string; accountId: string }
  >();
  readonly #productEvents = new Map<string, ProductEventRecord>();
  readonly #trainingCompletedAt = new Map<string, string>();
  readonly #passwords = new Map<
    string,
    { readonly accountId: string; readonly passwordHash: string }
  >();
  readonly #oauth = new Map<string, string>();
  readonly #sessions = new Map<string, SessionRecord>();
  readonly #claims = new Map<
    string,
    { accountId: string; expiresAt: string; consumed: boolean }
  >();
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
  readonly #liveOps = new Map<string, LiveOpsDefinition>();
  readonly #audit = new Map<string, AuditRecord>();
  readonly #supportCases = new Map<string, SupportCase>();

  #deckKey(accountId: string, deckId: string): string {
    return `${accountId}\u0000${deckId}`;
  }

  migrate(): Promise<readonly string[]> {
    return Promise.resolve([]);
  }

  ping(): Promise<void> {
    return Promise.resolve();
  }

  upsertAccount(accountId: string, displayName: string): Promise<void> {
    const existing = this.#accounts.get(accountId);
    this.#accounts.set(
      accountId,
      existing
        ? { ...existing, displayName }
        : {
            accountId,
            displayName,
            role: "player",
            status: "active",
            starterLeaderId: null,
            onboardingCompletedAt: null,
            createdAt: new Date().toISOString(),
          },
    );
    return Promise.resolve();
  }

  getAccount(accountId: string): Promise<AccountRecord | null> {
    const account = this.#accounts.get(accountId);
    return Promise.resolve(account ? { ...account } : null);
  }

  updateAccountProfile(
    accountId: string,
    update: { readonly displayName?: string; readonly role?: AccountRole },
  ): Promise<AccountRecord | null> {
    const account = this.#accounts.get(accountId);
    if (!account) return Promise.resolve(null);
    const next = {
      ...account,
      ...(update.displayName === undefined
        ? {}
        : { displayName: update.displayName }),
      ...(update.role === undefined ? {} : { role: update.role }),
    };
    this.#accounts.set(accountId, next);
    return Promise.resolve({ ...next });
  }

  async registerPasswordAccount(input: PasswordRegistration): Promise<string> {
    if (this.#passwords.has(input.email))
      throw new AuthStoreError("EMAIL_TAKEN");
    let accountId = input.accountId;
    if (input.claimCodeHash !== undefined) {
      const claim = this.#claims.get(input.claimCodeHash);
      if (!claim || claim.consumed || Date.parse(claim.expiresAt) <= Date.now())
        throw new AuthStoreError("CLAIM_INVALID");
      if (
        [...this.#passwords.values()].some(
          (credential) => credential.accountId === claim.accountId,
        )
      )
        throw new AuthStoreError("ACCOUNT_HAS_CREDENTIAL");
      claim.consumed = true;
      accountId = claim.accountId;
    } else await this.upsertAccount(accountId, input.displayName);
    if (input.role === "admin")
      await this.updateAccountProfile(accountId, { role: "admin" });
    this.#passwords.set(input.email, {
      accountId,
      passwordHash: input.passwordHash,
    });
    return accountId;
  }

  getPasswordCredential(email: string): Promise<{
    readonly accountId: string;
    readonly passwordHash: string;
  } | null> {
    const credential = this.#passwords.get(email);
    return Promise.resolve(credential ? { ...credential } : null);
  }

  async resolveOAuthAccount(input: {
    readonly provider: OAuthProvider;
    readonly subject: string;
    readonly newAccountId: string;
    readonly displayName: string;
    readonly role: AccountRole;
  }): Promise<{ readonly accountId: string; readonly created: boolean }> {
    const key = `${input.provider}\u0000${input.subject}`;
    const existing = this.#oauth.get(key);
    if (existing) return { accountId: existing, created: false };
    await this.upsertAccount(input.newAccountId, input.displayName);
    if (input.role === "admin")
      await this.updateAccountProfile(input.newAccountId, { role: "admin" });
    this.#oauth.set(key, input.newAccountId);
    return { accountId: input.newAccountId, created: true };
  }

  findOAuthAccount(
    provider: OAuthProvider,
    subject: string,
  ): Promise<string | null> {
    return Promise.resolve(
      this.#oauth.get(`${provider}\u0000${subject}`) ?? null,
    );
  }

  createSession(input: {
    readonly tokenHash: string;
    readonly accountId: string;
    readonly expiresAt: string;
  }): Promise<void> {
    this.#assertAccount(input.accountId);
    this.#sessions.set(input.tokenHash, {
      accountId: input.accountId,
      expiresAt: input.expiresAt,
      lastSeenAt: new Date().toISOString(),
    });
    return Promise.resolve();
  }

  getSession(tokenHash: string): Promise<SessionRecord | null> {
    const session = this.#sessions.get(tokenHash);
    if (!session || Date.parse(session.expiresAt) <= Date.now())
      return Promise.resolve(null);
    return Promise.resolve({ ...session });
  }

  touchSession(tokenHash: string, expiresAt: string): Promise<void> {
    const session = this.#sessions.get(tokenHash);
    if (session)
      this.#sessions.set(tokenHash, {
        ...session,
        expiresAt,
        lastSeenAt: new Date().toISOString(),
      });
    return Promise.resolve();
  }

  deleteSession(tokenHash: string): Promise<void> {
    this.#sessions.delete(tokenHash);
    return Promise.resolve();
  }

  deleteAccountSessions(accountId: string): Promise<void> {
    for (const [hash, session] of this.#sessions)
      if (session.accountId === accountId) this.#sessions.delete(hash);
    return Promise.resolve();
  }

  resetPasswordWithClaim(input: {
    readonly codeHash: string;
    readonly passwordHash: string;
  }): Promise<string | null> {
    const claim = this.#claims.get(input.codeHash);
    if (!claim || claim.consumed || Date.parse(claim.expiresAt) <= Date.now())
      return Promise.resolve(null);
    const entry = [...this.#passwords.entries()].find(
      ([, credential]) => credential.accountId === claim.accountId,
    );
    if (!entry) return Promise.resolve(null);
    claim.consumed = true;
    this.#passwords.set(entry[0], {
      accountId: claim.accountId,
      passwordHash: input.passwordHash,
    });
    for (const [hash, session] of this.#sessions)
      if (session.accountId === claim.accountId) this.#sessions.delete(hash);
    return Promise.resolve(claim.accountId);
  }

  createAccountClaim(input: {
    readonly codeHash: string;
    readonly accountId: string;
    readonly expiresAt: string;
  }): Promise<void> {
    this.#assertAccount(input.accountId);
    this.#claims.set(input.codeHash, {
      accountId: input.accountId,
      expiresAt: input.expiresAt,
      consumed: false,
    });
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
    const matchId = record.replay.matchId;
    const meta = this.#matchMeta.get(matchId);
    const status = meta?.completedAt ? meta.status : record.status;
    this.#matches.set(matchId, structuredClone({ ...record, status }));
    this.#matchMeta.set(matchId, {
      matchId,
      queue: meta?.queue ?? null,
      status,
      winnerId: meta?.winnerId ?? null,
      reason: meta?.reason ?? null,
      cycles: meta?.cycles ?? null,
      commandCount: record.replay.acceptedCommands.length,
      createdAt: meta?.createdAt ?? new Date().toISOString(),
      startedAt: meta?.startedAt ?? null,
      completedAt: meta?.completedAt ?? null,
    });
    return Promise.resolve();
  }

  getMatch(matchId: string): Promise<StoredMatchRecord | null> {
    const record = this.#matches.get(matchId);
    return Promise.resolve(record ? structuredClone(record) : null);
  }

  async grantStarter(input: {
    readonly accountId: string;
    readonly starterLeaderId: string;
    readonly grant: readonly OwnedCard[];
    readonly deck: DeckRecord;
  }): Promise<boolean> {
    const account = this.#accounts.get(input.accountId);
    if (!account) throw new Error(`Unknown account: ${input.accountId}`);
    if (account.starterLeaderId !== null) return false;
    // Claim the starter slot before yielding so concurrent calls grant once.
    this.#accounts.set(input.accountId, {
      ...account,
      starterLeaderId: input.starterLeaderId,
    });
    await this.bootstrapEconomy(input.accountId);
    const inventory = this.#inventory.get(input.accountId)!;
    for (const card of input.grant)
      inventory.set(
        card.cardId,
        Math.max(inventory.get(card.cardId) ?? 0, card.quantity),
      );
    this.#economyTransactions.set(`starter:${input.accountId}`, {
      transactionId: `starter:${input.accountId}`,
      accountId: input.accountId,
      kind: "starter_grant",
      itemId: input.starterLeaderId,
      itemDelta: input.grant.reduce((total, card) => total + card.quantity, 0),
    });
    await this.saveDeck(input.deck);
    return true;
  }

  markOnboardingComplete(accountId: string): Promise<AccountRecord | null> {
    const account = this.#accounts.get(accountId);
    if (!account) return Promise.resolve(null);
    const next = {
      ...account,
      onboardingCompletedAt:
        account.onboardingCompletedAt ?? new Date().toISOString(),
    };
    this.#accounts.set(accountId, next);
    return Promise.resolve({ ...next });
  }

  deleteDeck(accountId: string, deckId: string): Promise<boolean> {
    return Promise.resolve(
      this.#decks.delete(this.#deckKey(accountId, deckId)),
    );
  }

  recordMatchStart(input: {
    readonly matchId: string;
    readonly queue: MatchQueue;
    readonly participants: readonly MatchParticipantInput[];
  }): Promise<void> {
    const meta = this.#matchMeta.get(input.matchId);
    if (!meta)
      return Promise.reject(new Error(`Unknown match: ${input.matchId}`));
    this.#matchMeta.set(input.matchId, {
      ...meta,
      queue: input.queue,
      startedAt: meta.startedAt ?? new Date().toISOString(),
    });
    const existing = this.#participants.get(input.matchId) ?? [];
    for (const participant of input.participants)
      if (!existing.some((row) => row.seat === participant.seat))
        existing.push({ ...participant, result: null, stats: {} });
    this.#participants.set(input.matchId, existing);
    return Promise.resolve();
  }

  recordMatchOutcome(input: MatchOutcomeInput): Promise<boolean> {
    const meta = this.#matchMeta.get(input.matchId);
    if (!meta || meta.completedAt) return Promise.resolve(false);
    const status = input.reason === "abandonment" ? "abandoned" : "complete";
    this.#matchMeta.set(input.matchId, {
      ...meta,
      status,
      winnerId: input.winnerId,
      reason: input.reason,
      cycles: input.cycles,
      completedAt: new Date().toISOString(),
    });
    const record = this.#matches.get(input.matchId);
    if (record) this.#matches.set(input.matchId, { ...record, status });
    this.#participants.set(
      input.matchId,
      (this.#participants.get(input.matchId) ?? []).map((row) => ({
        ...row,
        result: row.seat === input.winnerId ? "win" : "loss",
        stats: structuredClone(input.stats[row.seat]),
      })),
    );
    return Promise.resolve(true);
  }

  getMatchMeta(matchId: string): Promise<MatchMeta | null> {
    const meta = this.#matchMeta.get(matchId);
    return Promise.resolve(meta ? { ...meta } : null);
  }

  getMatchParticipants(
    matchId: string,
  ): Promise<readonly MatchParticipantRecord[]> {
    return Promise.resolve(
      structuredClone(this.#participants.get(matchId) ?? []).sort((a, b) =>
        a.seat.localeCompare(b.seat),
      ),
    );
  }

  async settleMatchReward(
    input: MatchRewardInput,
  ): Promise<MatchRewardReceipt | null> {
    const key = `${input.matchId}\u0000${input.accountId}`;
    if (this.#matchRewards.has(key)) return null;
    // Reserve the receipt before yielding so concurrent calls cannot both pay.
    this.#matchRewards.set(key, {} as MatchRewardReceipt);
    await this.bootstrapEconomy(input.accountId);
    if (input.shards > 0) {
      const wallet = this.#wallets.get(input.accountId)!;
      wallet.set("shards", (wallet.get("shards") ?? 0) + input.shards);
    }
    const profileKey = this.#profileKey(input.accountId, input.seasonId);
    const before =
      this.#profiles.get(profileKey) ??
      createCompetitiveProfile(input.accountId, input.seasonId);
    let after = before;
    let xp = 0;
    if (input.grantUnrankedXp) {
      const progressed = progressUnrankedProfile(
        before,
        input.participant,
        input.won,
        input.cycles,
      );
      after = progressed.profile;
      xp = progressed.xp;
    }
    this.#profiles.set(profileKey, after);
    const receipt: MatchRewardReceipt = {
      matchId: input.matchId,
      accountId: input.accountId,
      shards: input.shards,
      xp,
      levelBefore: before.accountLevel,
      levelAfter: after.accountLevel,
      newlyUnlockedLeaderIds: after.unlockedLeaderIds.filter(
        (leaderId) => !before.unlockedLeaderIds.includes(leaderId),
      ),
    };
    this.#matchRewards.set(key, receipt);
    return structuredClone(receipt);
  }

  listMatchHistory(
    accountId: string,
    options: { readonly limit?: number; readonly before?: string } = {},
  ): Promise<readonly MatchHistoryEntry[]> {
    const limit = Math.max(1, Math.min(100, options.limit ?? 25));
    const entries: MatchHistoryEntry[] = [];
    for (const [matchId, participants] of this.#participants) {
      const me = participants.find((row) => row.accountId === accountId);
      const meta = this.#matchMeta.get(matchId);
      if (!me || !meta) continue;
      const opponent = participants.find((row) => row.seat !== me.seat);
      const reward = this.#matchRewards.get(`${matchId}\u0000${accountId}`);
      const settlement = this.#settlements.get(matchId);
      entries.push({
        matchId,
        queue: meta.queue,
        status: meta.status,
        seat: me.seat,
        result: me.result,
        reason: meta.reason,
        leaderId: me.leaderId,
        deckId: me.deckId,
        deckName: me.deckName,
        opponent: opponent
          ? { displayName: opponent.displayName, leaderId: opponent.leaderId }
          : null,
        cycles: meta.cycles,
        commandCount: meta.commandCount,
        startedAt: meta.startedAt,
        completedAt: meta.completedAt,
        ratingDelta: settlement?.ratingDelta[me.seat] ?? null,
        reward: reward
          ? {
              shards: reward.shards,
              xp: reward.xp + (settlement?.xpGained[me.seat] ?? 0),
            }
          : null,
      });
    }
    const sortKey = (entry: MatchHistoryEntry) =>
      entry.startedAt ?? this.#matchMeta.get(entry.matchId)!.createdAt;
    return Promise.resolve(
      entries
        .filter((entry) => !options.before || sortKey(entry) < options.before)
        .sort((a, b) => sortKey(b).localeCompare(sortKey(a)))
        .slice(0, limit),
    );
  }

  listCompletedMatches(options: {
    readonly since?: string;
    readonly limit: number;
  }): Promise<readonly CompletedMatchSummary[]> {
    return Promise.resolve(
      [...this.#matchMeta.values()]
        .filter(
          (meta) =>
            meta.completedAt !== null &&
            (!options.since || meta.completedAt >= options.since),
        )
        .sort((a, b) => b.completedAt!.localeCompare(a.completedAt!))
        .slice(0, options.limit)
        .map((meta) => ({
          meta: { ...meta },
          participants: structuredClone(
            this.#participants.get(meta.matchId) ?? [],
          ),
        })),
    );
  }

  createInvite(input: {
    readonly code: string;
    readonly hostAccountId: string;
    readonly expiresAt: string;
  }): Promise<InviteRecord> {
    if (this.#invites.has(input.code))
      return Promise.reject(new InviteError("INVITE_CODE_TAKEN"));
    this.#assertAccount(input.hostAccountId);
    const invite: InviteRecord = {
      code: input.code,
      hostAccountId: input.hostAccountId,
      guestAccountId: null,
      status: "open",
      matchId: null,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
    };
    this.#invites.set(input.code, invite);
    return Promise.resolve({ ...invite });
  }

  getInvite(code: string): Promise<InviteRecord | null> {
    const invite = this.#invites.get(code);
    return Promise.resolve(invite ? { ...invite } : null);
  }

  async admitToInvite(code: string, accountId: string): Promise<InviteRecord> {
    await Promise.resolve();
    const next = admitInvite(
      this.#invites.get(code) ?? null,
      accountId,
      Date.now(),
    );
    this.#invites.set(code, next);
    return { ...next };
  }

  markInviteStarted(code: string, matchId: string): Promise<void> {
    const invite = this.#invites.get(code);
    if (invite && (invite.status === "open" || invite.status === "claimed"))
      this.#invites.set(code, { ...invite, status: "started", matchId });
    return Promise.resolve();
  }

  cancelInvite(code: string, hostAccountId: string): Promise<boolean> {
    const invite = this.#invites.get(code);
    if (
      !invite ||
      invite.hostAccountId !== hostAccountId ||
      (invite.status !== "open" && invite.status !== "claimed")
    )
      return Promise.resolve(false);
    this.#invites.set(code, { ...invite, status: "cancelled" });
    return Promise.resolve(true);
  }

  questActivity(accountId: string, since: string): Promise<QuestActivity> {
    const activity = {
      matchesPlayed: 0,
      matchesWon: 0,
      dominion: 0,
      reactions: 0,
      scenarios: 0,
    };
    for (const [matchId, participants] of this.#participants) {
      const meta = this.#matchMeta.get(matchId);
      const me = participants.find((row) => row.accountId === accountId);
      if (
        !me ||
        !meta?.completedAt ||
        meta.completedAt < since ||
        (meta.queue !== "casual" && meta.queue !== "ranked")
      )
        continue;
      activity.matchesPlayed += 1;
      if (me.result === "win") activity.matchesWon += 1;
      activity.dominion += me.stats.dominion ?? 0;
      activity.reactions += me.stats.reactions ?? 0;
    }
    for (const [key, completedAt] of this.#trainingCompletedAt)
      if (key.startsWith(`${accountId}\u0000`) && completedAt >= since)
        activity.scenarios += 1;
    return Promise.resolve(activity);
  }

  listQuestClaims(
    accountId: string,
  ): Promise<
    readonly { readonly questId: string; readonly periodKey: string }[]
  > {
    return Promise.resolve(
      [...this.#questClaims.values()]
        .filter((claim) => claim.accountId === accountId)
        .map(({ questId, periodKey }) => ({ questId, periodKey })),
    );
  }

  async claimQuestReward(input: {
    readonly accountId: string;
    readonly questId: string;
    readonly periodKey: string;
    readonly reward: {
      readonly shards?: number;
      readonly styleTokens?: number;
      readonly cosmetic?: CosmeticDefinition;
    };
  }): Promise<{
    readonly claimed: boolean;
    readonly snapshot: EconomySnapshot;
  }> {
    const key = [input.accountId, input.questId, input.periodKey].join(
      "\u0000",
    );
    if (this.#questClaims.has(key)) {
      await this.bootstrapEconomy(input.accountId);
      return {
        claimed: false,
        snapshot: this.#economySnapshot(input.accountId),
      };
    }
    this.#questClaims.set(key, {
      accountId: input.accountId,
      questId: input.questId,
      periodKey: input.periodKey,
    });
    await this.bootstrapEconomy(input.accountId);
    const wallet = this.#wallets.get(input.accountId)!;
    wallet.set(
      "shards",
      (wallet.get("shards") ?? 0) + (input.reward.shards ?? 0),
    );
    wallet.set(
      "style_tokens",
      (wallet.get("style_tokens") ?? 0) + (input.reward.styleTokens ?? 0),
    );
    if (input.reward.cosmetic)
      this.#entitlements
        .get(input.accountId)!
        .set(input.reward.cosmetic.cosmeticId, input.reward.cosmetic.category);
    return { claimed: true, snapshot: this.#economySnapshot(input.accountId) };
  }

  recordProductEvent(
    input: Omit<ProductEventRecord, "createdAt">,
  ): Promise<void> {
    if (!this.#productEvents.has(input.eventId))
      this.#productEvents.set(input.eventId, {
        ...structuredClone(input),
        createdAt: new Date().toISOString(),
      });
    return Promise.resolve();
  }

  listProductEvents(options: {
    readonly since?: string;
    readonly limit: number;
  }): Promise<readonly ProductEventRecord[]> {
    return Promise.resolve(
      [...this.#productEvents.values()]
        .filter((event) => !options.since || event.createdAt >= options.since)
        .reverse()
        .slice(0, options.limit)
        .map((event) => structuredClone(event)),
    );
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
    this.#trainingCompletedAt.set(key, new Date().toISOString());
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

  saveLiveOpsDefinition(definition: LiveOpsDefinition): Promise<void> {
    const key = `${definition.configId}\u0000${definition.revision}`;
    if (this.#liveOps.has(key))
      return Promise.reject(new Error("Live-ops revisions are immutable"));
    this.#liveOps.set(key, structuredClone(definition));
    return Promise.resolve();
  }

  listLiveOpsDefinitions(): Promise<readonly LiveOpsDefinition[]> {
    return Promise.resolve(
      [...this.#liveOps.values()]
        .sort((a, b) => b.revision - a.revision)
        .map((definition) => structuredClone(definition)),
    );
  }

  appendAudit(record: Omit<AuditRecord, "createdAt">): Promise<AuditRecord> {
    const existing = this.#audit.get(record.auditId);
    if (existing) {
      if (
        existing.actorId !== record.actorId ||
        existing.action !== record.action ||
        existing.targetId !== record.targetId
      )
        return Promise.reject(
          new Error("Audit id conflicts with an existing record"),
        );
      return Promise.resolve(structuredClone(existing));
    }
    const stored: AuditRecord = {
      ...structuredClone(record),
      createdAt: new Date().toISOString(),
    };
    this.#audit.set(record.auditId, stored);
    return Promise.resolve(structuredClone(stored));
  }

  listAudit(limit = 100): Promise<readonly AuditRecord[]> {
    return Promise.resolve(
      [...this.#audit.values()]
        .slice(-Math.max(0, limit))
        .reverse()
        .map((record) => structuredClone(record)),
    );
  }

  createSupportCase(input: {
    readonly caseId: string;
    readonly accountId: string;
    readonly summary: string;
  }): Promise<SupportCase> {
    this.#assertAccount(input.accountId);
    if (this.#supportCases.has(input.caseId))
      return Promise.reject(new Error("Support case already exists"));
    const now = new Date().toISOString();
    const supportCase: SupportCase = {
      ...input,
      status: "open",
      notes: [],
      createdAt: now,
      updatedAt: now,
    };
    this.#supportCases.set(input.caseId, supportCase);
    return Promise.resolve(structuredClone(supportCase));
  }

  updateSupportCase(input: {
    readonly caseId: string;
    readonly status?: SupportCase["status"];
    readonly note?: string;
  }): Promise<SupportCase> {
    const existing = this.#supportCases.get(input.caseId);
    if (!existing) return Promise.reject(new Error("Support case not found"));
    const updated: SupportCase = {
      ...existing,
      status: input.status ?? existing.status,
      notes: input.note ? [...existing.notes, input.note] : existing.notes,
      updatedAt: new Date().toISOString(),
    };
    this.#supportCases.set(input.caseId, updated);
    return Promise.resolve(structuredClone(updated));
  }

  listSupportCases(input?: {
    readonly accountId?: string;
    readonly status?: SupportCase["status"];
  }): Promise<readonly SupportCase[]> {
    return Promise.resolve(
      [...this.#supportCases.values()]
        .filter(
          (supportCase) =>
            (!input?.accountId || supportCase.accountId === input.accountId) &&
            (!input?.status || supportCase.status === input.status),
        )
        .map((supportCase) => structuredClone(supportCase)),
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
