CREATE TABLE IF NOT EXISTS cardforge_training_completions (
  account_id text NOT NULL REFERENCES cardforge_accounts(account_id) ON DELETE CASCADE,
  scenario_id text NOT NULL,
  completion_id text NOT NULL UNIQUE,
  reward jsonb NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, scenario_id)
);

CREATE INDEX IF NOT EXISTS cardforge_training_account_completed_idx
  ON cardforge_training_completions (account_id, completed_at DESC);
