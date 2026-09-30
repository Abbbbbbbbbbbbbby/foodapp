import type { Env } from '../schema';
import { getAuthContext } from '../middleware';

type Bucket = { value: string; count: number };

const NUMERIC_FAMILY = new Set([
  'num_people', 'num_children_under_18', 'num_children_under_5', 'num_with_diabetes',
]);

const FILTERABLE_FAMILY = new Set([
  'zip_code', 'language', 'ami_bracket', 'snap_benefits', 'health_insurance',
  'hispanic', 'ethnicity', 'receives_texts',
  'num_people', 'num_children_under_18', 'num_children_under_5', 'num_with_diabetes',
]);

const FILTERABLE_VISIT = new Set(['bag_received']);

const OPS: Record<string, string> = { eq: '=', gte: '>=', lte: '<=', gt: '>', lt: '<' };

// GROUP BY a family column. With date range, restricts to families who visited then.
// col is always a hardcoded string from the call sites below — not user input.
async function distFamily(
  db: D1Database,
  col: string,
  limit: number,
  start: string | null,
  end: string | null,
): Promise<Bucket[]> {
  let sql: string;
  const params: (string | number)[] = [];
  if (start && end) {
    sql = `SELECT CAST(f.${col} AS TEXT) AS value, COUNT(DISTINCT f.id) AS count
           FROM families f JOIN visits v ON v.family_id = f.id
           WHERE v.visit_date >= ? AND v.visit_date <= ? AND f.${col} IS NOT NULL
           GROUP BY f.${col} ORDER BY count DESC LIMIT ?`;
    params.push(start, end, limit);
  } else {
    sql = `SELECT CAST(${col} AS TEXT) AS value, COUNT(*) AS count
           FROM families WHERE ${col} IS NOT NULL
           GROUP BY ${col} ORDER BY count DESC LIMIT ?`;
    params.push(limit);
  }
  const { results } = await db.prepare(sql).bind(...params).all<Bucket>();
  return results ?? [];
}

// Like distFamily but appends an 'Others' bucket for counts beyond the limit.
// col is always a hardcoded string from the call site — not user input.
async function distFamilyWithOthers(
  db: D1Database,
  col: string,
  limit: number,
  start: string | null,
  end: string | null,
): Promise<Bucket[]> {
  const top = await distFamily(db, col, limit, start, end);
  if (top.length < limit) return top; // fewer results than the limit → no Others

  const topSum = top.reduce((s, b) => s + b.count, 0);
  let totalRow: { n: number } | null;
  if (start && end) {
    totalRow = await db.prepare(
      `SELECT COUNT(DISTINCT f.id) AS n FROM families f JOIN visits v ON v.family_id = f.id
       WHERE v.visit_date >= ? AND v.visit_date <= ? AND f.${col} IS NOT NULL`
    ).bind(start, end).first<{ n: number }>();
  } else {
    totalRow = await db.prepare(
      `SELECT COUNT(*) AS n FROM families WHERE ${col} IS NOT NULL`
    ).first<{ n: number }>();
  }
  const others = (totalRow?.n ?? 0) - topSum;
  if (others > 0) top.push({ value: 'Others', count: others });
  return top;
}

// Per-visit bag distribution when date-filtered; per-family (max) for all time.
async function distBag(db: D1Database, start: string | null, end: string | null): Promise<Bucket[]> {
  let sql: string;
  const params: string[] = [];
  if (start && end) {
    sql = `SELECT CAST(v.bag_received AS TEXT) AS value, COUNT(*) AS count
           FROM visits v WHERE v.visit_date >= ? AND v.visit_date <= ?
           GROUP BY v.bag_received ORDER BY v.bag_received DESC`;
    params.push(start, end);
  } else {
    sql = `SELECT CAST(bag_received AS TEXT) AS value, COUNT(*) AS count
           FROM (SELECT family_id, MAX(bag_received) AS bag_received FROM visits GROUP BY family_id)
           GROUP BY bag_received ORDER BY bag_received DESC`;
  }
  const { results } = await db.prepare(sql).bind(...params).all<Bucket>();
  return results ?? [];
}

