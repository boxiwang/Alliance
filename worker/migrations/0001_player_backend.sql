CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  auth_method TEXT NOT NULL,
  wallet_address TEXT,
  display_name TEXT NOT NULL DEFAULT 'Commander',
  role TEXT NOT NULL DEFAULT 'player',
  status TEXT NOT NULL DEFAULT 'active',
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  last_login_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS players_wallet_address
  ON players(wallet_address) WHERE wallet_address IS NOT NULL;

CREATE TABLE IF NOT EXISTS player_identities (
  provider TEXT NOT NULL,
  provider_subject TEXT NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  secret_hash TEXT,
  created_at INTEGER NOT NULL,
  last_verified_at INTEGER NOT NULL,
  PRIMARY KEY (provider, provider_subject)
);

CREATE INDEX IF NOT EXISTS player_identities_player
  ON player_identities(player_id);

CREATE TABLE IF NOT EXISTS auth_challenges (
  nonce TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  message TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX IF NOT EXISTS auth_challenges_address
  ON auth_challenges(address, expires_at);

CREATE TABLE IF NOT EXISTS player_state (
  player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL DEFAULT 0,
  profile_json TEXT,
  game_json TEXT,
  world_json TEXT,
  account_json TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS player_events (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  event_name TEXT NOT NULL,
  event_version INTEGER NOT NULL DEFAULT 1,
  page TEXT,
  client_ts INTEGER,
  server_ts INTEGER NOT NULL,
  properties_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS player_events_player_time
  ON player_events(player_id, server_ts DESC);

CREATE INDEX IF NOT EXISTS player_events_name_time
  ON player_events(event_name, server_ts DESC);

