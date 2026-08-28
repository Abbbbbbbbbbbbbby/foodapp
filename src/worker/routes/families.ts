import type { Env } from '../schema';
import { getAuthContext } from '../middleware';
import {
  searchFamilies, getFamiliesForPickup, getFamilyById,
  insertFamily, updateFamily, normalizePhone,
} from '../db';
import type { NewFamily, YesNoDeclined, AmiBracket } from '../schema';
import { subscribeRecipient } from '../messageeverywhere';
import { checkForDuplicates } from '../duplicates';

export const YES_NO_DECLINED = new Set<string>(['yes', 'no', 'declined']);
export const AMI_BRACKETS = new Set<string>(['<30%', '30-50%', '50-80%', '80-120%', '>120%', 'declined']);

export function validateEnums(body: Record<string, unknown>): string | null {
  const ynd = (v: unknown) => v === undefined || v === null || YES_NO_DECLINED.has(v as string);
  if (!ynd(body.hispanic)) return `invalid hispanic value: ${body.hispanic}`;
  if (!ynd(body.health_insurance)) return `invalid health_insurance value: ${body.health_insurance}`;
  if (!ynd(body.snap_benefits)) return `invalid snap_benefits value: ${body.snap_benefits}`;
  if (body.ami_bracket !== undefined && body.ami_bracket !== null && !AMI_BRACKETS.has(body.ami_bracket as string))
    return `invalid ami_bracket value: ${body.ami_bracket}`;
  if (body.language !== undefined && body.language !== null && typeof body.language !== 'string')
    return 'language must be a string';
  if (body.num_people !== undefined && body.num_people !== null && typeof body.num_people !== 'number')
    return 'num_people must be a number';
  return null;
}

export async function handleFamilyRoutes(
  request: Request,
  env: Env,
  pathname: string,
  execCtx: ExecutionContext
): Promise<Response | null> {
  if (pathname === '/api/families/search' && request.method === 'GET') {
    return handleSearch(request, env);
  }
  if (pathname === '/api/families/pickup' && request.method === 'GET') {
    return handlePickup(request, env);
  }
  if (pathname === '/api/families/directory' && request.method === 'GET') {
    return handleDirectory(request, env);
  }
  if (pathname === '/api/families' && request.method === 'POST') {
    return handleCreate(request, env, execCtx);
  }
  const proxyMatch = pathname.match(/^\/api\/families\/([a-f0-9]+)\/proxies$/);
  if (proxyMatch && request.method === 'POST') {
    return handleAddProxy(request, env, proxyMatch[1]);
  }
  const idMatch = pathname.match(/^\/api\/families\/([a-f0-9]+)$/);
  if (idMatch) {
    if (request.method === 'GET') return handleGet(request, env, idMatch[1]);
    if (request.method === 'PATCH') return handleUpdate(request, env, idMatch[1]);
  }
  return null;
}

