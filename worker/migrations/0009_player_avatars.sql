-- Uploaded commander portraits (docs: Profile / Dossier). One square image per player,
-- re-encoded client-side to <= 64 KB; served publicly at /avatar/<playerId>?v=<version>.
CREATE TABLE IF NOT EXISTS player_avatars (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  content_type TEXT NOT NULL,
  data BLOB NOT NULL,
  version INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
