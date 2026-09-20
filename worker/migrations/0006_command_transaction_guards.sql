-- D1 batch() is transactional. These short-lived rows turn a failed optimistic
-- condition into a CHECK error, causing the entire command batch to roll back.
CREATE TABLE command_transaction_guards (
  id TEXT PRIMARY KEY,
  ok INTEGER NOT NULL CHECK (ok = 1)
);

DROP TRIGGER IF EXISTS game_commands_apply_state;
