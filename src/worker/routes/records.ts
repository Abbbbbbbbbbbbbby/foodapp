import type { Env } from '../schema';
import { getAuthContext } from '../middleware';
import type { AuthContext } from '../middleware';
import { subscribeRecipient } from '../messageeverywhere';

type Role = 'admin' | 'staff' | 'volunteer';

// Fields staff may update on a visit
const STAFF_VISIT_FIELDS = new Set(['visit_date', 'bag_received']);
// Fields admin may additionally update on a visit
const ADMIN_VISIT_FIELDS = new Set([...STAFF_VISIT_FIELDS, 'volunteer_id', 'picked_up_by_phone']);
// Fields staff may update on a family
const STAFF_FAMILY_FIELDS = new Set(['num_people']);
// Fields admin may additionally update on a family
const ADMIN_FAMILY_FIELDS = new Set([
  ...STAFF_FAMILY_FIELDS,
  'name', 'phone', 'address', 'zip_code', 'date_of_birth', 'language', 'ethnicity',
  'hispanic', 'ami_bracket', 'num_children_under_18', 'num_children_under_5',
  'num_with_diabetes', 'health_insurance', 'snap_benefits',
  'receives_texts', 'want_text_updates', 'id_confirmed', 'first_visit_date',
]);

function allowedFamilyFields(role: Role): Set<string> {
  if (role === 'admin') return ADMIN_FAMILY_FIELDS;
  if (role === 'staff') return STAFF_FAMILY_FIELDS;
  return new Set();
}
function allowedVisitFields(role: Role): Set<string> {
  if (role === 'admin') return ADMIN_VISIT_FIELDS;
  if (role === 'staff') return STAFF_VISIT_FIELDS;
  return new Set();
}


