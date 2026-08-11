import type { Env, NewVisit } from '../schema';
import { getAuthContext } from '../middleware';
import { insertVisit, getVisitsByFamily } from '../db';

export async function handleVisitRoutes(
  request: Request,
  env: Env,
  pathname: string
): Promise<Response | null> {
  if (pathname === '/api/visits' && request.method === 'POST') {
    return handleCreate(request, env);
  }
  if (pathname === '/api/visits' && request.method === 'GET') {
    return handleGet(request, env);
  }
  const bagMatch = pathname.match(/^\/api\/visits\/([^/]+)\/bag$/);
  if (bagMatch && request.method === 'PATCH') {
    return handleMarkBag(request, env, bagMatch[1]);
  }
  return null;
}

async function handleCreate(request: Request, env: Env): Promise<Response> {
  const ctx = await getAuthContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { family_id?: string; visit_date?: string; picked_up_by_phone?: string; idempotency_key?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.family_id) return Response.json({ error: 'family_id is required' }, { status: 400 });
  if (!body.visit_date) return Response.json({ error: 'visit_date is required' }, { status: 400 });
  const data: NewVisit = {
    family_id: body.family_id,
    visit_date: body.visit_date,
    picked_up_by_phone: body.picked_up_by_phone ?? null,
    volunteer_id: ctx.userId,
  };
  const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key : undefined;
  const id = await insertVisit(env.DB, data, idempotencyKey);
  const status = idempotencyKey ? 200 : 201;
  return Response.json({ id }, { status });
}

async function handleMarkBag(request: Request, env: Env, visitId: string): Promise<Response> {
  const ctx = await getAuthContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { bag_received?: boolean };
  try { body = await request.json(); } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const bagReceived = body.bag_received ? 1 : 0;
  const result = await env.DB.prepare(
    'UPDATE visits SET bag_received = ? WHERE id = ?'
  ).bind(bagReceived, visitId).run();
  if (result.meta.changes === 0) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json({ ok: true });
}

async function handleGet(request: Request, env: Env): Promise<Response> {
  const ctx = await getAuthContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(request.url);
  const familyId = url.searchParams.get('familyId');
  if (!familyId) return Response.json({ error: 'familyId is required' }, { status: 400 });
  const visits = await getVisitsByFamily(env.DB, familyId);
  return Response.json({ visits });
}
