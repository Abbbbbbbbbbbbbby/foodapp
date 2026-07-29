-- Stores potential duplicate family pairs for admin review.
-- family_a_id is always the lexicographically smaller of the two IDs
-- so (A,B) and (B,A) can never both exist.
CREATE TABLE IF NOT EXISTS duplicate_flags (
  id          TEXT PRIMARY KEY,
  family_a_id TEXT NOT NULL REFERENCES families(id),
  family_b_id TEXT NOT NULL REFERENCES families(id),
  reason      TEXT NOT NULL,                           -- 'phone' | 'name_exact' | 'name_fuzzy'
  status      TEXT NOT NULL DEFAULT 'pending',         -- 'pending' | 'merged' | 'dismissed'
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(family_a_id, family_b_id)
);
