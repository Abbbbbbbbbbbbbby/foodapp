import { env } from 'cloudflare:test';
import { beforeAll } from 'vitest';
import type { Env } from '../../src/worker/schema';

// Vite ?raw import inlines the file content as a string at bundle time
// @ts-expect-error - no TS declarations for ?raw imports
import schema from '../../migrations/0001_initial.sql?raw';

beforeAll(async () => {
  const db = (env as unknown as Env).DB;
  // D1 exec() in miniflare doesn't handle multi-statement SQL —
  // split by semicolon and run each statement individually
  const statements = (schema as string)
    .split(';')
    .map(s => s.replace(/--[^\n]*/g, '').trim())
    .filter(s => s.length > 0);
  for (const stmt of statements) {
    await db.prepare(stmt).run();
  }
});
