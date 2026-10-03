-- Local email transfer: never rename a shared seller mailbox in place.
CREATE TABLE gear_email_changes (
 seller_id TEXT PRIMARY KEY REFERENCES gear_sellers(id),
 source_email TEXT NOT NULL,
 target_email TEXT NOT NULL,
 target_id TEXT NOT NULL,
 session_hash TEXT NOT NULL REFERENCES gear_management_sessions(session_hash),
 token_hash TEXT NOT NULL UNIQUE,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
 consumed_at INTEGER
);
CREATE TRIGGER gear_email_change_guard BEFORE UPDATE OF consumed_at ON gear_email_changes
WHEN NEW.consumed_at IS NOT NULL
BEGIN
 SELECT CASE WHEN OLD.consumed_at IS NOT NULL
  OR NEW.consumed_at<OLD.created_at OR NEW.consumed_at>=OLD.expires_at
  OR NOT EXISTS(SELECT 1 FROM gear_management_sessions m JOIN gear_sellers s ON s.id=m.seller_id
   WHERE m.session_hash=OLD.session_hash AND m.seller_id=OLD.seller_id
    AND m.revoked_at IS NULL AND m.created_at<=NEW.consumed_at AND m.expires_at>NEW.consumed_at
    AND s.email=OLD.source_email AND s.verified_at IS NOT NULL AND s.email!=OLD.target_email)
  THEN RAISE(ABORT,'Invalid email change') END;
 SELECT CASE WHEN (SELECT count(*) FROM gear_listings
  WHERE (seller_id=OLD.seller_id OR seller_id=(SELECT id FROM gear_sellers WHERE email=OLD.target_email))
   AND status IN ('available','pending') AND expires_at>NEW.consumed_at)>10
  THEN RAISE(ABORT,'Email change listing limit') END;
END;
CREATE TRIGGER gear_email_change_apply AFTER UPDATE OF consumed_at ON gear_email_changes
WHEN OLD.consumed_at IS NULL AND NEW.consumed_at IS NOT NULL
BEGIN
 INSERT INTO gear_sellers(id,email,verified_at,created_at)
  VALUES(NEW.target_id,NEW.target_email,NEW.consumed_at,NEW.consumed_at)
  ON CONFLICT(email) DO UPDATE SET verified_at=coalesce(verified_at,excluded.verified_at);
 UPDATE gear_listings SET status='expired'
  WHERE seller_id IN (NEW.seller_id,(SELECT id FROM gear_sellers WHERE email=NEW.target_email))
   AND status IN ('available','pending') AND expires_at<=NEW.consumed_at;
 -- The unique active-key index rejects any merge with live duplicate gear.
 -- Errors roll back consumption, destination creation and all following writes.
 UPDATE gear_listings SET seller_id=(SELECT id FROM gear_sellers WHERE email=NEW.target_email)
  WHERE seller_id=NEW.seller_id AND verified_at IS NOT NULL AND status!='unverified';
 UPDATE gear_management_sessions SET revoked_at=NEW.consumed_at
  WHERE seller_id IN (NEW.seller_id,(SELECT id FROM gear_sellers WHERE email=NEW.target_email))
   AND revoked_at IS NULL;
 DELETE FROM gear_management_links
  WHERE seller_id IN (NEW.seller_id,(SELECT id FROM gear_sellers WHERE email=NEW.target_email));
END;
