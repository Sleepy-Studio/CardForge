import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres, { type Sql, type TransactionSql } from "postgres";
import {
  createCompetitiveProfile,
  settleRankedMatch,
  type CompetitiveProfile,
  type MatchTelemetry,
  type RankedSettlement,
} from "@cardforge/competitive";
import type {
  CardForgeStore,
  DeckRecord,
  RankedCompletion,
  StoredMatchRecord,
} from "./types.js";

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

export class PostgresCardForgeStore implements CardForgeStore {
  readonly #sql: Sql;

  constructor(databaseUrl: string) {
    this.#sql = postgres(databaseUrl, { max: 10 });
  }

  async migrate(): Promise<void> {
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
    ]) {
      const applied = await this.#sql<{ migration_id: string }[]>`
        SELECT migration_id FROM cardforge_schema_migrations
        WHERE migration_id = ${migrationId}
      `;
      if (applied.length) continue;
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
    }
  }

  async upsertAccount(accountId: string, displayName: string): Promise<void> {
    await this.#sql`
      INSERT INTO cardforge_accounts (account_id, display_name)
      VALUES (${accountId}, ${displayName})
      ON CONFLICT (account_id) DO UPDATE SET display_name = EXCLUDED.display_name
    `;
  }

  async saveDeck(deck: DeckRecord): Promise<void> {
    await this.#sql.begin(async (sql) => {
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
    });
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
        status = EXCLUDED.status,
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

  async close(): Promise<void> {
    await this.#sql.end();
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
}
