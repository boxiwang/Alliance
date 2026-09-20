ALTER TABLE game_commands ADD COLUMN inventory_item_id TEXT;
ALTER TABLE game_commands ADD COLUMN inventory_quantity INTEGER;
ALTER TABLE game_commands ADD COLUMN inventory_transaction_id TEXT;

DROP TRIGGER game_commands_apply_state;

CREATE TRIGGER game_commands_apply_state
AFTER INSERT ON game_commands
WHEN NEW.ok = 1
BEGIN
  UPDATE inventory_balances
  SET quantity = quantity - NEW.inventory_quantity,
      updated_at = NEW.created_at
  WHERE NEW.inventory_item_id IS NOT NULL
    AND player_id = NEW.player_id
    AND item_id = NEW.inventory_item_id
    AND quantity >= NEW.inventory_quantity;

  SELECT CASE
    WHEN NEW.inventory_item_id IS NOT NULL AND changes() != 1
    THEN RAISE(ABORT, 'insufficient_inventory')
  END;

  UPDATE player_state
  SET game_json = NEW.result_game_json,
      revision = NEW.result_revision,
      updated_at = NEW.created_at
  WHERE player_id = NEW.player_id
    AND revision = NEW.base_revision
    AND economy_authority_version > 0;

  SELECT CASE WHEN changes() != 1 THEN RAISE(ABORT, 'revision_conflict') END;

  INSERT INTO inventory_transactions
    (id, player_id, item_id, delta, balance_after, reason, reference_id, idempotency_key, status, metadata_json, created_at, committed_at)
  SELECT NEW.inventory_transaction_id, NEW.player_id, NEW.inventory_item_id, -NEW.inventory_quantity,
    (SELECT quantity FROM inventory_balances WHERE player_id = NEW.player_id AND item_id = NEW.inventory_item_id),
    'item_used', NEW.id, 'command:' || NEW.idempotency_key, 'committed', '{}', NEW.created_at, NEW.created_at
  WHERE NEW.inventory_item_id IS NOT NULL;

  UPDATE game_commands SET result_game_json = NULL WHERE id = NEW.id;
END;
