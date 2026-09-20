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

-- A successful command and its player-state mutation must commit together.
-- If the revision moved, abort the INSERT as well; the caller then re-pulls.
CREATE TRIGGER game_commands_apply_state
AFTER INSERT ON game_commands
WHEN NEW.ok = 1
BEGIN
  UPDATE player_state
  SET game_json = NEW.result_game_json,
      revision = NEW.result_revision,
      updated_at = NEW.created_at
  WHERE player_id = NEW.player_id
    AND revision = NEW.base_revision
    AND economy_authority_version > 0;

  SELECT CASE WHEN changes() != 1 THEN RAISE(ABORT, 'revision_conflict') END;

  -- The command ledger keeps the proof and revisions, not a copy of every save.
  UPDATE game_commands SET result_game_json = NULL WHERE id = NEW.id;
END;
