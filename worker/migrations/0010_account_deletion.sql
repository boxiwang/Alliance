-- Account deletion (Game Settings): a request freezes the account for a 7-day grace period;
-- signing in again cancels it, otherwise the WorldRoom purges the account's data.
ALTER TABLE players ADD COLUMN deletion_requested_at INTEGER;
