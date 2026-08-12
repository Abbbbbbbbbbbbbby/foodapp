#!/usr/bin/env node
// One-time backfill of families.name_normalized for rows created before the
// accent-folded search column existed (issue #6 item 5). Idempotent: only
// touches rows where the column is NULL. Requires wrangler auth for the
// target environment; pass --remote for production (default is --local).
//
//   node scripts/backfill-normalized.mjs            # local dev DB
//   node scripts/backfill-normalized.mjs --remote   # PRODUCTION (be sure!)
import { execFileSync } from 'child_process';

const remote = process.argv.includes('--remote');
const flag = remote ? '--remote' : '--local';

// MUST stay character-identical to normalizeName in src/worker/db.ts — a
// divergent backfill writes values the worker's search can never match.
// tests/scripts/backfill-normalized.test.js pins the parity.
export function normalizeName(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function d1(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'foodapp', flag, '--json', '--command', sql], { encoding: 'utf8' });
  return JSON.parse(out)[0];
}

if (process.argv[1].endsWith('backfill-normalized.mjs')) {
  const rows = d1(`SELECT id, name FROM families WHERE name_normalized IS NULL`).results;
  console.log(`${rows.length} row(s) need backfill (${flag})`);
  let updated = 0;
  for (const row of rows) {
    const norm = normalizeName(row.name).replace(/'/g, "''");
    const res = d1(`UPDATE families SET name_normalized = '${norm}' WHERE id = '${row.id}' AND name_normalized IS NULL`);
    // Count actual writes, not attempts — a concurrently-filled row no-ops.
    // Fail loud if wrangler's --json meta shape ever drifts: reporting
    // "backfilled 0" after real writes would send the operator down a
    // wrong-diagnosis path.
    const meta = res.meta ?? {};
    if (meta.changes == null && meta.rows_written == null) {
      throw new Error(
        'wrangler --json meta lacks changes/rows_written — output format changed; cannot verify writes. ' +
        'Rows updated so far ARE written; the script is idempotent, so re-run after pinning a known-good wrangler version.'
      );
    }
    updated += meta.changes ?? meta.rows_written;
  }
  // Ground truth beats per-statement meta: report what actually remains.
  const remaining = d1(`SELECT COUNT(*) AS n FROM families WHERE name_normalized IS NULL`).results[0].n;
  console.log(`backfilled ${updated} row(s); ${remaining} row(s) still NULL (expect 0)`);
  if (remaining > 0) {
    console.log('Non-zero remainder: safe to re-run (idempotent). If it persists, rows were inserted mid-run or the WHERE no longer matches — investigate before re-running a third time.');
    process.exitCode = 1;
  }
}
