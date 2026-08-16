CREATE TABLE IF NOT EXISTS cardforge_competitive_profiles (
  account_id text NOT NULL REFERENCES cardforge_accounts(account_id) ON DELETE CASCADE,
  season_id text NOT NULL,
  rating integer NOT NULL CHECK (rating >= 0),
  wins integer NOT NULL CHECK (wins >= 0),
  losses integer NOT NULL CHECK (losses >= 0),
  account_xp integer NOT NULL CHECK (account_xp >= 0),
  account_level integer NOT NULL CHECK (account_level > 0),
  aspect_mastery jsonb NOT NULL,
  unlocked_leader_ids text[] NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, season_id)
);

CREATE INDEX IF NOT EXISTS cardforge_profiles_season_rating_idx
  ON cardforge_competitive_profiles (season_id, rating DESC, wins DESC);

CREATE TABLE IF NOT EXISTS cardforge_match_telemetry (
  match_id text PRIMARY KEY,
  queue text NOT NULL CHECK (queue IN ('casual', 'ranked', 'practice', 'pve')),
  season_id text,
  winner_id text NOT NULL CHECK (winner_id IN ('p1', 'p2')),
  victory_reason text NOT NULL CHECK (victory_reason IN ('integrity', 'dominion')),
  cycles integer NOT NULL CHECK (cycles > 0),
  command_count integer NOT NULL CHECK (command_count >= 0),
  telemetry jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cardforge_telemetry_season_created_idx
  ON cardforge_match_telemetry (season_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cardforge_ranked_settlements (
  match_id text PRIMARY KEY,
  season_id text NOT NULL,
  winner_account_id text NOT NULL REFERENCES cardforge_accounts(account_id),
  settlement jsonb NOT NULL,
  settled_at timestamptz NOT NULL DEFAULT now()
);
