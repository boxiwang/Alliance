INSERT INTO credit_accounts (player_id, balance, purchased_total, updated_at)
SELECT id, 0, 0, CAST(strftime('%s','now') AS INTEGER) * 1000
FROM players
WHERE NOT EXISTS (SELECT 1 FROM credit_accounts WHERE credit_accounts.player_id = players.id);
