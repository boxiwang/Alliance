ALTER TABLE player_state ADD COLUMN economy_authority_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE player_state ADD COLUMN economy_migrated_at INTEGER;

CREATE TABLE game_commands (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  command_type TEXT NOT NULL,
  args_hash TEXT NOT NULL,
  args_json TEXT NOT NULL,
  ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  reason TEXT,
  base_revision INTEGER NOT NULL,
  result_revision INTEGER NOT NULL,
  result_game_json TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (player_id, idempotency_key)
);

CREATE INDEX game_commands_player_time
  ON game_commands(player_id, created_at DESC);

CREATE UNIQUE INDEX game_commands_player_revision
  ON game_commands(player_id, result_revision) WHERE ok = 1;
