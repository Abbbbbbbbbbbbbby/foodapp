-- Family-ID aliases for merges. Offline clients cache family ids (the
-- directory) and replay visits against them. A merge deletes the discarded
-- row and previously redirected only idempotency KEYS, so such a replay hit
-- a missing FK, 500'd, and retried forever. Keyed by the discarded id.
CREATE TABLE IF NOT EXISTS merged_family_ids (
  old_id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