export async function handleSummaryRoute(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> {
  if (pathname !== '/api/admin/summary' || request.method !== 'GET') return null;

  const ctx = await getAuthContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (ctx.role === 'volunteer') return Response.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const start = url.searchParams.get('start') || null;
  const end   = url.searchParams.get('end')   || null;
  const filterFields = url.searchParams.getAll('field');
  const filterOps   = url.searchParams.getAll('op');
  const filterVals  = url.searchParams.getAll('val');
  const logic = url.searchParams.get('logic') === 'or' ? 'OR' : 'AND';

  // --- Cross-filter mode (field params present) ---
  if (filterFields.length > 0) {
    // Group repeated field params: same field + op=eq → IN (...); other ops stay single.
    const groups = new Map<string, { op: string; vals: string[] }>();
    for (let i = 0; i < Math.min(filterFields.length, filterOps.length, filterVals.length); i++) {
      const f = filterFields[i], op = filterOps[i], v = filterVals[i];
      if (!OPS[op]) continue;
      if (!FILTERABLE_FAMILY.has(f) && !FILTERABLE_VISIT.has(f)) continue;
      if (!groups.has(f)) groups.set(f, { op, vals: [] });
      groups.get(f)!.vals.push(v);
    }

    const clauses: string[] = [];
    const params: (string | number)[] = [];
    let needsVisit = !!(start && end);

    for (const [field, { op, vals }] of groups.entries()) {
      if (FILTERABLE_FAMILY.has(field)) {
        if (vals.length > 1 && op === 'eq') {
          clauses.push(`f.${field} IN (${vals.map(() => '?').join(',')})`);
          params.push(...vals);
        } else {
          clauses.push(`f.${field} ${OPS[op]} ?`);
          params.push(NUMERIC_FAMILY.has(field) ? Number(vals[0]) : vals[0]);
        }
      } else if (FILTERABLE_VISIT.has(field)) {
        needsVisit = true;
        if (vals.length > 1 && op === 'eq') {
          clauses.push(`v.${field} IN (${vals.map(() => '?').join(',')})`);
          params.push(...vals);
        } else {
          clauses.push(`v.${field} ${OPS[op]} ?`);
          params.push(vals[0]);
        }
      }
    }

    let sql = `SELECT COUNT(DISTINCT f.id) AS count FROM families f`;
    if (needsVisit) sql += ` JOIN visits v ON v.family_id = f.id`;

    const whereParts: string[] = [];
    if (clauses.length > 0) {
      whereParts.push(clauses.length > 1 ? `(${clauses.join(` ${logic} `)})` : clauses[0]);
    }
    if (start && end) {
      whereParts.push('v.visit_date >= ?', 'v.visit_date <= ?');
      params.push(start, end);
    }
    if (whereParts.length > 0) sql += ` WHERE ${whereParts.join(' AND ')}`;

    // Total denominator: families in the selected date range (or all families).
    const [countRow, totalRow] = await Promise.all([
      env.DB.prepare(sql).bind(...params).first<{ count: number }>(),
      start && end
        ? env.DB.prepare(`SELECT COUNT(DISTINCT family_id) AS total FROM visits WHERE visit_date >= ? AND visit_date <= ?`).bind(start, end).first<{ total: number }>()
        : env.DB.prepare(`SELECT COUNT(*) AS total FROM families`).first<{ total: number }>(),
    ]);
    return Response.json({ count: countRow?.count ?? 0, total: totalRow?.total ?? 0 });
  }

  // --- Summary mode: totals + all field distributions ---
  const dp = (start && end) ? [start, end] : null;

  const [familiesRow, visitsRow, boxesRow, bagsRow] = await Promise.all([
    dp
      ? env.DB.prepare(`SELECT COUNT(DISTINCT family_id) AS n FROM visits WHERE visit_date >= ? AND visit_date <= ?`).bind(...dp).first<{ n: number }>()
      : env.DB.prepare(`SELECT COUNT(*) AS n FROM families`).first<{ n: number }>(),
    dp
      ? env.DB.prepare(`SELECT COUNT(*) AS n FROM visits WHERE visit_date >= ? AND visit_date <= ?`).bind(...dp).first<{ n: number }>()
      : env.DB.prepare(`SELECT COUNT(*) AS n FROM visits`).first<{ n: number }>(),
    dp
      ? env.DB.prepare(`SELECT SUM(CASE WHEN COALESCE(f.num_people,0) > 5 THEN 2 ELSE 1 END) AS n FROM visits v JOIN families f ON f.id = v.family_id WHERE v.visit_date >= ? AND v.visit_date <= ?`).bind(...dp).first<{ n: number }>()
      : env.DB.prepare(`SELECT SUM(CASE WHEN COALESCE(f.num_people,0) > 5 THEN 2 ELSE 1 END) AS n FROM visits v JOIN families f ON f.id = v.family_id`).first<{ n: number }>(),
    dp
      ? env.DB.prepare(`SELECT SUM(CASE WHEN COALESCE(f.num_people,0) > 5 THEN 2 ELSE 1 END) AS n FROM visits v JOIN families f ON f.id = v.family_id WHERE v.visit_date >= ? AND v.visit_date <= ? AND v.bag_received = 1`).bind(...dp).first<{ n: number }>()
      : env.DB.prepare(`SELECT SUM(CASE WHEN COALESCE(f.num_people,0) > 5 THEN 2 ELSE 1 END) AS n FROM visits v JOIN families f ON f.id = v.family_id WHERE v.bag_received = 1`).first<{ n: number }>(),
  ]);

  const COLS = ['language', 'ami_bracket', 'snap_benefits', 'health_insurance',
    'hispanic', 'ethnicity', 'receives_texts', 'num_people', 'num_children_under_18',
    'num_children_under_5', 'num_with_diabetes'] as const;
  const LIMITS = [15, 10, 5, 5, 5, 20, 5, 15, 15, 10, 10];

  const [bagDist, zipDist, ...colDists] = await Promise.all([
    distBag(env.DB, start, end),
    distFamilyWithOthers(env.DB, 'zip_code', 10, start, end),
    ...COLS.map((c, i) => distFamily(env.DB, c, LIMITS[i], start, end)),
  ]);

  const fields: Record<string, Bucket[]> = { bag_received: bagDist as Bucket[], zip_code: zipDist };
  COLS.forEach((c, i) => { fields[c] = colDists[i] as Bucket[]; });

  return Response.json({
    totals: {
      families: familiesRow?.n ?? 0,
      visits:   visitsRow?.n  ?? 0,
      boxes:    boxesRow?.n   ?? 0,
      bags:     bagsRow?.n    ?? 0,
    },
    fields,
  });
}
