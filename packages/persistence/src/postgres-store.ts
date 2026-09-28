import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres, { type Sql, type TransactionSql } from "postgres";
import {
  createCompetitiveProfile,
  progressUnrankedProfile,
  settleRankedMatch,
  type CompetitiveProfile,
  type MatchTelemetry,
  type RankedSettlement,
} from "@cardforge/competitive";
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
  type OAuthProvider,
  type PasswordRegistration,
  type SessionRecord,
} from "./types.js";
import { admitInvite } from "./invites.js";
import type {
  AuditRecord,
  CardForgeStore,
  DeckRecord,
  RankedCompletion,
  StoredMatchRecord,
  SupportCase,
  TrainingCompletionResult,
} from "./types.js";
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
import type { LiveOpsDefinition } from "@cardforge/live-ops";

interface DeckRow {
  deck_id: string;
  account_id: string;
  game_id: string;
  format_id: string;
  leader_id: string;
  name: string;
  revision: number;
  card_ids: string[];
}

interface MatchRow {
  status: StoredMatchRecord["status"];
  replay: StoredMatchRecord["replay"];
}

interface ProfileRow {
  account_id: string;
  season_id: string;
  rating: number;
  wins: number;
  losses: number;
  account_xp: number;
  account_level: number;
  aspect_mastery: CompetitiveProfile["aspectMastery"];
  unlocked_leader_ids: string[];
}

interface TelemetryRow {
  telemetry: MatchTelemetry;
}

interface WalletRow {
  currency_id: CurrencyId;
  balance: number;
}

interface InventoryRow {
  card_id: string;
  quantity: number;
}

interface EntitlementRow {
  entitlement_id: string;
  category: CosmeticDefinition["category"];
}

interface EconomyTransactionRow {
  transaction_id: string;
  account_id: string;
  kind: EconomyTransaction["kind"];
  currency_id: CurrencyId | null;
  currency_delta: number | null;
  item_id: string | null;
  item_delta: number | null;
}

interface LiveOpsRow {
  definition: LiveOpsDefinition;
}

interface AuditRow {
  audit_id: string;
  actor_id: string;
  action: string;
  target_id: string;
  payload: Readonly<Record<string, unknown>>;
  created_at: Date;
}

interface AccountRow {
  account_id: string;
  display_name: string;
  role: AccountRole;
  status: AccountRecord["status"];
  starter_leader_id: string | null;
  onboarding_completed_at: Date | null;
  created_at: Date;
}

interface MatchMetaRow {
  match_id: string;
  queue: MatchQueue | null;
  status: StoredMatchRecord["status"];
  winner_id: "p1" | "p2" | null;
  outcome_reason: MatchMeta["reason"];
  cycles: number | null;
  command_count: number;
  created_at: Date;
  started_at: Date | null;
  completed_at: Date | null;
}

interface ParticipantRow {
  match_id: string;
  seat: "p1" | "p2";
  account_id: string | null;
  display_name: string;
  deck_id: string | null;
  deck_name: string | null;
  leader_id: string;
  result: "win" | "loss" | null;
  stats: MatchParticipantRecord["stats"];
}

interface InviteRow {
  code: string;
  host_account_id: string;
  guest_account_id: string | null;
  status: InviteRecord["status"];
  match_id: string | null;
  created_at: Date;
  expires_at: Date;
}

interface SupportCaseRow {
  case_id: string;
  account_id: string;
  status: SupportCase["status"];
  summary: string;
  notes: string[];
  created_at: Date;
  updated_at: Date;
}

/** Stable advisory-lock key for schema migrations ("cardforge" as int). */
const migrationLockKey = 0x63_66_6d_67;

