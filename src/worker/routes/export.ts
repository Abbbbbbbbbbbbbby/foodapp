import type { Env } from '../schema';
import { getAuthContext } from '../middleware';

const FAMILY_COLS: Record<string, string> = {
  name:                   'f.name',
  phone:                  'f.phone',
  zip_code:               'f.zip_code',
  language:               'f.language',
  num_people:             'f.num_people',
  num_children_under_18:  'f.num_children_under_18',
  num_children_under_5:   'f.num_children_under_5',
  num_with_diabetes:      'f.num_with_diabetes',
  ami_bracket:            'f.ami_bracket',
  snap_benefits:          'f.snap_benefits',
  health_insurance:       'f.health_insurance',
  hispanic:               'f.hispanic',
  ethnicity:              'f.ethnicity',
  receives_texts:         'f.receives_texts',
  first_visit_date:       'f.first_visit_date',
};

const VISIT_COLS: Record<string, string> = {
  visit_date:        'v.visit_date',
  bag_received:      'v.bag_received',
  volunteer_name:    'u.name',
  picked_up_by_phone: 'v.picked_up_by_phone',
};

// Columns that the filter UI can use — allowlisted to prevent SQL injection.
// Numeric fields (num_*) use the same `= ?` binding; SQLite coerces the string.
const FILTERABLE = new Set([
  'zip_code', 'language', 'ami_bracket', 'snap_benefits',
  'health_insurance', 'hispanic', 'ethnicity',
  'num_people', 'num_children_under_5', 'num_with_diabetes',
]);

// SQLite integer booleans rendered as Yes/No in the CSV
const BOOL_FIELDS = new Set(['bag_received', 'receives_texts']);

const CSV_HEADERS: Record<string, string> = {
  name:                   'Family Name',
  phone:                  'Phone',
  zip_code:               'ZIP Code',
  language:               'Language',
  num_people:             'Household Size',
  num_children_under_18:  'Children Under 18',
  num_children_under_5:   'Children Under 5',
  num_with_diabetes:      'Members With Diabetes',
  ami_bracket:            'Income Level',
  snap_benefits:          'SNAP Benefits',
  health_insurance:       'Health Insurance',
  hispanic:               'Hispanic/Latino',
  ethnicity:              'Ethnicity',
  receives_texts:         'Receives Texts',
  first_visit_date:       'First Visit Date',
  visit_date:             'Visit Date',
  bag_received:           'Bag Received',
  volunteer_name:         'User',
  picked_up_by_phone:     'Picked Up By (Phone)',
};

// RFC 4180 quoting plus an Excel formula-injection guard, matching the same
// pattern already established in src/admin/csv.ts: family/visit fields here
// are volunteer- or family-supplied free text, so a cell starting with
// = + - or @ (after any leading tab/CR/LF/space Excel skips) gets a leading
// apostrophe to neutralize it before opening in a spreadsheet.
function csvCell(val: unknown, isBool: boolean): string {
  if (val === null || val === undefined) return '';
  if (isBool) return (val === 1 || val === true) ? 'Yes' : 'No';
  let s = String(val);
  if (/^[\t\r\n ]*[=+\-@]/.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function handleExportRoute(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response | null> {
  if (pathname !== '/api/admin/export' || request.method !== 'GET') return null;

  const ctx = await getAuthContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (ctx.role === 'volunteer') return Response.json({ error: 'Forbidden' }, { status: 403 });

  const url = new URL(request.url);
  const rawFields = (url.searchParams.get('fields') ?? '')
    .split(',').map(f => f.trim()).filter(Boolean);
  const filterMode = url.searchParams.get('filterMode') ?? 'visit_date';
  const start  = url.searchParams.get('start');
  const end    = url.searchParams.get('end');

  // Build SELECT list, preserving the requested field order
  const selectParts: string[] = [];
  const fieldOrder: string[] = [];
  let needsVisit = filterMode === 'visit_date';

  for (const field of rawFields) {
    if (FAMILY_COLS[field]) {
      selectParts.push(`${FAMILY_COLS[field]} AS ${field}`);
      fieldOrder.push(field);
    } else if (VISIT_COLS[field]) {
      selectParts.push(`${VISIT_COLS[field]} AS ${field}`);
      fieldOrder.push(field);
      needsVisit = true;
    }
  }

  if (fieldOrder.length === 0) {
    return Response.json({ error: 'No valid fields specified' }, { status: 400 });
  }

  const params: (string | null)[] = [];
  const whereClauses: string[] = [];

  let sql = `SELECT ${selectParts.join(', ')} FROM families f`;
  if (needsVisit) {
    sql += ' JOIN visits v ON v.family_id = f.id LEFT JOIN users u ON u.id = v.volunteer_id';
  }

  if (filterMode === 'visit_date') {
    if (start) { whereClauses.push('v.visit_date >= ?'); params.push(start); }
    if (end)   { whereClauses.push('v.visit_date <= ?'); params.push(end); }
  } else if (filterMode === 'field') {
    const ff = url.searchParams.get('filterField') ?? '';
    const fv = url.searchParams.get('filterValue') ?? '';
    if (FILTERABLE.has(ff)) {
      whereClauses.push(`f.${ff} = ?`);
      params.push(fv);
    }
  } else if (filterMode === 'multi') {
    const ffs = url.searchParams.getAll('filterField');
    const fvs = url.searchParams.getAll('filterValue');
    for (let i = 0; i < Math.min(ffs.length, fvs.length); i++) {
      if (FILTERABLE.has(ffs[i])) {
        whereClauses.push(`f.${ffs[i]} = ?`);
        params.push(fvs[i]);
      }
    }
  }

  if (whereClauses.length > 0) sql += ' WHERE ' + whereClauses.join(' AND ');
  sql += needsVisit ? ' ORDER BY v.visit_date DESC' : ' ORDER BY f.name ASC';

  const stmt = params.length > 0 ? env.DB.prepare(sql).bind(...params) : env.DB.prepare(sql);
  const { results } = await stmt.all<Record<string, unknown>>();

  const headerRow = fieldOrder.map(f => csvCell(CSV_HEADERS[f] ?? f, false)).join(',');
  const dataRows = (results ?? []).map(row =>
    fieldOrder.map(f => csvCell(row[f], BOOL_FIELDS.has(f))).join(',')
  );

  const csv = [headerRow, ...dataRows].join('\r\n');
  const filename = `export-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
