-- Track who last edited each family or visit record
ALTER TABLE families ADD COLUMN updated_by TEXT REFERENCES users(id);
ALTER TABLE visits ADD COLUMN updated_by TEXT REFERENCES users(id);
ALTER TABLE visits ADD COLUMN updated_at TEXT;

-- Per-visit bag tracking (family-level bag_received is kept for the distribution
-- session workflow - this column records whether a bag was given on each visit)
ALTER TABLE visits ADD COLUMN bag_received INTEGER NOT NULL DEFAULT 0;

-- Full audit log: every edit or deletion by staff/admin is recorded here
CREATE TABLE record_changes (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  changed_by TEXT NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (datetime('now')),
  changes TEXT NOT NULL
);
CREATE INDEX record_changes_record ON record_changes (table_name, record_id);
CREATE INDEX record_changes_by ON record_changes (changed_by);