export class PostgresCardForgeStore implements CardForgeStore {
  readonly #sql: Sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 10 });
  }

  /**
   * Applies pending migrations in order. A session-level advisory lock makes
   * concurrent starts (several replicas, or a migrate job racing the server)
   * wait rather than apply the same migration twice.
   */
  async migrate(
    log: (event: { readonly migrationId: string; readonly durationMs: number }) => void = () => {},
  ): Promise<readonly string[]> {
    const reserved = await this.#sql.reserve();
    try {
      await reserved`SELECT pg_advisory_lock(${migrationLockKey})`;
      return await this.#applyMigrations(log);
    } finally {
      await reserved`SELECT pg_advisory_unlock(${migrationLockKey})`;
      reserved.release();
    }
  }

  async #applyMigrations(
    log: (event: { readonly migrationId: string; readonly durationMs: number }) => void,
  ): Promise<readonly string[]> {
    const appliedNow: string[] = [];
    await this.#sql`
      CREATE TABLE IF NOT EXISTS cardforge_schema_migrations (
        migration_id text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `;
    for (const migrationId of [
      "0001_alpha_storage",
      "0002_account_scoped_decks",
      "0003_competitive_beta",
      "0004_launch_economy",
      "0005_training_progress",
      "0006_live_ops_support",
      "0007_production_auth",
      "0008_player_journey",
    ]) {
      const applied = await this.#sql<{ migration_id: string }[]>`
        SELECT migration_id FROM cardforge_schema_migrations
        WHERE migration_id = ${migrationId}
      `;
      if (applied.length) continue;
      const startedAt = Date.now();
      const path = fileURLToPath(
        new URL(`../migrations/${migrationId}.sql`, import.meta.url),
      );
      const migration = await readFile(path, "utf8");
      await this.#sql.begin(async (sql) => {
        await sql.unsafe(migration);
        await sql`
          INSERT INTO cardforge_schema_migrations (migration_id)
          VALUES (${migrationId})
        `;
      });
      appliedNow.push(migrationId);
      log({ migrationId, durationMs: Date.now() - startedAt });
    }
    return appliedNow;
  }

  async ping(): Promise<void> {
    await this.#sql`SELECT 1`;
  }

  async upsertAccount(accountId: string, displayName: string): Promise<void> {
    await this.#sql`
      INSERT INTO cardforge_accounts (account_id, display_name)
      VALUES (${accountId}, ${displayName})
      ON CONFLICT (account_id) DO UPDATE SET display_name = EXCLUDED.display_name
    `;
  }

  async getAccount(accountId: string): Promise<AccountRecord | null> {
    const rows = await this.#sql<AccountRow[]>`
      SELECT account_id, display_name, role, status, starter_leader_id,
             onboarding_completed_at, created_at
      FROM cardforge_accounts WHERE account_id = ${accountId}
    `;
    return rows[0] ? this.#accountFromRow(rows[0]) : null;
  }

  async updateAccountProfile(
    accountId: string,
    update: { readonly displayName?: string; readonly role?: AccountRole },
  ): Promise<AccountRecord | null> {
    const rows = await this.#sql<AccountRow[]>`
      UPDATE cardforge_accounts
      SET display_name = COALESCE(${update.displayName ?? null}, display_name),
          role = COALESCE(${update.role ?? null}, role)
      WHERE account_id = ${accountId}
      RETURNING account_id, display_name, role, status, starter_leader_id,
                onboarding_completed_at, created_at
    `;
    return rows[0] ? this.#accountFromRow(rows[0]) : null;
  }

  registerPasswordAccount(input: PasswordRegistration): Promise<string> {
    return this.#sql.begin(async (sql) => {
      let accountId = input.accountId;
      if (input.claimCodeHash !== undefined) {
        const claims = await sql<{ account_id: string }[]>`
          UPDATE cardforge_account_claims
          SET consumed_at = now()
          WHERE code_hash = ${input.claimCodeHash}
            AND consumed_at IS NULL
            AND expires_at > now()
          RETURNING account_id
        `;
        if (!claims[0]) throw new AuthStoreError("CLAIM_INVALID");
        accountId = claims[0].account_id;
        const existing = await sql`
          SELECT 1 FROM cardforge_password_credentials
          WHERE account_id = ${accountId}
        `;
        if (existing.length) throw new AuthStoreError("ACCOUNT_HAS_CREDENTIAL");
      } else
        await sql`
          INSERT INTO cardforge_accounts (account_id, display_name, role)
          VALUES (${accountId}, ${input.displayName}, ${input.role})
        `;
      if (input.role === "admin")
        await sql`
          UPDATE cardforge_accounts SET role = 'admin'
          WHERE account_id = ${accountId}
        `;
      const inserted = await sql`
        INSERT INTO cardforge_password_credentials (
          account_id, email, password_hash
        ) VALUES (${accountId}, ${input.email}, ${input.passwordHash})
        ON CONFLICT (email) DO NOTHING
        RETURNING account_id
      `;
      if (!inserted.length) throw new AuthStoreError("EMAIL_TAKEN");
      return accountId;
    });
  }

  async getPasswordCredential(
    email: string,
  ): Promise<{ readonly accountId: string; readonly passwordHash: string } | null> {
    const rows = await this.#sql<{ account_id: string; password_hash: string }[]>`
      SELECT account_id, password_hash FROM cardforge_password_credentials
      WHERE email = ${email}
    `;
    return rows[0]
      ? { accountId: rows[0].account_id, passwordHash: rows[0].password_hash }
      : null;
  }

  resolveOAuthAccount(input: {
    readonly provider: OAuthProvider;
    readonly subject: string;
    readonly newAccountId: string;
    readonly displayName: string;
    readonly role: AccountRole;
  }): Promise<{ readonly accountId: string; readonly created: boolean }> {
    return this.#sql.begin(async (sql) => {
      // Serialise concurrent first logins for the same identity.
      await sql`
        SELECT pg_advisory_xact_lock(hashtext(${`${input.provider}:${input.subject}`}))
      `;
      const existing = await sql<{ account_id: string }[]>`
        SELECT account_id FROM cardforge_oauth_identities
        WHERE provider = ${input.provider} AND subject = ${input.subject}
      `;
      if (existing[0])
        return { accountId: existing[0].account_id, created: false };
      await sql`
        INSERT INTO cardforge_accounts (account_id, display_name, role)
        VALUES (${input.newAccountId}, ${input.displayName}, ${input.role})
      `;
      await sql`
        INSERT INTO cardforge_oauth_identities (provider, subject, account_id)
        VALUES (${input.provider}, ${input.subject}, ${input.newAccountId})
      `;
      return { accountId: input.newAccountId, created: true };
    });
  }

  async findOAuthAccount(
    provider: OAuthProvider,
    subject: string,
  ): Promise<string | null> {
    const rows = await this.#sql<{ account_id: string }[]>`
      SELECT account_id FROM cardforge_oauth_identities
      WHERE provider = ${provider} AND subject = ${subject}
    `;
    return rows[0]?.account_id ?? null;
  }

  async createSession(input: {
    readonly tokenHash: string;
    readonly accountId: string;
    readonly expiresAt: string;
  }): Promise<void> {
    await this.#sql`
      INSERT INTO cardforge_sessions (token_hash, account_id, expires_at)
      VALUES (${input.tokenHash}, ${input.accountId}, ${input.expiresAt})
    `;
  }

  async getSession(tokenHash: string): Promise<SessionRecord | null> {
    const rows = await this.#sql<
      { account_id: string; expires_at: Date; last_seen_at: Date }[]
    >`
      SELECT account_id, expires_at, last_seen_at FROM cardforge_sessions
      WHERE token_hash = ${tokenHash} AND expires_at > now()
    `;
    const row = rows[0];
    return row
      ? {
          accountId: row.account_id,
          expiresAt: row.expires_at.toISOString(),
          lastSeenAt: row.last_seen_at.toISOString(),
        }
      : null;
  }

  async touchSession(tokenHash: string, expiresAt: string): Promise<void> {
    await this.#sql`
      UPDATE cardforge_sessions
      SET expires_at = ${expiresAt}, last_seen_at = now()
      WHERE token_hash = ${tokenHash}
    `;
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.#sql`
      DELETE FROM cardforge_sessions WHERE token_hash = ${tokenHash}
    `;
  }

  async deleteAccountSessions(accountId: string): Promise<void> {
    await this.#sql`
      DELETE FROM cardforge_sessions WHERE account_id = ${accountId}
    `;
  }

  async createAccountClaim(input: {
    readonly codeHash: string;
    readonly accountId: string;
    readonly expiresAt: string;
  }): Promise<void> {
    await this.#sql`
      INSERT INTO cardforge_account_claims (code_hash, account_id, expires_at)
      VALUES (${input.codeHash}, ${input.accountId}, ${input.expiresAt})
    `;
  }

  grantStarter(input: {
    readonly accountId: string;
    readonly starterLeaderId: string;
    readonly grant: readonly OwnedCard[];
    readonly deck: DeckRecord;
  }): Promise<boolean> {
    return this.#sql.begin(async (sql) => {
      const rows = await sql<{ starter_leader_id: string | null }[]>`
        SELECT starter_leader_id FROM cardforge_accounts
        WHERE account_id = ${input.accountId}
        FOR UPDATE
      `;
      if (!rows[0]) throw new Error(`Unknown account: ${input.accountId}`);
      if (rows[0].starter_leader_id !== null) return false;
      await this.#bootstrapEconomy(sql, input.accountId);
      for (const card of input.grant)
        await sql`
          INSERT INTO cardforge_inventory (account_id, card_id, quantity)
          VALUES (${input.accountId}, ${card.cardId}, ${card.quantity})
          ON CONFLICT (account_id, card_id) DO UPDATE SET
            quantity = GREATEST(cardforge_inventory.quantity, EXCLUDED.quantity),
            updated_at = now()
        `;
      await sql`
        INSERT INTO cardforge_economy_transactions (
          transaction_id, account_id, kind, item_id, item_delta, payload
        ) VALUES (
          ${`starter:${input.accountId}`}, ${input.accountId}, 'starter_grant',
          ${input.starterLeaderId},
          ${input.grant.reduce((total, card) => total + card.quantity, 0)},
          ${sql.json({ leaderId: input.starterLeaderId, cards: input.grant } as never)}
        )
      `;
      await this.#saveDeck(sql, input.deck);
      await sql`
        UPDATE cardforge_accounts SET starter_leader_id = ${input.starterLeaderId}
        WHERE account_id = ${input.accountId}
      `;
      return true;
    });
  }

  async markOnboardingComplete(
    accountId: string,
  ): Promise<AccountRecord | null> {
    await this.#sql`
      UPDATE cardforge_accounts
      SET onboarding_completed_at = COALESCE(onboarding_completed_at, now())
      WHERE account_id = ${accountId}
    `;
    return this.getAccount(accountId);
  }

  async deleteDeck(accountId: string, deckId: string): Promise<boolean> {
    const rows = await this.#sql`
      DELETE FROM cardforge_decks
      WHERE account_id = ${accountId} AND deck_id = ${deckId}
      RETURNING deck_id
    `;
    return rows.length > 0;
  }

  recordMatchStart(input: {
    readonly matchId: string;
    readonly queue: MatchQueue;
    readonly participants: readonly MatchParticipantInput[];
  }): Promise<void> {
    return this.#sql.begin(async (sql) => {
      const updated = await sql`
        UPDATE cardforge_match_records
        SET queue = ${input.queue}, started_at = COALESCE(started_at, now())
        WHERE match_id = ${input.matchId}
        RETURNING match_id
      `;
      if (!updated.length) throw new Error(`Unknown match: ${input.matchId}`);
      for (const participant of input.participants)
        await sql`
          INSERT INTO cardforge_match_participants (
            match_id, seat, account_id, display_name, deck_id, deck_name, leader_id
          ) VALUES (
            ${input.matchId}, ${participant.seat}, ${participant.accountId},
            ${participant.displayName}, ${participant.deckId},
            ${participant.deckName}, ${participant.leaderId}
          )
          ON CONFLICT (match_id, seat) DO NOTHING
        `;
    });
  }

  recordMatchOutcome(input: MatchOutcomeInput): Promise<boolean> {
    return this.#sql.begin(async (sql) => {
      const updated = await sql`
        UPDATE cardforge_match_records
        SET status = ${input.reason === "abandonment" ? "abandoned" : "complete"},
            winner_id = ${input.winnerId},
            outcome_reason = ${input.reason},
            cycles = ${input.cycles},
            completed_at = now(),
            updated_at = now()
        WHERE match_id = ${input.matchId} AND completed_at IS NULL
        RETURNING match_id
      `;
      if (!updated.length) return false;
      for (const seat of ["p1", "p2"] as const)
        await sql`
          UPDATE cardforge_match_participants
          SET result = ${seat === input.winnerId ? "win" : "loss"},
              stats = ${sql.json(input.stats[seat] as never)}
          WHERE match_id = ${input.matchId} AND seat = ${seat}
        `;
      return true;
    });
  }

  async getMatchMeta(matchId: string): Promise<MatchMeta | null> {
    const rows = await this.#sql<MatchMetaRow[]>`
      SELECT match_id, queue, status, winner_id, outcome_reason, cycles,
             command_count, created_at, started_at, completed_at
      FROM cardforge_match_records WHERE match_id = ${matchId}
    `;
    return rows[0] ? this.#metaFromRow(rows[0]) : null;
  }

  async getMatchParticipants(
    matchId: string,
  ): Promise<readonly MatchParticipantRecord[]> {
    const rows = await this.#sql<ParticipantRow[]>`
      SELECT match_id, seat, account_id, display_name, deck_id, deck_name,
             leader_id, result, stats
      FROM cardforge_match_participants
      WHERE match_id = ${matchId}
      ORDER BY seat
    `;
    return rows.map((row) => this.#participantFromRow(row));
  }

  settleMatchReward(
    input: MatchRewardInput,
  ): Promise<MatchRewardReceipt | null> {
    return this.#sql.begin(async (sql) => {
      const inserted = await sql`
        INSERT INTO cardforge_match_rewards (match_id, account_id, queue, reward)
        VALUES (${input.matchId}, ${input.accountId}, ${input.queue}, ${sql.json({})})
        ON CONFLICT (match_id, account_id) DO NOTHING
        RETURNING match_id
      `;
      if (!inserted.length) return null;
      await this.#bootstrapEconomy(sql, input.accountId);
      if (input.shards > 0) {
        await sql`
          UPDATE cardforge_wallets
          SET balance = balance + ${input.shards}, updated_at = now()
          WHERE account_id = ${input.accountId} AND currency_id = 'shards'
        `;
        await this.#recordEconomyTransaction(sql, {
          transactionId: `match-reward:${input.matchId}:${input.accountId}`,
          accountId: input.accountId,
          kind: "reward",
          currencyId: "shards",
          currencyDelta: input.shards,
          itemId: input.matchId,
        });
      }
      const initial = createCompetitiveProfile(input.accountId, input.seasonId);
      await sql`
        INSERT INTO cardforge_competitive_profiles (
          account_id, season_id, rating, wins, losses, account_xp,
          account_level, aspect_mastery, unlocked_leader_ids
        ) VALUES (
          ${initial.accountId}, ${initial.seasonId}, ${initial.rating},
          ${initial.wins}, ${initial.losses}, ${initial.accountXp},
          ${initial.accountLevel}, ${sql.json(initial.aspectMastery)},
          ${initial.unlockedLeaderIds as string[]}
        )
        ON CONFLICT (account_id, season_id) DO NOTHING
      `;
      const profiles = await sql<ProfileRow[]>`
        SELECT account_id, season_id, rating, wins, losses, account_xp,
               account_level, aspect_mastery, unlocked_leader_ids
        FROM cardforge_competitive_profiles
        WHERE account_id = ${input.accountId} AND season_id = ${input.seasonId}
        FOR UPDATE
      `;
      const before = this.#profileFromRow(profiles[0]!);
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
        await this.#saveProfile(sql, after);
      }
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
      await sql`
        UPDATE cardforge_match_rewards SET reward = ${sql.json(receipt as never)}
        WHERE match_id = ${input.matchId} AND account_id = ${input.accountId}
      `;
      return receipt;
    });
  }

  async listMatchHistory(
    accountId: string,
    options: { readonly limit?: number; readonly before?: string } = {},
  ): Promise<readonly MatchHistoryEntry[]> {
    const limit = Math.max(1, Math.min(100, options.limit ?? 25));
    const rows = await this.#sql<
      (MatchMetaRow & {
        seat: "p1" | "p2";
        result: "win" | "loss" | null;
        leader_id: string;
        deck_id: string | null;
        deck_name: string | null;
        opponent_name: string | null;
        opponent_leader: string | null;
        settlement: {
          ratingDelta?: Record<string, number>;
          xpGained?: Record<string, number>;
        } | null;
        reward: Partial<MatchRewardReceipt> | null;
      })[]
    >`
      SELECT m.match_id, m.queue, m.status, m.winner_id, m.outcome_reason,
             m.cycles, m.command_count, m.created_at, m.started_at,
             m.completed_at, me.seat, me.result, me.leader_id, me.deck_id,
             me.deck_name, opp.display_name AS opponent_name,
             opp.leader_id AS opponent_leader, rs.settlement, r.reward
      FROM cardforge_match_participants me
      JOIN cardforge_match_records m ON m.match_id = me.match_id
      LEFT JOIN cardforge_match_participants opp
        ON opp.match_id = me.match_id AND opp.seat <> me.seat
      LEFT JOIN cardforge_ranked_settlements rs ON rs.match_id = me.match_id
      LEFT JOIN cardforge_match_rewards r
        ON r.match_id = me.match_id AND r.account_id = me.account_id
      WHERE me.account_id = ${accountId}
        AND (${options.before ?? null}::timestamptz IS NULL
             OR COALESCE(m.started_at, m.created_at) < ${options.before ?? null}::timestamptz)
      ORDER BY COALESCE(m.started_at, m.created_at) DESC
      LIMIT ${limit}
    `;
    return rows.map((row) => {
      const meta = this.#metaFromRow(row);
      const rankedXp = row.settlement?.xpGained?.[row.seat];
      return {
        matchId: meta.matchId,
        queue: meta.queue,
        status: meta.status,
        seat: row.seat,
        result: row.result,
        reason: meta.reason,
        leaderId: row.leader_id,
        deckId: row.deck_id,
        deckName: row.deck_name,
        opponent:
          row.opponent_name && row.opponent_leader
            ? { displayName: row.opponent_name, leaderId: row.opponent_leader }
            : null,
        cycles: meta.cycles,
        commandCount: meta.commandCount,
        startedAt: meta.startedAt,
        completedAt: meta.completedAt,
        ratingDelta: row.settlement?.ratingDelta?.[row.seat] ?? null,
        reward: row.reward?.matchId
          ? {
              shards: row.reward.shards ?? 0,
              xp: (row.reward.xp ?? 0) + (rankedXp ?? 0),
            }
          : null,
      };
    });
  }

  async listCompletedMatches(options: {
    readonly since?: string;
    readonly limit: number;
  }): Promise<readonly CompletedMatchSummary[]> {
    const limit = Math.max(1, Math.min(10_000, options.limit));
    const metas = await this.#sql<MatchMetaRow[]>`
      SELECT match_id, queue, status, winner_id, outcome_reason, cycles,
             command_count, created_at, started_at, completed_at
      FROM cardforge_match_records
      WHERE completed_at IS NOT NULL
        AND (${options.since ?? null}::timestamptz IS NULL
             OR completed_at >= ${options.since ?? null}::timestamptz)
      ORDER BY completed_at DESC
      LIMIT ${limit}
    `;
    if (!metas.length) return [];
    const participants = await this.#sql<ParticipantRow[]>`
      SELECT match_id, seat, account_id, display_name, deck_id, deck_name,
             leader_id, result, stats
      FROM cardforge_match_participants
      WHERE match_id IN ${this.#sql(metas.map((row) => row.match_id))}
    `;
    const byMatch = new Map<string, MatchParticipantRecord[]>();
    for (const row of participants) {
      const list = byMatch.get(row.match_id) ?? [];
      list.push(this.#participantFromRow(row));
      byMatch.set(row.match_id, list);
    }
    return metas.map((row) => ({
      meta: this.#metaFromRow(row),
      participants: (byMatch.get(row.match_id) ?? []).sort((a, b) =>
        a.seat.localeCompare(b.seat),
      ),
    }));
  }

  async createInvite(input: {
    readonly code: string;
    readonly hostAccountId: string;
    readonly expiresAt: string;
  }): Promise<InviteRecord> {
    const rows = await this.#sql<InviteRow[]>`
      INSERT INTO cardforge_match_invites (code, host_account_id, status, expires_at)
      VALUES (${input.code}, ${input.hostAccountId}, 'open', ${input.expiresAt})
      ON CONFLICT (code) DO NOTHING
      RETURNING code, host_account_id, guest_account_id, status, match_id,
                created_at, expires_at
    `;
    if (!rows[0]) throw new InviteError("INVITE_CODE_TAKEN");
    return this.#inviteFromRow(rows[0]);
  }

  async getInvite(code: string): Promise<InviteRecord | null> {
    const rows = await this.#sql<InviteRow[]>`
      SELECT code, host_account_id, guest_account_id, status, match_id,
             created_at, expires_at
      FROM cardforge_match_invites WHERE code = ${code}
    `;
    return rows[0] ? this.#inviteFromRow(rows[0]) : null;
  }

  admitToInvite(code: string, accountId: string): Promise<InviteRecord> {
    return this.#sql.begin(async (sql) => {
      const rows = await sql<InviteRow[]>`
        SELECT code, host_account_id, guest_account_id, status, match_id,
               created_at, expires_at
        FROM cardforge_match_invites WHERE code = ${code}
        FOR UPDATE
      `;
      const invite = rows[0] ? this.#inviteFromRow(rows[0]) : null;
      const next = admitInvite(invite, accountId, Date.now());
      if (next !== invite)
        await sql`
          UPDATE cardforge_match_invites
          SET guest_account_id = ${next.guestAccountId}, status = ${next.status}
          WHERE code = ${code}
        `;
      return next;
    });
  }

  async markInviteStarted(code: string, matchId: string): Promise<void> {
    await this.#sql`
      UPDATE cardforge_match_invites
      SET status = 'started', match_id = ${matchId}
      WHERE code = ${code} AND status IN ('open', 'claimed')
    `;
  }

  async cancelInvite(code: string, hostAccountId: string): Promise<boolean> {
    const rows = await this.#sql`
      UPDATE cardforge_match_invites SET status = 'cancelled'
      WHERE code = ${code} AND host_account_id = ${hostAccountId}
        AND status IN ('open', 'claimed')
      RETURNING code
    `;
    return rows.length > 0;
  }

  async questActivity(accountId: string, since: string): Promise<QuestActivity> {
    const [matches] = await this.#sql<
      { played: number; won: number; dominion: number; reactions: number }[]
    >`
      SELECT count(*)::int AS played,
             count(*) FILTER (WHERE p.result = 'win')::int AS won,
             COALESCE(sum((p.stats->>'dominion')::int), 0)::int AS dominion,
             COALESCE(sum((p.stats->>'reactions')::int), 0)::int AS reactions
      FROM cardforge_match_participants p
      JOIN cardforge_match_records m ON m.match_id = p.match_id
      WHERE p.account_id = ${accountId}
        AND m.completed_at >= ${since}::timestamptz
        AND m.queue IN ('casual', 'ranked')
    `;
    const [scenarios] = await this.#sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM cardforge_training_completions
      WHERE account_id = ${accountId} AND completed_at >= ${since}::timestamptz
    `;
    return {
      matchesPlayed: matches?.played ?? 0,
      matchesWon: matches?.won ?? 0,
      dominion: matches?.dominion ?? 0,
      reactions: matches?.reactions ?? 0,
      scenarios: scenarios?.count ?? 0,
    };
  }

  async listQuestClaims(
    accountId: string,
  ): Promise<readonly { readonly questId: string; readonly periodKey: string }[]> {
    const rows = await this.#sql<{ quest_id: string; period_key: string }[]>`
      SELECT quest_id, period_key FROM cardforge_quest_claims
      WHERE account_id = ${accountId}
      ORDER BY claimed_at DESC
      LIMIT 500
    `;
    return rows.map((row) => ({ questId: row.quest_id, periodKey: row.period_key }));
  }

  claimQuestReward(input: {
    readonly accountId: string;
    readonly questId: string;
    readonly periodKey: string;
    readonly reward: {
      readonly shards?: number;
      readonly styleTokens?: number;
      readonly cosmetic?: CosmeticDefinition;
    };
  }): Promise<{ readonly claimed: boolean; readonly snapshot: EconomySnapshot }> {
    return this.#sql.begin(async (sql) => {
      await this.#bootstrapEconomy(sql, input.accountId);
      const inserted = await sql`
        INSERT INTO cardforge_quest_claims (account_id, quest_id, period_key, reward)
        VALUES (
          ${input.accountId}, ${input.questId}, ${input.periodKey},
          ${sql.json({
            shards: input.reward.shards ?? 0,
            styleTokens: input.reward.styleTokens ?? 0,
            cosmeticId: input.reward.cosmetic?.cosmeticId ?? null,
          })}
        )
        ON CONFLICT (account_id, quest_id, period_key) DO NOTHING
        RETURNING quest_id
      `;
      if (!inserted.length)
        return {
          claimed: false,
          snapshot: await this.#economySnapshot(sql, input.accountId),
        };
      for (const [currencyId, amount] of [
        ["shards", input.reward.shards ?? 0],
        ["style_tokens", input.reward.styleTokens ?? 0],
      ] as const)
        if (amount > 0)
          await sql`
            UPDATE cardforge_wallets
            SET balance = balance + ${amount}, updated_at = now()
            WHERE account_id = ${input.accountId} AND currency_id = ${currencyId}
          `;
      if (input.reward.cosmetic)
        await sql`
          INSERT INTO cardforge_entitlements (account_id, entitlement_id, category)
          VALUES (
            ${input.accountId}, ${input.reward.cosmetic.cosmeticId},
            ${input.reward.cosmetic.category}
          )
          ON CONFLICT (account_id, entitlement_id) DO NOTHING
        `;
      await this.#recordEconomyTransaction(sql, {
        transactionId: `quest:${input.accountId}:${input.questId}:${input.periodKey}`,
        accountId: input.accountId,
        kind: "reward",
        ...(input.reward.shards
          ? { currencyId: "shards" as const, currencyDelta: input.reward.shards }
          : {}),
        itemId: input.questId,
        itemDelta: 1,
      });
      return {
        claimed: true,
        snapshot: await this.#economySnapshot(sql, input.accountId),
      };
    });
  }

  async recordProductEvent(
    input: Omit<ProductEventRecord, "createdAt">,
  ): Promise<void> {
    await this.#sql`
      INSERT INTO cardforge_product_events (event_id, account_id, name, properties)
      VALUES (
        ${input.eventId}, ${input.accountId}, ${input.name},
        ${this.#sql.json(input.properties as never)}
      )
      ON CONFLICT (event_id) DO NOTHING
    `;
  }

  async listProductEvents(options: {
    readonly since?: string;
    readonly limit: number;
  }): Promise<readonly ProductEventRecord[]> {
    const limit = Math.max(1, Math.min(50_000, options.limit));
    const rows = await this.#sql<
      {
        event_id: string;
        account_id: string | null;
        name: string;
        properties: ProductEventRecord["properties"];
        created_at: Date;
      }[]
    >`
      SELECT event_id, account_id, name, properties, created_at
      FROM cardforge_product_events
      WHERE (${options.since ?? null}::timestamptz IS NULL
             OR created_at >= ${options.since ?? null}::timestamptz)
      ORDER BY created_at DESC
      LIMIT ${limit}
    `;
    return rows.map((row) => ({
      eventId: row.event_id,
      accountId: row.account_id,
      name: row.name,
      properties: row.properties,
      createdAt: row.created_at.toISOString(),
    }));
  }

  async saveDeck(deck: DeckRecord): Promise<void> {
    await this.#sql.begin((sql) => this.#saveDeck(sql, deck));
  }

  async #saveDeck(sql: TransactionSql, deck: DeckRecord): Promise<void> {
    {
      await sql`
        INSERT INTO cardforge_decks (
          deck_id, account_id, game_id, format_id, leader_id, name, revision
        ) VALUES (
          ${deck.deckId}, ${deck.accountId}, ${deck.gameId}, ${deck.formatId},
          ${deck.leaderId}, ${deck.name}, ${deck.revision}
        )
        ON CONFLICT (account_id, deck_id) DO UPDATE SET
          game_id = EXCLUDED.game_id,
          format_id = EXCLUDED.format_id,
          leader_id = EXCLUDED.leader_id,
          name = EXCLUDED.name,
          revision = EXCLUDED.revision,
          updated_at = now()
      `;
      await sql`
        DELETE FROM cardforge_deck_cards
        WHERE account_id = ${deck.accountId} AND deck_id = ${deck.deckId}
      `;
      for (const [position, cardId] of deck.cardIds.entries())
        await sql`
          INSERT INTO cardforge_deck_cards (
            account_id, deck_id, position, card_id
          ) VALUES (
            ${deck.accountId}, ${deck.deckId}, ${position}, ${cardId}
          )
        `;
    }
  }

  async getDeck(accountId: string, deckId: string): Promise<DeckRecord | null> {
    const rows = await this.#sql<DeckRow[]>`
      SELECT d.deck_id, d.account_id, d.game_id, d.format_id, d.leader_id,
             d.name, d.revision,
             COALESCE(array_agg(c.card_id ORDER BY c.position)
               FILTER (WHERE c.card_id IS NOT NULL), '{}') AS card_ids
      FROM cardforge_decks d
      LEFT JOIN cardforge_deck_cards c
        ON c.account_id = d.account_id AND c.deck_id = d.deck_id
      WHERE d.account_id = ${accountId} AND d.deck_id = ${deckId}
      GROUP BY d.account_id, d.deck_id
    `;
    return rows[0] ? this.#deckFromRow(rows[0]) : null;
  }

  async listDecks(accountId: string): Promise<readonly DeckRecord[]> {
    const rows = await this.#sql<DeckRow[]>`
      SELECT d.deck_id, d.account_id, d.game_id, d.format_id, d.leader_id,
             d.name, d.revision,
             COALESCE(array_agg(c.card_id ORDER BY c.position)
               FILTER (WHERE c.card_id IS NOT NULL), '{}') AS card_ids
      FROM cardforge_decks d
      LEFT JOIN cardforge_deck_cards c
        ON c.account_id = d.account_id AND c.deck_id = d.deck_id
      WHERE d.account_id = ${accountId}
      GROUP BY d.account_id, d.deck_id
      ORDER BY d.name, d.deck_id
    `;
    return rows.map((row) => this.#deckFromRow(row));
  }

  async saveMatch(record: StoredMatchRecord): Promise<void> {
    const replay = record.replay;
    await this.#sql`
      INSERT INTO cardforge_match_records (
        match_id, status, ruleset_revision, format_id, format_revision,
        content_hash, command_count, final_state_hash, replay
      ) VALUES (
        ${replay.matchId}, ${record.status}, ${replay.rulesetRevision},
        ${replay.formatId}, ${replay.formatRevision}, ${replay.contentHash},
        ${replay.acceptedCommands.length}, ${replay.finalStateHash},
        ${this.#sql.json(replay as never)}
      )
      ON CONFLICT (match_id) DO UPDATE SET
        status = CASE
          WHEN cardforge_match_records.completed_at IS NOT NULL
            THEN cardforge_match_records.status
          ELSE EXCLUDED.status
        END,
        command_count = EXCLUDED.command_count,
        final_state_hash = EXCLUDED.final_state_hash,
        replay = EXCLUDED.replay,
        updated_at = now()
    `;
  }

  async getMatch(matchId: string): Promise<StoredMatchRecord | null> {
    const rows = await this.#sql<MatchRow[]>`
      SELECT status, replay
      FROM cardforge_match_records
      WHERE match_id = ${matchId}
    `;
    return rows[0] ? structuredClone(rows[0]) : null;
  }

  async getCompetitiveProfile(
    accountId: string,
    seasonId: string,
  ): Promise<CompetitiveProfile | null> {
    const rows = await this.#sql<ProfileRow[]>`
      SELECT account_id, season_id, rating, wins, losses, account_xp,
             account_level, aspect_mastery, unlocked_leader_ids
      FROM cardforge_competitive_profiles
      WHERE account_id = ${accountId} AND season_id = ${seasonId}
    `;
    return rows[0] ? this.#profileFromRow(rows[0]) : null;
  }

  async saveCompetitiveProfile(profile: CompetitiveProfile): Promise<void> {
    await this.#saveProfile(this.#sql, profile);
  }

  async saveTelemetry(telemetry: MatchTelemetry): Promise<void> {
    await this.#saveTelemetry(this.#sql, telemetry);
  }

  async listTelemetry(
    seasonId?: string,
    limit = 1_000,
  ): Promise<readonly MatchTelemetry[]> {
    const boundedLimit = Math.max(0, Math.min(10_000, limit));
    const rows = seasonId
      ? await this.#sql<TelemetryRow[]>`
          SELECT telemetry FROM cardforge_match_telemetry
          WHERE season_id = ${seasonId}
          ORDER BY created_at DESC
          LIMIT ${boundedLimit}
        `
      : await this.#sql<TelemetryRow[]>`
          SELECT telemetry FROM cardforge_match_telemetry
          ORDER BY created_at DESC
          LIMIT ${boundedLimit}
        `;
    return rows.map((row) => structuredClone(row.telemetry));
  }

  async completeRankedMatch(
    completion: RankedCompletion,
  ): Promise<RankedSettlement | null> {
    return this.#sql.begin(async (sql) => {
      const winnerAccountId =
        completion.participants[completion.winnerId].accountId;
      const inserted = await sql<{ match_id: string }[]>`
        INSERT INTO cardforge_ranked_settlements (
          match_id, season_id, winner_account_id, settlement
        ) VALUES (
          ${completion.matchId}, ${completion.seasonId}, ${winnerAccountId},
          ${sql.json({})}
        )
        ON CONFLICT (match_id) DO NOTHING
        RETURNING match_id
      `;
      if (!inserted.length) return null;

      for (const participant of Object.values(completion.participants)) {
        const initial = createCompetitiveProfile(
          participant.accountId,
          completion.seasonId,
        );
        await sql`
          INSERT INTO cardforge_competitive_profiles (
            account_id, season_id, rating, wins, losses, account_xp,
            account_level, aspect_mastery, unlocked_leader_ids
          ) VALUES (
            ${initial.accountId}, ${initial.seasonId}, ${initial.rating},
            ${initial.wins}, ${initial.losses}, ${initial.accountXp},
            ${initial.accountLevel}, ${sql.json(initial.aspectMastery)},
            ${initial.unlockedLeaderIds as string[]}
          )
          ON CONFLICT (account_id, season_id) DO NOTHING
        `;
      }
      const accountIds = [
        completion.participants.p1.accountId,
        completion.participants.p2.accountId,
      ];
      const rows = await sql<ProfileRow[]>`
        SELECT account_id, season_id, rating, wins, losses, account_xp,
               account_level, aspect_mastery, unlocked_leader_ids
        FROM cardforge_competitive_profiles
        WHERE season_id = ${completion.seasonId}
          AND account_id IN ${sql(accountIds)}
        ORDER BY account_id
        FOR UPDATE
      `;
      const byAccount = new Map(
        rows.map((row) => [row.account_id, this.#profileFromRow(row)]),
      );
      const profiles = {
        p1: byAccount.get(completion.participants.p1.accountId)!,
        p2: byAccount.get(completion.participants.p2.accountId)!,
      };
      const settlement = settleRankedMatch(
        completion.matchId,
        completion.seasonId,
        profiles,
        completion.participants,
        completion.winnerId,
        completion.cycles,
      );
      await this.#saveProfile(sql, settlement.profiles.p1);
      await this.#saveProfile(sql, settlement.profiles.p2);
      await this.#saveTelemetry(sql, completion.telemetry);
      await sql`
        UPDATE cardforge_ranked_settlements
        SET settlement = ${sql.json(settlement as never)}
        WHERE match_id = ${completion.matchId}
      `;
      return settlement;
    });
  }

  bootstrapEconomy(accountId: string): Promise<EconomySnapshot> {
    return this.#sql.begin(async (sql) => {
      await this.#bootstrapEconomy(sql, accountId);
      return this.#economySnapshot(sql, accountId);
    });
  }

  async getEconomySnapshot(accountId: string): Promise<EconomySnapshot> {
    await this.bootstrapEconomy(accountId);
    return this.#economySnapshot(this.#sql, accountId);
  }

  craftCard(
    transactionId: string,
    accountId: string,
    card: CardDefinition,
    quantity: number,
  ): Promise<EconomySnapshot> {
    return this.#sql.begin(async (sql) => {
      await this.#bootstrapEconomy(sql, accountId);
      if (
        await this.#duplicateTransaction(sql, transactionId, accountId, "craft")
      )
        return this.#economySnapshot(sql, accountId);
      const inventoryRows = await sql<InventoryRow[]>`
        SELECT card_id, quantity FROM cardforge_inventory
        WHERE account_id = ${accountId} AND card_id = ${card.cardId}
        FOR UPDATE
      `;
      const quote = quoteCraft(card, inventoryRows[0]?.quantity ?? 0, quantity);
      const wallets = await sql<WalletRow[]>`
        SELECT currency_id, balance FROM cardforge_wallets
        WHERE account_id = ${accountId} AND currency_id = 'shards'
        FOR UPDATE
      `;
      const balance = wallets[0]?.balance ?? 0;
      if (balance < quote.totalCost) throw new Error("Insufficient shards");
      await sql`
        UPDATE cardforge_wallets
        SET balance = balance - ${quote.totalCost}, updated_at = now()
        WHERE account_id = ${accountId} AND currency_id = 'shards'
      `;
      await sql`
        INSERT INTO cardforge_inventory (account_id, card_id, quantity)
        VALUES (${accountId}, ${card.cardId}, ${quantity})
        ON CONFLICT (account_id, card_id) DO UPDATE SET
          quantity = cardforge_inventory.quantity + EXCLUDED.quantity,
          updated_at = now()
      `;
      await this.#recordEconomyTransaction(sql, {
        transactionId,
        accountId,
        kind: "craft",
        currencyId: "shards",
        currencyDelta: -quote.totalCost,
        itemId: card.cardId,
        itemDelta: quantity,
      });
      return this.#economySnapshot(sql, accountId);
    });
  }

  unlockCosmetic(
    transactionId: string,
    accountId: string,
    cosmetic: CosmeticDefinition,
  ): Promise<EconomySnapshot> {
    return this.#sql.begin(async (sql) => {
      await this.#bootstrapEconomy(sql, accountId);
      if (
        await this.#duplicateTransaction(
          sql,
          transactionId,
          accountId,
          "cosmetic_unlock",
        )
      )
        return this.#economySnapshot(sql, accountId);
      const entitlement = await sql<EntitlementRow[]>`
        SELECT entitlement_id, category FROM cardforge_entitlements
        WHERE account_id = ${accountId}
          AND entitlement_id = ${cosmetic.cosmeticId}
      `;
      if (entitlement.length) throw new Error("Cosmetic already unlocked");
      const wallets = await sql<WalletRow[]>`
        SELECT currency_id, balance FROM cardforge_wallets
        WHERE account_id = ${accountId} AND currency_id = 'style_tokens'
        FOR UPDATE
      `;
      const balance = wallets[0]?.balance ?? 0;
      if (balance < cosmetic.styleTokenCost)
        throw new Error("Insufficient style tokens");
      await sql`
        UPDATE cardforge_wallets
        SET balance = balance - ${cosmetic.styleTokenCost}, updated_at = now()
        WHERE account_id = ${accountId} AND currency_id = 'style_tokens'
      `;
      await sql`
        INSERT INTO cardforge_entitlements (
          account_id, entitlement_id, category
        ) VALUES (
          ${accountId}, ${cosmetic.cosmeticId}, ${cosmetic.category}
        )
      `;
      await this.#recordEconomyTransaction(sql, {
        transactionId,
        accountId,
        kind: "cosmetic_unlock",
        currencyId: "style_tokens",
        currencyDelta: -cosmetic.styleTokenCost,
        itemId: cosmetic.cosmeticId,
        itemDelta: 1,
      });
      return this.#economySnapshot(sql, accountId);
    });
  }

  grantReward(
    transactionId: string,
    accountId: string,
    currencyId: CurrencyId,
    amount: number,
  ): Promise<EconomySnapshot> {
    return this.#sql.begin(async (sql) => {
      await this.#bootstrapEconomy(sql, accountId);
      if (
        await this.#duplicateTransaction(
          sql,
          transactionId,
          accountId,
          "reward",
        )
      )
        return this.#economySnapshot(sql, accountId);
      if (!Number.isSafeInteger(amount) || amount <= 0)
        throw new Error("Reward amount must be a positive integer");
      await sql`
        UPDATE cardforge_wallets
        SET balance = balance + ${amount}, updated_at = now()
        WHERE account_id = ${accountId} AND currency_id = ${currencyId}
      `;
      await this.#recordEconomyTransaction(sql, {
        transactionId,
        accountId,
        kind: "reward",
        currencyId,
        currencyDelta: amount,
      });
      return this.#economySnapshot(sql, accountId);
    });
  }

  async listEconomyTransactions(
    accountId: string,
    limit = 100,
  ): Promise<readonly EconomyTransaction[]> {
    const boundedLimit = Math.max(0, Math.min(1_000, limit));
    const rows = await this.#sql<EconomyTransactionRow[]>`
      SELECT transaction_id, account_id, kind, currency_id, currency_delta,
             item_id, item_delta
      FROM cardforge_economy_transactions
      WHERE account_id = ${accountId}
      ORDER BY created_at DESC
      LIMIT ${boundedLimit}
    `;
    return rows.map((row) => this.#economyTransactionFromRow(row));
  }

  completeTrainingScenario(
    completionId: string,
    accountId: string,
    scenarioId: string,
    reward: { readonly shards: number; readonly styleTokens: number },
  ): Promise<TrainingCompletionResult> {
    return this.#sql.begin(async (sql) => {
      await this.#bootstrapEconomy(sql, accountId);
      if (!completionId) throw new Error("Completion id is required");
      if (
        !Number.isSafeInteger(reward.shards) ||
        reward.shards < 0 ||
        !Number.isSafeInteger(reward.styleTokens) ||
        reward.styleTokens < 0
      )
        throw new Error("Training reward must use non-negative integers");
      const inserted = await sql<{ scenario_id: string }[]>`
        INSERT INTO cardforge_training_completions (
          account_id, scenario_id, completion_id, reward
        ) VALUES (
          ${accountId}, ${scenarioId}, ${completionId}, ${sql.json(reward)}
        )
        ON CONFLICT (account_id, scenario_id) DO NOTHING
        RETURNING scenario_id
      `;
      if (!inserted.length)
        return {
          firstCompletion: false,
          scenarioId,
          snapshot: await this.#economySnapshot(sql, accountId),
        };
      await sql`
        UPDATE cardforge_wallets
        SET balance = balance + CASE
          WHEN currency_id = 'shards' THEN ${reward.shards}::integer
          ELSE ${reward.styleTokens}::integer
        END,
        updated_at = now()
        WHERE account_id = ${accountId}
          AND currency_id IN ('shards', 'style_tokens')
      `;
      await this.#recordEconomyTransaction(sql, {
        transactionId: `training:${accountId}:${scenarioId}`,
        accountId,
        kind: "reward",
        itemId: scenarioId,
        itemDelta: 1,
      });
      return {
        firstCompletion: true,
        scenarioId,
        snapshot: await this.#economySnapshot(sql, accountId),
      };
    });
  }

  async listTrainingCompletions(accountId: string): Promise<readonly string[]> {
    const rows = await this.#sql<{ scenario_id: string }[]>`
      SELECT scenario_id FROM cardforge_training_completions
      WHERE account_id = ${accountId}
      ORDER BY completed_at, scenario_id
    `;
    return rows.map((row) => row.scenario_id);
  }

  async saveLiveOpsDefinition(definition: LiveOpsDefinition): Promise<void> {
    const inserted = await this.#sql<{ config_id: string }[]>`
      INSERT INTO cardforge_live_ops_definitions (
        config_id, revision, state, definition
      ) VALUES (
        ${definition.configId}, ${definition.revision}, ${definition.state},
        ${this.#sql.json(definition as never)}
      )
      ON CONFLICT (config_id, revision) DO NOTHING
      RETURNING config_id
    `;
    if (!inserted.length) throw new Error("Live-ops revisions are immutable");
  }

  async listLiveOpsDefinitions(): Promise<readonly LiveOpsDefinition[]> {
    const rows = await this.#sql<LiveOpsRow[]>`
      SELECT definition FROM cardforge_live_ops_definitions
      ORDER BY revision DESC, created_at DESC
    `;
    return rows.map((row) => structuredClone(row.definition));
  }

  async appendAudit(
    record: Omit<AuditRecord, "createdAt">,
  ): Promise<AuditRecord> {
    const inserted = await this.#sql<AuditRow[]>`
      INSERT INTO cardforge_audit_log (
        audit_id, actor_id, action, target_id, payload
      ) VALUES (
        ${record.auditId}, ${record.actorId}, ${record.action},
        ${record.targetId}, ${this.#sql.json(record.payload as never)}
      )
      ON CONFLICT (audit_id) DO NOTHING
      RETURNING audit_id, actor_id, action, target_id, payload, created_at
    `;
    if (inserted[0]) return this.#auditFromRow(inserted[0]);
    const existing = await this.#sql<AuditRow[]>`
      SELECT audit_id, actor_id, action, target_id, payload, created_at
      FROM cardforge_audit_log WHERE audit_id = ${record.auditId}
    `;
    const row = existing[0]!;
    if (
      row.actor_id !== record.actorId ||
      row.action !== record.action ||
      row.target_id !== record.targetId
    )
      throw new Error("Audit id conflicts with an existing record");
    return this.#auditFromRow(row);
  }

  async listAudit(limit = 100): Promise<readonly AuditRecord[]> {
    const boundedLimit = Math.max(0, Math.min(1_000, limit));
    const rows = await this.#sql<AuditRow[]>`
      SELECT audit_id, actor_id, action, target_id, payload, created_at
      FROM cardforge_audit_log
      ORDER BY created_at DESC
      LIMIT ${boundedLimit}
    `;
    return rows.map((row) => this.#auditFromRow(row));
  }

  async createSupportCase(input: {
    readonly caseId: string;
    readonly accountId: string;
    readonly summary: string;
  }): Promise<SupportCase> {
    const rows = await this.#sql<SupportCaseRow[]>`
      INSERT INTO cardforge_support_cases (
        case_id, account_id, status, summary
      ) VALUES (${input.caseId}, ${input.accountId}, 'open', ${input.summary})
      RETURNING case_id, account_id, status, summary, notes,
                created_at, updated_at
    `;
    return this.#supportCaseFromRow(rows[0]!);
  }

  async updateSupportCase(input: {
    readonly caseId: string;
    readonly status?: SupportCase["status"];
    readonly note?: string;
  }): Promise<SupportCase> {
    const rows = await this.#sql<SupportCaseRow[]>`
      UPDATE cardforge_support_cases
      SET status = COALESCE(${input.status ?? null}, status),
          notes = CASE
            WHEN ${input.note ?? null}::text IS NULL THEN notes
            ELSE notes || ${this.#sql.json(input.note ? [input.note] : [])}::jsonb
          END,
          updated_at = now()
      WHERE case_id = ${input.caseId}
      RETURNING case_id, account_id, status, summary, notes,
                created_at, updated_at
    `;
    if (!rows[0]) throw new Error("Support case not found");
    return this.#supportCaseFromRow(rows[0]);
  }

  async listSupportCases(input?: {
    readonly accountId?: string;
    readonly status?: SupportCase["status"];
  }): Promise<readonly SupportCase[]> {
    const rows = await this.#sql<SupportCaseRow[]>`
      SELECT case_id, account_id, status, summary, notes,
             created_at, updated_at
      FROM cardforge_support_cases
      WHERE (${input?.accountId ?? null}::text IS NULL
             OR account_id = ${input?.accountId ?? null})
        AND (${input?.status ?? null}::text IS NULL
             OR status = ${input?.status ?? null})
      ORDER BY updated_at DESC
    `;
    return rows.map((row) => this.#supportCaseFromRow(row));
  }

  async close(): Promise<void> {
    await this.#sql.end();
  }

  #metaFromRow(row: MatchMetaRow): MatchMeta {
    return {
      matchId: row.match_id,
      queue: row.queue,
      status: row.status,
      winnerId: row.winner_id,
      reason: row.outcome_reason,
      cycles: row.cycles,
      commandCount: row.command_count,
      createdAt: row.created_at.toISOString(),
      startedAt: row.started_at?.toISOString() ?? null,
      completedAt: row.completed_at?.toISOString() ?? null,
    };
  }

  #participantFromRow(row: ParticipantRow): MatchParticipantRecord {
    return {
      seat: row.seat,
      accountId: row.account_id,
      displayName: row.display_name,
      deckId: row.deck_id,
      deckName: row.deck_name,
      leaderId: row.leader_id,
      result: row.result,
      stats: row.stats,
    };
  }

  #inviteFromRow(row: InviteRow): InviteRecord {
    return {
      code: row.code,
      hostAccountId: row.host_account_id,
      guestAccountId: row.guest_account_id,
      status: row.status,
      matchId: row.match_id,
      createdAt: row.created_at.toISOString(),
      expiresAt: row.expires_at.toISOString(),
    };
  }

  #accountFromRow(row: AccountRow): AccountRecord {
    return {
      accountId: row.account_id,
      displayName: row.display_name,
      role: row.role,
      status: row.status,
      starterLeaderId: row.starter_leader_id,
      onboardingCompletedAt: row.onboarding_completed_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    };
  }

  #deckFromRow(row: DeckRow): DeckRecord {
    return {
      deckId: row.deck_id,
      accountId: row.account_id,
      gameId: row.game_id,
      formatId: row.format_id,
      leaderId: row.leader_id,
      name: row.name,
      revision: row.revision,
      cardIds: row.card_ids,
    };
  }

  #profileFromRow(row: ProfileRow): CompetitiveProfile {
    return {
      accountId: row.account_id,
      seasonId: row.season_id,
      rating: row.rating,
      wins: row.wins,
      losses: row.losses,
      accountXp: row.account_xp,
      accountLevel: row.account_level,
      aspectMastery: row.aspect_mastery,
      unlockedLeaderIds: row.unlocked_leader_ids,
    };
  }

  async #saveProfile(
    sql: Sql | TransactionSql,
    profile: CompetitiveProfile,
  ): Promise<void> {
    await sql`
      INSERT INTO cardforge_competitive_profiles (
        account_id, season_id, rating, wins, losses, account_xp,
        account_level, aspect_mastery, unlocked_leader_ids
      ) VALUES (
        ${profile.accountId}, ${profile.seasonId}, ${profile.rating},
        ${profile.wins}, ${profile.losses}, ${profile.accountXp},
        ${profile.accountLevel}, ${sql.json(profile.aspectMastery)},
        ${profile.unlockedLeaderIds as string[]}
      )
      ON CONFLICT (account_id, season_id) DO UPDATE SET
        rating = EXCLUDED.rating,
        wins = EXCLUDED.wins,
        losses = EXCLUDED.losses,
        account_xp = EXCLUDED.account_xp,
        account_level = EXCLUDED.account_level,
        aspect_mastery = EXCLUDED.aspect_mastery,
        unlocked_leader_ids = EXCLUDED.unlocked_leader_ids,
        updated_at = now()
    `;
  }

  async #saveTelemetry(
    sql: Sql | TransactionSql,
    telemetry: MatchTelemetry,
  ): Promise<void> {
    await sql`
      INSERT INTO cardforge_match_telemetry (
        match_id, queue, season_id, winner_id, victory_reason, cycles,
        command_count, telemetry
      ) VALUES (
        ${telemetry.matchId}, ${telemetry.queue}, ${telemetry.seasonId ?? null},
        ${telemetry.winnerId}, ${telemetry.victoryReason}, ${telemetry.cycles},
        ${telemetry.commandCount}, ${sql.json(telemetry as never)}
      )
      ON CONFLICT (match_id) DO UPDATE SET
        queue = EXCLUDED.queue,
        season_id = EXCLUDED.season_id,
        winner_id = EXCLUDED.winner_id,
        victory_reason = EXCLUDED.victory_reason,
        cycles = EXCLUDED.cycles,
        command_count = EXCLUDED.command_count,
        telemetry = EXCLUDED.telemetry
    `;
  }

  async #bootstrapEconomy(
    sql: Sql | TransactionSql,
    accountId: string,
  ): Promise<void> {
    await sql`
      INSERT INTO cardforge_wallets (account_id, currency_id, balance)
      VALUES
        (${accountId}, 'shards', ${economyBootstrap.shards}),
        (${accountId}, 'style_tokens', ${economyBootstrap.styleTokens})
      ON CONFLICT (account_id, currency_id) DO NOTHING
    `;
    await sql`
      INSERT INTO cardforge_entitlements (account_id, entitlement_id, category)
      VALUES
        (${accountId}, 'card-back.aether', 'card_back'),
        (${accountId}, 'board.aetherfront', 'board')
      ON CONFLICT (account_id, entitlement_id) DO NOTHING
    `;
    await sql`
      INSERT INTO cardforge_economy_transactions (
        transaction_id, account_id, kind
      ) VALUES (${`bootstrap:${accountId}`}, ${accountId}, 'bootstrap')
      ON CONFLICT (transaction_id) DO NOTHING
    `;
  }

  async #economySnapshot(
    sql: Sql | TransactionSql,
    accountId: string,
  ): Promise<EconomySnapshot> {
    const [wallets, cards, entitlements] = await Promise.all([
      sql<WalletRow[]>`
        SELECT currency_id, balance FROM cardforge_wallets
        WHERE account_id = ${accountId} ORDER BY currency_id
      `,
      sql<InventoryRow[]>`
        SELECT card_id, quantity FROM cardforge_inventory
        WHERE account_id = ${accountId} ORDER BY card_id
      `,
      sql<EntitlementRow[]>`
        SELECT entitlement_id, category FROM cardforge_entitlements
        WHERE account_id = ${accountId} ORDER BY entitlement_id
      `,
    ]);
    return {
      accountId,
      wallets: wallets.map((row) => ({
        currencyId: row.currency_id,
        balance: row.balance,
      })),
      cards: cards.map((row) => ({
        cardId: row.card_id,
        quantity: row.quantity,
      })),
      entitlements: entitlements.map((row) => ({
        entitlementId: row.entitlement_id,
        category: row.category,
      })),
    };
  }

  async #duplicateTransaction(
    sql: Sql | TransactionSql,
    transactionId: string,
    accountId: string,
    kind: EconomyTransaction["kind"],
  ): Promise<boolean> {
    if (!transactionId) throw new Error("Transaction id is required");
    const rows = await sql<EconomyTransactionRow[]>`
      SELECT transaction_id, account_id, kind, currency_id, currency_delta,
             item_id, item_delta
      FROM cardforge_economy_transactions
      WHERE transaction_id = ${transactionId}
    `;
    if (!rows.length) return false;
    if (rows[0]!.account_id !== accountId || rows[0]!.kind !== kind)
      throw new Error("Transaction id conflicts with an existing operation");
    return true;
  }

  async #recordEconomyTransaction(
    sql: Sql | TransactionSql,
    transaction: EconomyTransaction,
  ): Promise<void> {
    await sql`
      INSERT INTO cardforge_economy_transactions (
        transaction_id, account_id, kind, currency_id, currency_delta,
        item_id, item_delta, payload
      ) VALUES (
        ${transaction.transactionId}, ${transaction.accountId},
        ${transaction.kind}, ${transaction.currencyId ?? null},
        ${transaction.currencyDelta ?? null}, ${transaction.itemId ?? null},
        ${transaction.itemDelta ?? null}, ${sql.json(transaction as never)}
      )
    `;
  }

  #economyTransactionFromRow(row: EconomyTransactionRow): EconomyTransaction {
    return {
      transactionId: row.transaction_id,
      accountId: row.account_id,
      kind: row.kind,
      ...(row.currency_id ? { currencyId: row.currency_id } : {}),
      ...(row.currency_delta === null
        ? {}
        : { currencyDelta: row.currency_delta }),
      ...(row.item_id ? { itemId: row.item_id } : {}),
      ...(row.item_delta === null ? {} : { itemDelta: row.item_delta }),
    };
  }

  #auditFromRow(row: AuditRow): AuditRecord {
    return {
      auditId: row.audit_id,
      actorId: row.actor_id,
      action: row.action,
      targetId: row.target_id,
      payload: structuredClone(row.payload),
      createdAt: row.created_at.toISOString(),
    };
  }

  #supportCaseFromRow(row: SupportCaseRow): SupportCase {
    return {
      caseId: row.case_id,
      accountId: row.account_id,
      status: row.status,
      summary: row.summary,
      notes: [...row.notes],
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
