import { env } from 'cloudflare:workers';
import { beforeAll } from 'vitest';
import type { Env } from '../../src/worker/schema';

// @ts-expect-error - Vite ?raw import
import schema1 from '../../migrations/0001_initial.sql?raw';
// @ts-expect-error - Vite ?raw import
import schema2 from '../../migrations/0002_question_settings.sql?raw';
// @ts-expect-error - Vite ?raw import
import schema3 from '../../migrations/0003_idempotency.sql?raw';
// @ts-expect-error - Vite ?raw import
import schema4 from '../../migrations/0004_name_normalized_proxy_unique.sql?raw';
// @ts-expect-error - Vite ?raw import
import schema5 from '../../migrations/0005_records_audit.sql?raw';
// @ts-expect-error - Vite ?raw import
import schema6 from '../../migrations/0006_duplicate_flags.sql?raw';
// @ts-expect-error - Vite ?raw import
import schema7 from '../../migrations/0007_merged_keys.sql?raw';
// @ts-expect-error - Vite ?raw import
import schema8 from '../../migrations/0008_bubble_id.sql?raw';
// @ts-expect-error - Vite ?raw import
import schema9 from '../../migrations/0009_merged_family_ids.sql?raw';
// @ts-expect-error - Vite ?raw import
import schema10 from '../../migrations/0010_client_events.sql?raw';

function applySchema(sql: string): string[] {
  return (sql as string)
    .split(';')
    .map(s => s.replace(/--[^\n]*/g, '').trim())
    .filter(s => s.length > 0);
}

beforeAll(async () => {
  const db = (env as unknown as Env).DB;
  for (const stmt of [...applySchema(schema1), ...applySchema(schema2), ...applySchema(schema3), ...applySchema(schema4), ...applySchema(schema5), ...applySchema(schema6), ...applySchema(schema7), ...applySchema(schema8), ...applySchema(schema9), ...applySchema(schema10)]) {
    await db.prepare(stmt).run();
  }
});
