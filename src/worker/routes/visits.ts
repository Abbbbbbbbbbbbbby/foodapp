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
  return null;
}

async function handleCreate(request: Request, env: Env): Promise<Response> {
  const ctx = await getAuthContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json<{ family_id?: string; visit_date?: string; picked_up_by_phone?: string }>();
  if (!body.family_id) return Response.json({ error: 'family_id is required' }, { status: 400 });
  const data: NewVisit = {
    family_id: body.family_id,
    visit_date: body.visit_date ?? new Date().toISOString().slice(0, 10),
    picked_up_by_phone: body.picked_up_by_phone ?? null,
    volunteer_id: ctx.userId,
  };
  const id = await insertVisit(env.DB, data);
  return Response.json({ id }, { status: 201 });
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
