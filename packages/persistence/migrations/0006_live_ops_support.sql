CREATE TABLE IF NOT EXISTS cardforge_live_ops_definitions (
  config_id text NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  state text NOT NULL CHECK (state IN ('draft', 'staged', 'published', 'deprecated')),
  definition jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (config_id, revision)
);

CREATE INDEX IF NOT EXISTS cardforge_live_ops_state_created_idx
  ON cardforge_live_ops_definitions (state, created_at DESC);

CREATE TABLE IF NOT EXISTS cardforge_support_cases (
  case_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES cardforge_accounts(account_id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('open', 'resolved')),
  summary text NOT NULL,
  notes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cardforge_support_status_updated_idx
  ON cardforge_support_cases (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS cardforge_audit_log (
  audit_id text PRIMARY KEY,
  actor_id text NOT NULL,
  action text NOT NULL,
  target_id text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cardforge_audit_created_idx
  ON cardforge_audit_log (created_at DESC);
