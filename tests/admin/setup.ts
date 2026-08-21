// Applies every migration the admin console reads from: client_events plus
// the base schema (users, for the volunteer-identity LEFT JOIN added in
// issue #17). Same naive split-on-semicolon loader as tests/worker/setup.ts —
// migrations deliberately contain no semicolons inside comments or strings.
import { env } from 'cloudflare:workers';
import migration0001 from '../../migrations/0001_initial.sql?raw';
import migration0010 from '../../migrations/0010_client_events.sql?raw';

const db = (env as unknown as { DB: D1Database }).DB;
for (const migration of [migration0001, migration0010]) {
  for (const stmt of migration.split(';')) {
    const sql = stmt.trim();
    if (sql) await db.prepare(sql).run();
  }
}
