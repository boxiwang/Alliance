CREATE TABLE IF NOT EXISTS credit_accounts (
  player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL DEFAULT 0 CHECK(balance >= 0),
  purchased_total INTEGER NOT NULL DEFAULT 0 CHECK(purchased_total >= 0),
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL CHECK(balance_after >= 0),
  reason TEXT NOT NULL,
  reference_id TEXT,
  idempotency_key TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  UNIQUE(player_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS credit_ledger_player_time
  ON credit_ledger(player_id, created_at DESC);

CREATE TABLE IF NOT EXISTS shop_purchases (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  offer_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK(quantity > 0),
  credits_spent INTEGER NOT NULL CHECK(credits_spent >= 0),
  balance_after INTEGER NOT NULL CHECK(balance_after >= 0),
  idempotency_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(player_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS shop_daily_claims (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  claim_day TEXT NOT NULL,
  claimed_at INTEGER NOT NULL,
  PRIMARY KEY(player_id, claim_day)
);

CREATE TABLE IF NOT EXISTS topup_orders (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  payer_wallet TEXT NOT NULL,
  pack_id TEXT NOT NULL,
  credits INTEGER NOT NULL CHECK(credits > 0),
  usd_cents INTEGER NOT NULL CHECK(usd_cents > 0),
  rail_id TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  token_address TEXT NOT NULL,
  token_symbol TEXT NOT NULL,
  token_decimals INTEGER NOT NULL,
  treasury_address TEXT NOT NULL,
  expected_amount_raw TEXT NOT NULL,
  confirmations_required INTEGER NOT NULL DEFAULT 2,
  tx_hash TEXT,
  log_index INTEGER,
  status TEXT NOT NULL CHECK(status IN ('created', 'submitted', 'credited', 'expired', 'rejected')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  credited_at INTEGER
);

CREATE INDEX IF NOT EXISTS topup_orders_player_time
  ON topup_orders(player_id, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS topup_orders_receipt
  ON topup_orders(chain_id, tx_hash, log_index) WHERE tx_hash IS NOT NULL AND log_index IS NOT NULL;
