-- Stable source id for Bubble-imported families: re-running the same import
-- becomes a no-op for every row, phone or no phone (issue #6 item 3).
ALTER TABLE families ADD COLUMN bubble_id TEXT;
CREATE UNIQUE INDEX families_bubble_id ON families (bubble_id)
  WHERE bubble_id IS NOT NULL;