export async function handleRecordRoutes(
  request: Request,
  env: Env,
  pathname: string
): Promise<Response | null> {
  if (!pathname.startsWith('/api/records/')) return null;

  const ctx = await getAuthContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (ctx.role === 'volunteer') return Response.json({ error: 'Forbidden' }, { status: 403 });

  if (pathname === '/api/records/visits' && request.method === 'GET') {
    return handleListVisits(request, env);
  }
  if (pathname === '/api/records/families' && request.method === 'GET') {
    return handleListFamilies(request, env);
  }
  if (pathname === '/api/records/visits' && request.method === 'POST') {
    if (ctx.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    return handleAddVisit(request, env, ctx);
  }

  const visitMatch = pathname.match(/^\/api\/records\/visits\/([^/]+)$/);
  if (visitMatch) {
    if (request.method === 'PATCH') return handlePatchVisit(request, env, visitMatch[1], ctx);
    if (request.method === 'DELETE') {
      if (ctx.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
      return handleDeleteVisit(env, visitMatch[1], ctx);
    }
  }

  const familyMatch = pathname.match(/^\/api\/records\/families\/([^/]+)$/);
  if (familyMatch) {
    if (request.method === 'PATCH') return handlePatchFamily(request, env, familyMatch[1], ctx);
    if (request.method === 'DELETE') {
      if (ctx.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
      return handleDeleteFamily(env, familyMatch[1], ctx);
    }
  }

  return null;
}

async function handleListVisits(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');

  let where = '';
  const params: string[] = [];
  if (start) { where += (where ? ' AND' : ' WHERE') + ' v.visit_date >= ?'; params.push(start); }
  if (end)   { where += (where ? ' AND' : ' WHERE') + ' v.visit_date <= ?'; params.push(end); }

  const sql = `
    SELECT
      v.id, v.visit_date, v.picked_up_by_phone, v.created_at,
      f.id AS family_id, f.name AS family_name, f.phone AS family_phone, f.num_people,
      u.name AS volunteer_name
    FROM visits v
    JOIN families f ON f.id = v.family_id
    LEFT JOIN users u ON u.id = v.volunteer_id
    ${where}
    ORDER BY v.visit_date DESC, v.created_at DESC
  `;

  const result = await env.DB.prepare(sql).bind(...params).all<Record<string, unknown>>();
  return Response.json({ visits: result.results ?? [] });
}

async function handleListFamilies(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const q = url.searchParams.get('q')?.trim() ?? '';

  let where = '';
  const params: string[] = [];
  if (q) {
    where = "WHERE (LOWER(f.name) LIKE ? ESCAPE '\\' OR f.phone LIKE ?)";
    const term = '%' + q.toLowerCase().replace(/[%_\\]/g, '\\$&') + '%';
    params.push(term, '%' + q + '%');
  }

  const sql = `
    SELECT
      f.id, f.name, f.phone, f.num_people, f.created_at, f.updated_at,
      f.hispanic, f.health_insurance, f.snap_benefits, f.ami_bracket,
      f.num_children_under_18, f.num_children_under_5, f.num_with_diabetes,
      f.receives_texts, f.want_text_updates, f.id_confirmed, f.first_visit_date,
      f.address, f.zip_code, f.date_of_birth, f.language, f.ethnicity,
      COUNT(v.id) AS visit_count,
      MAX(v.visit_date) AS last_visit_date
    FROM families f
    LEFT JOIN visits v ON v.family_id = f.id
    ${where}
    GROUP BY f.id
    ORDER BY last_visit_date DESC NULLS LAST, f.name ASC
  `;

  const result = await env.DB.prepare(sql).bind(...params).all<Record<string, unknown>>();
  const families = (result.results ?? []).map(f => ({
    ...f,
    receives_texts: f.receives_texts === 1 || f.receives_texts === true,
    want_text_updates: f.want_text_updates === 1 || f.want_text_updates === true,
    id_confirmed: f.id_confirmed === 1 || f.id_confirmed === true,
  }));
  return Response.json({ families });
}

async function handlePatchVisit(
  request: Request, env: Env, id: string, ctx: AuthContext
): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const allowed = allowedVisitFields(ctx.role);
  const fields = Object.keys(body).filter(k => allowed.has(k));
  if (fields.length === 0) return Response.json({ error: 'No editable fields provided' }, { status: 400 });

  const current = await env.DB.prepare(`SELECT * FROM visits WHERE id = ?`)
    .bind(id).first<Record<string, unknown>>();
  if (!current) return Response.json({ error: 'Not found' }, { status: 404 });

  const changes: Record<string, { old: unknown; new: unknown }> = {};
  const sets: string[] = [];
  const vals: unknown[] = [];

  for (const f of fields) {
    const oldVal = current[f];
    const newVal = f === 'bag_received' ? (body[f] ? 1 : 0) : body[f];
    if (String(oldVal) !== String(newVal)) {
      changes[f] = { old: oldVal, new: body[f] };
      sets.push(`${f} = ?`);
      vals.push(newVal);
    }
  }

  if (sets.length === 0) return Response.json({ ok: true });

  vals.push(id);

  await env.DB.prepare(`UPDATE visits SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();
  return Response.json({ ok: true });
}

async function handlePatchFamily(
  request: Request, env: Env, id: string, ctx: AuthContext
): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const allowed = allowedFamilyFields(ctx.role);
  const fields = Object.keys(body).filter(k => allowed.has(k));
  if (fields.length === 0) return Response.json({ error: 'No editable fields provided' }, { status: 400 });

  const current = await env.DB.prepare(`SELECT * FROM families WHERE id = ?`)
    .bind(id).first<Record<string, unknown>>();
  if (!current) return Response.json({ error: 'Not found' }, { status: 404 });

  const BOOL_FIELDS = new Set(['receives_texts', 'want_text_updates', 'id_confirmed']);
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  const sets: string[] = [];
  const vals: unknown[] = [];

  for (const f of fields) {
    const oldVal = current[f];
    const newVal = BOOL_FIELDS.has(f) ? (body[f] ? 1 : 0) : body[f];
    if (String(oldVal) !== String(newVal)) {
      changes[f] = { old: oldVal, new: body[f] };
      sets.push(`${f} = ?`);
      vals.push(newVal);
    }
  }

  if (sets.length === 0) return Response.json({ ok: true });

  sets.push("updated_at = datetime('now')");
  vals.push(id);

  await env.DB.prepare(`UPDATE families SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run();

  if (env.MESSAGE_EVERYWHERE_API_KEY && changes.want_text_updates?.new === true
      && current.phone) {
    subscribeRecipient(
      env.MESSAGE_EVERYWHERE_API_KEY,
      current.phone as string,
      current.language as string | null,
      current.name as string
    ).catch(() => { /* best-effort */ });
  }

  return Response.json({ ok: true });
}

async function handleAddVisit(
  request: Request, env: Env, ctx: AuthContext
): Promise<Response> {
  let body: { family_id: string; visit_date: string; bag_received?: boolean; volunteer_id?: string };
  try { body = await request.json() as typeof body; }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (!body.family_id || !body.visit_date) {
    return Response.json({ error: 'family_id and visit_date are required' }, { status: 400 });
  }

  const family = await env.DB.prepare('SELECT id FROM families WHERE id = ?')
    .bind(body.family_id).first<{ id: string }>();
  if (!family) return Response.json({ error: 'Family not found' }, { status: 404 });

  const id = crypto.randomUUID().replace(/-/g, '');
  await env.DB.prepare(
    `INSERT INTO visits (id, family_id, visit_date, volunteer_id) VALUES (?, ?, ?, ?)`
  ).bind(
    id, body.family_id, body.visit_date,
    body.volunteer_id ?? ctx.userId
  ).run();

  return Response.json({ id }, { status: 201 });
}

async function handleDeleteVisit(env: Env, id: string, ctx: AuthContext): Promise<Response> {
  const visit = await env.DB.prepare(
    `SELECT v.*, f.name AS family_name FROM visits v JOIN families f ON f.id = v.family_id WHERE v.id = ?`
  ).bind(id).first<Record<string, unknown>>();
  if (!visit) return Response.json({ error: 'Not found' }, { status: 404 });

  await env.DB.prepare('DELETE FROM visits WHERE id = ?').bind(id).run();
  return Response.json({ ok: true });
}

async function handleDeleteFamily(env: Env, id: string, ctx: AuthContext): Promise<Response> {
  const family = await env.DB.prepare('SELECT * FROM families WHERE id = ?')
    .bind(id).first<Record<string, unknown>>();
  if (!family) return Response.json({ error: 'Not found' }, { status: 404 });

  const visitCount = await env.DB.prepare('SELECT COUNT(*) AS n FROM visits WHERE family_id = ?')
    .bind(id).first<{ n: number }>();

  await env.DB.prepare('DELETE FROM visits WHERE family_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM proxies WHERE family_id = ?').bind(id).run();
  await env.DB.prepare('DELETE FROM families WHERE id = ?').bind(id).run();
  return Response.json({ ok: true });
}

