-- Idempotency keys for offline replay: client sends a stable UUID per submission;
-- the server rejects duplicates and returns the existing record instead of
-- creating a duplicate family or double-counting a visit.
-- UNIQUE is enforced via a partial index (NULL values are not constrained).
ALTER TABLE families ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX families_idempotency_key ON families (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE visits ADD COLUMN idempotency_key TEXT;
CREATE UNIQUE INDEX visits_idempotency_key ON visits (idempotency_key)
  WHERE idempotency_key IS NOT NULL;
