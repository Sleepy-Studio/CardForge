CREATE TABLE IF NOT EXISTS cardforge_wallets (
  account_id text NOT NULL REFERENCES cardforge_accounts(account_id) ON DELETE CASCADE,
  currency_id text NOT NULL CHECK (currency_id IN ('shards', 'style_tokens')),
  balance integer NOT NULL CHECK (balance >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, currency_id)
);

CREATE TABLE IF NOT EXISTS cardforge_inventory (
  account_id text NOT NULL REFERENCES cardforge_accounts(account_id) ON DELETE CASCADE,
  card_id text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, card_id)
);

CREATE TABLE IF NOT EXISTS cardforge_entitlements (
  account_id text NOT NULL REFERENCES cardforge_accounts(account_id) ON DELETE CASCADE,
  entitlement_id text NOT NULL,
  category text NOT NULL CHECK (
    category IN ('card_back', 'board', 'frame', 'leader_skin', 'vfx')
  ),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, entitlement_id)
);

CREATE TABLE IF NOT EXISTS cardforge_economy_transactions (
  transaction_id text PRIMARY KEY,
  account_id text NOT NULL REFERENCES cardforge_accounts(account_id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (
    kind IN ('bootstrap', 'craft', 'cosmetic_unlock', 'reward')
  ),
  currency_id text CHECK (currency_id IN ('shards', 'style_tokens')),
  currency_delta integer,
  item_id text,
  item_delta integer,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cardforge_economy_account_created_idx
  ON cardforge_economy_transactions (account_id, created_at DESC);
