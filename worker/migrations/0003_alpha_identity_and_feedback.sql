ALTER TABLE players ADD COLUMN name_key TEXT;
ALTER TABLE players ADD COLUMN last_renamed_at INTEGER;

UPDATE players
SET display_name = CASE
  WHEN display_name = 'Commander' THEN 'Ruglord' || substr(replace(id, '0x', ''), -7)
  ELSE display_name
END;

UPDATE players
SET display_name = substr(display_name, 1, 17) || '-' || substr(replace(id, '0x', ''), -6)
WHERE EXISTS (
  SELECT 1 FROM players duplicate
  WHERE lower(duplicate.display_name) = lower(players.display_name)
    AND duplicate.id <> players.id
);

UPDATE players
SET name_key = lower(display_name) || CASE
  WHEN EXISTS (
    SELECT 1 FROM players duplicate
    WHERE lower(duplicate.display_name) = lower(players.display_name)
      AND duplicate.id <> players.id
  ) THEN '-' || substr(replace(id, '0x', ''), -6)
  ELSE ''
END;

CREATE UNIQUE INDEX IF NOT EXISTS players_name_key_unique
  ON players(name_key) WHERE name_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS alpha_feedback (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  page TEXT,
  message TEXT NOT NULL,
  client_context_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS alpha_feedback_status_time
  ON alpha_feedback(status, created_at DESC);

CREATE INDEX IF NOT EXISTS alpha_feedback_player_time
  ON alpha_feedback(player_id, created_at DESC);
