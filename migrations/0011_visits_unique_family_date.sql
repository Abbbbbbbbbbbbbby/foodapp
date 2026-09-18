-- Enforce one visit per family per day at the database level.
-- The route already blocks duplicates (409), but this index makes the
-- constraint durable against any future direct writes.
--
-- BEFORE APPLYING TO PRODUCTION: verify no existing duplicates with:
--   SELECT family_id, visit_date, COUNT(*) n
--   FROM visits GROUP BY family_id, visit_date HAVING n > 1;
-- Resolve any found rows, then apply with: wrangler d1 migrations apply foodapp --remote
CREATE UNIQUE INDEX IF NOT EXISTS idx_visits_family_date ON visits(family_id, visit_date);