// Persist a pickup authorization discovered at the window ("also picking up
// for" a family not yet linked to this person's phone). Idempotent: re-adding
// an existing (family, phone) pair is a no-op.
async function handleAddProxy(request: Request, env: Env, familyId: string): Promise<Response> {
  const authCtx = await getAuthContext(request, env);
  if (!authCtx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let body: { proxy_name?: string | null; proxy_phone?: string | null };
  try { body = await request.json() as typeof body; }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  // proxy_name is display metadata; the PHONE is what future pickups match
  // on (getFamiliesForPickup keys on proxy_phone). A phone-only pickup with
  // no name on file must still persist so the family appears automatically
  // next time (issue #7 requirement).
  const proxyName = body.proxy_name?.trim() || null;

  const family = await env.DB.prepare(`SELECT phone FROM families WHERE id = ?`).bind(familyId).first<{ phone: string | null }>();
  if (!family) return Response.json({ error: 'Family not found' }, { status: 404 });

  const rawPhone = body.proxy_phone ?? null;
  const proxyPhone = normalizePhone(rawPhone);
  if (rawPhone !== null && String(rawPhone).trim() !== '' && proxyPhone === null) {
    return Response.json({ error: 'proxy_phone must be a 10-digit phone number' }, { status: 400 });
  }
  // "The person here today" prefills proxy_phone with the searched phone —
  // for a family registering under their own number that IS their own
  // phone. Persisting it would make the family show up twice at pickup
  // (own + proxy), so a self-referencing authorization is a no-op.
  if (proxyPhone !== null && proxyPhone === family.phone) {
    return Response.json({ ok: true });
  }
  const existing = await env.DB.prepare(
    `SELECT 1 FROM proxies WHERE family_id = ? AND proxy_phone IS ? LIMIT 1`
  ).bind(familyId, proxyPhone).first();
  if (!existing) {
    const proxyId = crypto.randomUUID().replace(/-/g, '');
    try {
      await env.DB.prepare(
        `INSERT INTO proxies (id, family_id, proxy_name, proxy_phone, created_at) VALUES (?, ?, ?, ?, datetime('now'))`
      ).bind(proxyId, familyId, proxyName, proxyPhone).run();
    } catch (err) {
      // Concurrent add of the same (family, phone): the unique index makes
      // this an idempotent no-op, not an error.
      if (!(err instanceof Error && err.message.includes('UNIQUE'))) throw err;
    }
  }
  return Response.json({ ok: true });
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

// Lightweight full-directory listing the PWA caches in IndexedDB so a
// returning household can still be FOUND during an outage — without it,
// every offline check-in of an existing family minted a duplicate. Food
// line data is not PII (explicit project decision), so caching the roster
// on shared devices is acceptable; SMS-gated auth is still required here.
async function handleDirectory(request: Request, env: Env): Promise<Response> {
  const ctx = await getAuthContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await env.DB.prepare(`
    SELECT f.id, f.name, COALESCE(f.name_normalized, LOWER(f.name)) AS name_normalized,
           f.phone, f.num_people, MAX(v.visit_date) AS last_visit_date,
           (SELECT GROUP_CONCAT(p.proxy_phone) FROM proxies p
             WHERE p.family_id = f.id AND p.proxy_phone IS NOT NULL
             AND (f.phone IS NULL OR p.proxy_phone != f.phone)) AS proxy_phones
    FROM families f
    LEFT JOIN visits v ON v.family_id = f.id
    GROUP BY f.id
  `).all<{ id: string; name: string; name_normalized: string; phone: string | null; num_people: number | null; last_visit_date: string | null; proxy_phones: string | null }>();
  // Ship the SERVER-normalized name (the iOS 9 client can't fold accents
  // itself) and proxy pickup phones (a designated pickup person searching
  // their own number offline must find their linked families).
  const families = (rows.results ?? []).map(r => ({
    ...r,
    proxy_phones: r.proxy_phones ? r.proxy_phones.split(',') : [],
  }));
  return Response.json({ families });
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

async function handleCreate(request: Request, env: Env, execCtx: ExecutionContext): Promise<Response> {
  const ctx = await getAuthContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Partial<NewFamily> & { idempotency_key?: string; proxy?: { proxy_name: string | null; proxy_phone: string | null } };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!body.name?.trim()) {
    return Response.json({ error: 'name is required' }, { status: 400 });
  }
  const enumError = validateEnums(body);
  if (enumError) return Response.json({ error: enumError }, { status: 400 });

  const data: NewFamily = {
    name: body.name.trim(),
    phone: body.phone ?? null,
    address: body.address ?? null,
    zip_code: body.zip_code ?? null,
    date_of_birth: body.date_of_birth ?? null,
    language: body.language ?? null,
    ethnicity: body.ethnicity ?? null,
    hispanic: (body.hispanic ?? null) as YesNoDeclined | null,
    ami_bracket: (body.ami_bracket ?? null) as AmiBracket | null,
    num_people: body.num_people ?? null,
    num_children_under_18: body.num_children_under_18 ?? null,
    num_children_under_5: body.num_children_under_5 ?? null,
    num_with_diabetes: body.num_with_diabetes ?? null,
    health_insurance: (body.health_insurance ?? null) as YesNoDeclined | null,
    snap_benefits: (body.snap_benefits ?? null) as YesNoDeclined | null,
    receives_texts: body.receives_texts ?? null,
    want_text_updates: body.want_text_updates ?? null,
    id_confirmed: body.id_confirmed ?? null,
    bag_received: body.bag_received ?? null,
    first_visit_date: body.first_visit_date ?? null,
    created_by: ctx.userId,
  };

  const idempotencyKey = typeof body.idempotency_key === 'string' ? body.idempotency_key : undefined;

  // insertFamily resolves BOTH live-key replays and merged-key aliases; its
  // created flag is the single source of truth for replay detection, so alias
  // replays no longer rerun duplicate detection, subscription, or proxy work
  // with the stale discarded-family payload.
  const { id, created } = await insertFamily(env.DB, data, idempotencyKey);
  const wasReplay = !created;

  // waitUntil: without it the runtime may terminate these once the response
  // returns (Cloudflare documents floating promises as unreliable in Workers).
  if (!wasReplay && data.want_text_updates && data.phone && env.MESSAGE_EVERYWHERE_API_KEY) {
    execCtx.waitUntil(
      subscribeRecipient(env.MESSAGE_EVERYWHERE_API_KEY, data.phone, data.language, data.name)
        .catch((err) => console.error('messageeverywhere subscribe failed:', err))
    );
  }

  if (!wasReplay) {
    execCtx.waitUntil(
      checkForDuplicates(env.DB, id, data.name, data.phone)
        .catch((err) => console.error('duplicate detection failed:', err))
    );
  }

  // Same "person here today" self-referencing case as handleAddProxy: a new
  // family's own phone (data.phone, just normalized into the insert above)
  // can equal the proxy answer's phone.
  if (body.proxy && !wasReplay && normalizePhone(body.proxy.proxy_phone) !== normalizePhone(data.phone)) {
    const proxyPhone = normalizePhone(body.proxy.proxy_phone);
    // Explicit conflict check: the unique index on (family_id, proxy_phone) prevents
    // duplicate rows but only surfaces it as a thrown error, so we skip gracefully.
    const existingProxy = await env.DB.prepare(
      `SELECT 1 FROM proxies WHERE family_id = ? AND proxy_phone IS ? LIMIT 1`
    ).bind(id, proxyPhone).first();
    if (!existingProxy) {
      const proxyId = crypto.randomUUID().replace(/-/g, '');
      await env.DB.prepare(
        `INSERT INTO proxies (id, family_id, proxy_name, proxy_phone, created_at) VALUES (?, ?, ?, ?, datetime('now'))`
      ).bind(proxyId, id, body.proxy.proxy_name, proxyPhone).run();
    }
  }
  // 201 for a genuinely new record, 200 for any replay (live key or alias)
  const status = created ? 201 : 200;
  return Response.json({ id }, { status });
}

async function handleUpdate(request: Request, env: Env, id: string): Promise<Response> {
  const ctx = await getAuthContext(request, env);
  if (!ctx) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let body: Partial<NewFamily>;
  try {
    body = await request.json() as Partial<NewFamily>;
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const enumError = validateEnums(body);
  if (enumError) return Response.json({ error: enumError }, { status: 400 });
  await updateFamily(env.DB, id, body);
  return Response.json({ ok: true });
}
