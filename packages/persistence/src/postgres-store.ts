import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";
import type { CardForgeStore, DeckRecord, StoredMatchRecord } from "./types.js";

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
}
