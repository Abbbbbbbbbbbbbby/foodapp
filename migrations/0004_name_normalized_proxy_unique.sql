-- Accent-folded name column for reliable Unicode search (see db.ts normalizeName).
-- Populated on insert and update going forward. NULL for pre-migration rows.
ALTER TABLE families ADD COLUMN name_normalized TEXT;

-- Prevent duplicate proxy rows when an idempotent family replay re-runs the
-- proxy INSERT. Partial index excludes NULL proxy_phone because SQL NULL != NULL
-- so a UNIQUE index would not de-dup null-phone proxies anyway.
CREATE UNIQUE INDEX proxies_family_proxy_phone
  ON proxies (family_id, proxy_phone)
  WHERE proxy_phone IS NOT NULL;
