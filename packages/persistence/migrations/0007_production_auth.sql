-- M7 production authentication. Additive: existing account IDs and every
-- account-scoped row are preserved. Legacy alpha accounts have no credential
-- until an operator issues a claim code (see docs/auth.md).

ALTER TABLE cardforge_accounts
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'player'
    CHECK (role IN ('player', 'admin')),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended')),
  ADD COLUMN IF NOT EXISTS starter_leader_id text,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

CREATE TABLE IF NOT EXISTS cardforge_password_credentials (
  account_id text PRIMARY KEY REFERENCES cardforge_accounts(account_id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cardforge_oauth_identities (
  provider text NOT NULL CHECK (provider IN ('discord')),
  subject text NOT NULL,
  account_id text NOT NULL REFERENCES cardforge_accounts(account_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (provider, subject)
);

CREATE INDEX IF NOT EXISTS cardforge_oauth_account_idx
  ON cardforge_oauth_identities (account_id);

-- Only the SHA-256 digest of a session token is stored.
CREATE TABLE IF NOT EXISTS cardforge_sessions (
  token_hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES cardforge_accounts(account_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS cardforge_sessions_account_idx
  ON cardforge_sessions (account_id);
CREATE INDEX IF NOT EXISTS cardforge_sessions_expiry_idx
  ON cardforge_sessions (expires_at);

CREATE TABLE IF NOT EXISTS cardforge_account_claims (
  code_hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES cardforge_accounts(account_id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz
);
