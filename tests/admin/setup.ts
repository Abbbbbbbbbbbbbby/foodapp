// Applies the one migration the admin console reads: client_events. Same
// naive split-on-semicolon loader as tests/worker/setup.ts — the migration
// deliberately contains no semicolons inside comments or strings.
import { env } from 'cloudflare:workers';
import migration0010 from '../../migrations/0010_client_events.sql?raw';

const db = (env as unknown as { DB: D1Database }).DB;
for (const stmt of migration0010.split(';')) {
  const sql = stmt.trim();
  if (sql) await db.prepare(sql).run();
}
