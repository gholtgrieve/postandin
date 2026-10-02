-- Bound production verification delivery per draft. Existing token rows count as
-- one issuance; local simulation does not increment this production counter.
ALTER TABLE gear_verification_tokens ADD COLUMN issue_count INTEGER NOT NULL DEFAULT 1
  CHECK(issue_count BETWEEN 1 AND 5);
