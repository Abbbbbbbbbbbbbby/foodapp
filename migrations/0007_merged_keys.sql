-- Idempotency aliases for merged records. When a duplicate family is merged
-- away, its idempotency keys (family and any same-date visit keys that could
-- not be adopted onto the surviving visit) are recorded here so an offline
-- device replaying the original submission resolves to the SURVIVING record
-- instead of re-creating the duplicate the merge just eliminated.
CREATE TABLE IF NOT EXISTS merged_keys (
  idempotency_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('family', 'visit')),
  target_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
