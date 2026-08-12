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

export function normalizeName(s) {
  return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function d1(sql) {
  const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'foodapp', flag, '--json', '--command', sql], { encoding: 'utf8' });
  return JSON.parse(out)[0].results;
}

if (process.argv[1].endsWith('backfill-normalized.mjs')) {
  const rows = d1(`SELECT id, name FROM families WHERE name_normalized IS NULL`);
  console.log(`${rows.length} row(s) need backfill (${flag})`);
  let updated = 0;
  for (const row of rows) {
    const norm = normalizeName(row.name).replace(/'/g, "''");
    d1(`UPDATE families SET name_normalized = '${norm}' WHERE id = '${row.id}' AND name_normalized IS NULL`);
    updated++;
  }
  console.log(`backfilled ${updated} row(s)`);
}
