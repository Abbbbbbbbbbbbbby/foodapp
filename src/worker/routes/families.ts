import type { Env } from '../schema';
import { getAuthContext } from '../middleware';
import {
  searchFamilies, getFamiliesForPickup, getFamilyById,
  insertFamily, updateFamily,
} from '../db';
import type { NewFamily } from '../schema';

export async function handleFamilyRoutes(
  request: Request,
  env: Env,
  pathname: string
): Promise<Response | null> {
  if (pathname === '/api/families/search' && request.method === 'GET') {
    return handleSearch(request, env);
  }
  if (pathname === '/api/families/pickup' && request.method === 'GET') {
    return handlePickup(request, env);
  }
  if (pathname === '/api/families' && request.method === 'POST') {
    return handleCreate(request, env);
  }
  const idMatch = pathname.match(/^\/api\/families\/([a-f0-9]+)$/);
  if (idMatch) {
    if (request.method === 'GET') return handleGet(request, env, idMatch[1]);
    if (request.method === 'PATCH') return handleUpdate(request, env, idMatch[1]);
  }
  return null;
}

async function handleSearch(request: Request, env: Env): Promise<Response> {
  const ctx = await getAuthContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(request.url);
  const name = url.searchParams.get('name') ?? undefined;
  const phone = url.searchParams.get('phone') ?? undefined;
  if (!name && !phone) {
    return Response.json({ error: 'name or phone is required' }, { status: 400 });
  }
  const results = await searchFamilies(env.DB, { name, phone });
  return Response.json({ results });
}

async function handlePickup(request: Request, env: Env): Promise<Response> {
  const ctx = await getAuthContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const url = new URL(request.url);
  const phone = url.searchParams.get('phone');
  if (!phone) return Response.json({ error: 'phone is required' }, { status: 400 });
  const result = await getFamiliesForPickup(env.DB, phone);
  return Response.json(result);
}

async function handleGet(request: Request, env: Env, id: string): Promise<Response> {
  const ctx = await getAuthContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const family = await getFamilyById(env.DB, id);
  if (!family) return Response.json({ error: 'Not found' }, { status: 404 });
  return Response.json(family);
}

async function handleCreate(request: Request, env: Env): Promise<Response> {
  const ctx = await getAuthContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json<Partial<NewFamily> & { proxy?: { proxy_name: string; proxy_phone: string | null } }>();
  if (!body.name?.trim()) {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }
  const data: NewFamily = {
    name: body.name.trim(),
    phone: body.phone ?? null,
    address: body.address ?? null,
    zip_code: body.zip_code ?? null,
    date_of_birth: body.date_of_birth ?? null,
    language: body.language ?? null,
    ethnicity: body.ethnicity ?? null,
    hispanic: body.hispanic ?? null,
    ami_bracket: body.ami_bracket ?? null,
    num_people: body.num_people ?? null,
    num_children_under_18: body.num_children_under_18 ?? null,
    num_children_under_5: body.num_children_under_5 ?? null,
    num_with_diabetes: body.num_with_diabetes ?? null,
    health_insurance: body.health_insurance ?? null,
    snap_benefits: body.snap_benefits ?? null,
    receives_texts: body.receives_texts ?? null,
    want_text_updates: body.want_text_updates ?? null,
    id_confirmed: body.id_confirmed ?? null,
    bag_received: body.bag_received ?? null,
    first_visit_date: body.first_visit_date ?? null,
    created_by: ctx.userId,
  };
  const id = await insertFamily(env.DB, data);
  if (body.proxy) {
    const proxyId = crypto.randomUUID().replace(/-/g, '');
    await env.DB.prepare(
      `INSERT INTO proxies (id, family_id, proxy_name, proxy_phone, created_at) VALUES (?, ?, ?, ?, datetime('now'))`
    ).bind(proxyId, id, body.proxy.proxy_name, body.proxy.proxy_phone).run();
  }
  return Response.json({ id }, { status: 201 });
}

async function handleUpdate(request: Request, env: Env, id: string): Promise<Response> {
  const ctx = await getAuthContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json<Partial<NewFamily>>();
  await updateFamily(env.DB, id, body);
  return Response.json({ ok: true });
}
