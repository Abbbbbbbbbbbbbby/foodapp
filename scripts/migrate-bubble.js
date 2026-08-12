#!/usr/bin/env node
// @ts-check
import { readFileSync, writeFileSync } from 'fs';
import { randomUUID } from 'crypto';

const AMI = { 1: 59347, 2: 94640, 3: 115062, 4: 125621, 5: 121268, 6: 132321, 7: 127820 };

// Mirrors the runtime rule in src/worker/db.ts: search and pickup lookups
// require exactly 10 digits, so anything else imported here would be
// permanently unfindable by phone. 11-digit numbers with a leading 1 are
// canonicalized; the rest become null and are counted in the run summary.
export function normalizePhone(phone) {
  if (phone == null) return null;
  let digits = String(phone).replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits.length === 10 ? digits : null;
}

// Mirror of src/worker/db.ts normalizeName: accent-fold + lowercase so
// imported rows are reachable by the runtime's folded search.
export function normalizeName(s) {
  return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Tracks phones dropped by normalizePhone so the summary can report them
// instead of silently importing unfindable families.
export function auditPhone(phone, droppedList, context) {
  const norm = normalizePhone(phone);
  if (norm === null && phone != null && String(phone).replace(/\D/g, '').length > 0) {
    droppedList.push({ context, raw: String(phone) });
  }
  return norm;
}

export function annualizeIncome(amount, unit) {
  if (amount == null) return null;
  const n = Number(amount);
  if (!isFinite(n)) return null;
  const multipliers = { weekly: 52, biweekly: 26, monthly: 12, yearly: 1 };
  return n * (multipliers[unit] ?? 1);
}

export function calculateAmiBracket(annualIncome, numPeople) {
  if (annualIncome == null) return 'declined';
  const size = Math.min(Math.max(1, Math.round(numPeople ?? 1)), 7);
  const ami = AMI[size];
  const pct = annualIncome / ami;
  if (pct < 0.30) return '<30%';
  if (pct < 0.50) return '30-50%';
  if (pct < 0.80) return '50-80%';
  if (pct < 1.20) return '80-120%';
  return '>120%';
}

export function mapHispanic(val) {
  if (!val) return null;
  const v = String(val).toLowerCase().trim();
  if (v === 'yes') return 'yes';
  if (v === 'no') return 'no';
  if (v === 'unavailable' || v === 'n/a') return 'declined';
  return null;
}

export function mapYesNo(val) {
  if (!val) return null;
  const v = String(val).toLowerCase().trim();
  if (v === 'yes') return 'yes';
  if (v === 'no') return 'no';
  if (v === 'unavailable' || v === 'n/a') return 'declined';
  return null;
}

function sq(val) {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  return `'${String(val).replace(/'/g, "''")}'`;
}

function uid() { return randomUUID().replace(/-/g, ''); }

function mapIncomeUnit(bubbleUnit) {
  const u = String(bubbleUnit ?? '').toLowerCase();
  if (u.includes('week') && u.includes('bi')) return 'biweekly';
  if (u.includes('week')) return 'weekly';
  if (u.includes('month')) return 'monthly';
  if (u.includes('year') || u.includes('annual')) return 'yearly';
  return 'yearly';
}

// Pure pipeline: takes the parsed Bubble export and raw CSV text, returns the
// SQL lines, counts, and dropped-phone report. Exported for fixture testing —
// the argv main block below only does I/O around this.
export function generateMigration(data, csvRaw) {
  const userTypes = data.user_types ?? {};
  const lines = [];
  const now = new Date().toISOString();

  lines.push('-- Generated migration from food-data.bubble');
  lines.push('BEGIN TRANSACTION;');
  lines.push('');

  const userType = Object.values(userTypes).find(t => t.name === 'user');
  let userCount = 0;
  if (userType) {
    const adminId = uid();
    lines.push(`INSERT OR IGNORE INTO users (id, name, phone, role, active, self_registered, created_at) VALUES`);
    lines.push(`  (${sq(adminId)}, 'Admin', '0000000000', 'admin', 1, 0, ${sq(now)});`);
    userCount = 1;
  }

  let familyCount = 0;
  let visitCount = 0;
  let proxyCount = 0;
  const droppedPhones = [];

  const familyType = Object.values(userTypes).find(t => t.name === 'family_data');
  if (!familyType) {
    console.warn('No family_data type found in export. Checking for records in CSV...');
  }

  let csvFamilies = [];
  if (csvRaw) {
    const csvLines = csvRaw.trim().split('\n').slice(1);
    csvFamilies = csvLines
      .map(l => {
        const parts = l.replace(/^"|"$/gm, '').split('","');
        return {
          name: parts[0]?.trim(),
          phone: auditPhone(parts[1], droppedPhones, `family "${parts[0]}"`),
          proxies: parts[2]?.trim(),
          proxyPhones: auditPhone(parts[3], droppedPhones, `proxy for "${parts[0]}"`),
        };
      })
      .filter(f => f.name);
  }

  const familyIdMap = new Map();
  for (const f of csvFamilies) {
    const fid = uid();
    const key = `${f.name}|${f.phone ?? ''}`;
    familyIdMap.set(key, fid);
    lines.push(
      `INSERT OR IGNORE INTO families (id, name, name_normalized, phone, created_at, updated_at) VALUES ` +
      `(${sq(fid)}, ${sq(f.name)}, ${sq(normalizeName(f.name))}, ${sq(f.phone)}, ${sq(now)}, ${sq(now)});`
    );
    familyCount++;

    if (f.proxies) {
      const pid = uid();
      lines.push(
        `INSERT INTO proxies (id, family_id, proxy_name, proxy_phone, created_at) VALUES ` +
        `(${sq(pid)}, ${sq(fid)}, ${sq(f.proxies)}, ${sq(f.proxyPhones)}, ${sq(now)});`
      );
      proxyCount++;
    }
  }

  lines.push('');
  lines.push('COMMIT;');
  lines.push('');
  lines.push(`-- Summary: ${userCount} users, ${familyCount} families, ${visitCount} visits, ${proxyCount} proxies`);

  return { lines, userCount, familyCount, visitCount, proxyCount, droppedPhones };
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const bubblePath = `${process.env.HOME}/Downloads/food-data.bubble`;
  const outPath = './migrations/migrated-data.sql';

  console.log(`Reading ${bubblePath}...`);
  const raw = readFileSync(bubblePath, 'utf8');
  const data = JSON.parse(raw);

  let csvRaw = null;
  try {
    csvRaw = readFileSync(`${process.env.HOME}/Downloads/appdata20260213.csv`, 'utf8');
  } catch (e) {
    console.warn('Could not read CSV:', e.message);
  }

  const { lines, userCount, familyCount, visitCount, proxyCount, droppedPhones } = generateMigration(data, csvRaw);
  if (csvRaw) console.log(`Loaded ${familyCount} families from CSV`);

  writeFileSync(outPath, lines.join('\n'));
  console.log(`Wrote ${lines.length} SQL lines to ${outPath}`);
  console.log(`Migrated: ${userCount} users, ${familyCount} families, ${visitCount} visits, ${proxyCount} proxies`);
  if (droppedPhones.length > 0) {
    console.warn(`WARNING: ${droppedPhones.length} phone(s) were not valid 10-digit numbers and were imported as NULL (family will not be findable by phone):`);
    for (const d of droppedPhones) console.warn(`  - ${d.context}: "${d.raw}"`);
  }
}
