CREATE TABLE IF NOT EXISTS inventory_balances (
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, item_id)
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  balance_after INTEGER,
  reason TEXT NOT NULL,
  reference_id TEXT,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending', 'committed', 'rejected')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  committed_at INTEGER,
  UNIQUE(player_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS inventory_transactions_player_time
  ON inventory_transactions(player_id, created_at DESC);

CREATE INDEX IF NOT EXISTS inventory_transactions_item_time
  ON inventory_transactions(item_id, created_at DESC);

CREATE TABLE IF NOT EXISTS account_audit_log (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  actor_player_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS account_audit_player_time
  ON account_audit_log(player_id, created_at DESC);
