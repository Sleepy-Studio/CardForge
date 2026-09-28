-- M7 player journey: match history, per-match rewards, friend invites,
-- quest claims, and first-session product analytics. Additive only.

ALTER TABLE cardforge_match_records
  ADD COLUMN IF NOT EXISTS queue text
    CHECK (queue IN ('casual', 'ranked', 'friend', 'practice', 'pve')),
  ADD COLUMN IF NOT EXISTS winner_id text CHECK (winner_id IN ('p1', 'p2')),
  ADD COLUMN IF NOT EXISTS outcome_reason text
    CHECK (outcome_reason IN ('integrity', 'dominion', 'concession', 'abandonment')),
  ADD COLUMN IF NOT EXISTS cycles integer CHECK (cycles >= 0),
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS cardforge_matches_completed_idx
  ON cardforge_match_records (completed_at DESC)
  WHERE completed_at IS NOT NULL;

-- Opponent display names are snapshotted so history stays readable if a
-- player later renames; authoritative identity remains account_id.
CREATE TABLE IF NOT EXISTS cardforge_match_participants (
  match_id text NOT NULL REFERENCES cardforge_match_records(match_id) ON DELETE CASCADE,
  seat text NOT NULL CHECK (seat IN ('p1', 'p2')),
  account_id text REFERENCES cardforge_accounts(account_id) ON DELETE SET NULL,
  display_name text NOT NULL,
  deck_id text,
  deck_name text,
  leader_id text NOT NULL,
  result text CHECK (result IN ('win', 'loss')),
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (match_id, seat)
);

CREATE INDEX IF NOT EXISTS cardforge_participants_account_idx
  ON cardforge_match_participants (account_id, match_id);

-- One reward receipt per (match, account): the uniqueness constraint is the
-- exactly-once guarantee for match rewards.
CREATE TABLE IF NOT EXISTS cardforge_match_rewards (
  match_id text NOT NULL,
  account_id text NOT NULL REFERENCES cardforge_accounts(account_id) ON DELETE CASCADE,
  queue text NOT NULL,
  reward jsonb NOT NULL,
  settled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, account_id)
);

CREATE TABLE IF NOT EXISTS cardforge_match_invites (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z2-9]{6}$'),
  host_account_id text NOT NULL REFERENCES cardforge_accounts(account_id) ON DELETE CASCADE,
  guest_account_id text REFERENCES cardforge_accounts(account_id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('open', 'claimed', 'started', 'cancelled')),
  match_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS cardforge_invites_host_idx
  ON cardforge_match_invites (host_account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cardforge_quest_claims (
  account_id text NOT NULL REFERENCES cardforge_accounts(account_id) ON DELETE CASCADE,
  quest_id text NOT NULL,
  period_key text NOT NULL,
  reward jsonb NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, quest_id, period_key)
);

CREATE TABLE IF NOT EXISTS cardforge_product_events (
  event_id text PRIMARY KEY,
  account_id text REFERENCES cardforge_accounts(account_id) ON DELETE SET NULL,
  name text NOT NULL,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cardforge_product_events_name_idx
  ON cardforge_product_events (name, created_at DESC);

ALTER TABLE cardforge_match_telemetry
  DROP CONSTRAINT IF EXISTS cardforge_match_telemetry_victory_reason_check;
ALTER TABLE cardforge_match_telemetry
  ADD CONSTRAINT cardforge_match_telemetry_victory_reason_check
  CHECK (victory_reason IN ('integrity', 'dominion', 'concession', 'abandonment'));
ALTER TABLE cardforge_match_telemetry
  DROP CONSTRAINT IF EXISTS cardforge_match_telemetry_queue_check;
ALTER TABLE cardforge_match_telemetry
  ADD CONSTRAINT cardforge_match_telemetry_queue_check
  CHECK (queue IN ('casual', 'ranked', 'friend', 'practice', 'pve'));

ALTER TABLE cardforge_economy_transactions
  DROP CONSTRAINT IF EXISTS cardforge_economy_transactions_kind_check;
ALTER TABLE cardforge_economy_transactions
  ADD CONSTRAINT cardforge_economy_transactions_kind_check
  CHECK (kind IN ('bootstrap', 'craft', 'cosmetic_unlock', 'reward', 'starter_grant'));
