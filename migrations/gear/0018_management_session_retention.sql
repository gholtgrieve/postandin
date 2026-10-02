-- A management link signs the seller in for the listing's normal 30-day life.
-- Browsing away does not end the session; explicit sign out still revokes it.
DROP TRIGGER gear_management_redeem;
CREATE TRIGGER gear_management_redeem AFTER UPDATE OF consumed_at ON gear_management_links
WHEN OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL
BEGIN
  UPDATE gear_management_sessions SET revoked_at=NEW.consumed_at
    WHERE seller_id=NEW.seller_id AND revoked_at IS NULL;
  INSERT INTO gear_management_sessions(session_hash,seller_id,csrf_hash,created_at,expires_at)
    VALUES(NEW.session_hash,NEW.seller_id,NEW.csrf_hash,NEW.consumed_at,NEW.consumed_at+2592000000);
END;
