-- Client-side telemetry (JS errors, wizard breadcrumbs, draft resume/discard)
-- and offline-safe delivery events, POSTed from the PWA to /api/client-events.
-- The check-in wizard is a pure client state machine with no network traffic
-- between lookup and submit, and a volunteer losing an in-progress entry (crash,
-- reload, tab discard) previously left no record anywhere. This table is
-- the read contract for the admin console (issue #13) — schema changes here
-- must update the README data section in the same commit.
--
-- id is a client-minted UUID and doubles as the idempotency key: inserts
-- use INSERT OR IGNORE so a retried flush or a replayed offline-queued
-- batch never fails on a primary-key collision.
CREATE TABLE IF NOT EXISTS client_events (
  id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  occurred_at TEXT,
  user_id TEXT,
  session_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  seq INTEGER,
  level TEXT NOT NULL,
  kind TEXT NOT NULL,
  route TEXT,
  wizard_step INTEGER,
  view_type TEXT,
  message TEXT,
  stack TEXT,
  user_agent TEXT,
  online INTEGER,
  app_version TEXT,
  extra TEXT
);

CREATE INDEX client_events_received_at ON client_events (received_at);
CREATE INDEX client_events_session ON client_events (session_id, occurred_at);
CREATE INDEX client_events_user ON client_events (user_id, received_at);
