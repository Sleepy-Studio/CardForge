CREATE TABLE IF NOT EXISTS cardforge_accounts (
  account_id text PRIMARY KEY,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cardforge_decks (
  deck_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES cardforge_accounts(account_id) ON DELETE CASCADE,
  game_id text NOT NULL,
  format_id text NOT NULL,
  leader_id text NOT NULL,
  name text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cardforge_decks_account_idx
  ON cardforge_decks (account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS cardforge_deck_cards (
  deck_id text NOT NULL REFERENCES cardforge_decks(deck_id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  card_id text NOT NULL,
  PRIMARY KEY (deck_id, position)
);

CREATE TABLE IF NOT EXISTS cardforge_match_records (
  match_id text PRIMARY KEY,
  status text NOT NULL CHECK (status IN ('active', 'complete', 'abandoned')),
  ruleset_revision text NOT NULL,
  format_id text NOT NULL,
  format_revision integer NOT NULL,
  content_hash text NOT NULL,
  command_count integer NOT NULL CHECK (command_count >= 0),
  final_state_hash text NOT NULL,
  replay jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cardforge_matches_status_updated_idx
  ON cardforge_match_records (status, updated_at DESC);
