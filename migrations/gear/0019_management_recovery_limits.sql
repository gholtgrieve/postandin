-- Preserve per-seller recovery delivery accounting for one anchored 24-hour window.
-- Existing rows begin with an expired window and reset on their next eligible issue.
ALTER TABLE gear_management_links ADD COLUMN issue_count INTEGER NOT NULL DEFAULT 1
  CHECK(issue_count>=1);
ALTER TABLE gear_management_links ADD COLUMN window_started_at INTEGER NOT NULL DEFAULT 0
  CHECK(window_started_at>=0);
