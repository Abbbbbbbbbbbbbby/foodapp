import type { Env } from '../schema';
import { requireRole } from '../middleware';
import type { AuthContext } from '../middleware';
import { mergeFamilies, rescanAllDuplicates } from '../duplicates';

interface FlagRow {
  id: string;
  reason: string;
  created_at: string;
  a_id: string; a_name: string; a_phone: string | null;
  a_num_people: number | null; a_language: string | null;
  a_visit_count: number; a_last_visit: string | null;
  b_id: string; b_name: string; b_phone: string | null;
  b_num_people: number | null; b_language: string | null;
  b_visit_count: number; b_last_visit: string | null;
}

const LIST_SQL = `
  SELECT
    df.id, df.reason, df.created_at,
    fa.id AS a_id, fa.name AS a_name, fa.phone AS a_phone,
    fa.num_people AS a_num_people, fa.language AS a_language,
    (SELECT COUNT(*) FROM visits WHERE family_id = fa.id) AS a_visit_count,
    (SELECT MAX(visit_date) FROM visits WHERE family_id = fa.id) AS a_last_visit,
    fb.id AS b_id, fb.name AS b_name, fb.phone AS b_phone,
    fb.num_people AS b_num_people, fb.language AS b_language,
    (SELECT COUNT(*) FROM visits WHERE family_id = fb.id) AS b_visit_count,
    (SELECT MAX(visit_date) FROM visits WHERE family_id = fb.id) AS b_last_visit
  FROM duplicate_flags df
  JOIN families fa ON fa.id = df.family_a_id
  JOIN families fb ON fb.id = df.family_b_id
  WHERE df.status = 'pending'
  ORDER BY df.created_at DESC
`;

function shapeFlag(row: FlagRow) {
  return {
    id: row.id,
    reason: row.reason,
    created_at: row.created_at,
    family_a: {
      id: row.a_id, name: row.a_name, phone: row.a_phone,
      num_people: row.a_num_people, language: row.a_language,
      visit_count: row.a_visit_count, last_visit_date: row.a_last_visit,
    },
    family_b: {
      id: row.b_id, name: row.b_name, phone: row.b_phone,
      num_people: row.b_num_people, language: row.b_language,
      visit_count: row.b_visit_count, last_visit_date: row.b_last_visit,
    },
  };
}

export async function handleDuplicateRoutes(
  request: Request,
  env: Env,
  pathname: string
): Promise<Response | null> {
  if (!pathname.startsWith('/api/admin/duplicates')) return null;

  const ctxOrResponse = await requireRole('admin')(request, env);
  if (ctxOrResponse instanceof Response) return ctxOrResponse;
  const ctx = ctxOrResponse as AuthContext;

  if (pathname === '/api/admin/duplicates' && request.method === 'GET') {
    const { results } = await env.DB.prepare(LIST_SQL).all<FlagRow>();
    return Response.json({ flags: (results ?? []).map(shapeFlag) });
  }

  if (pathname === '/api/admin/duplicates/rescan' && request.method === 'POST') {
    const added = await rescanAllDuplicates(env.DB);
    return Response.json({ ok: true, added });
  }

  const mergeMatch = pathname.match(/^\/api\/admin\/duplicates\/([^/]+)\/merge$/);
  if (mergeMatch && request.method === 'POST') {
    return handleMerge(request, env, mergeMatch[1], ctx);
  }

  const dismissMatch = pathname.match(/^\/api\/admin\/duplicates\/([^/]+)\/dismiss$/);
  if (dismissMatch && request.method === 'POST') {
    return handleDismiss(env, dismissMatch[1], ctx);
  }

  return null;
}

async function handleMerge(
  request: Request,
  env: Env,
  flagId: string,
  ctx: AuthContext
): Promise<Response> {
  let body: { keep_id: string };
  try { body = await request.json() as typeof body; }
  catch { return Response.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const flag = await env.DB.prepare(
    `SELECT family_a_id, family_b_id FROM duplicate_flags WHERE id = ? AND status = 'pending'`
  ).bind(flagId).first<{ family_a_id: string; family_b_id: string }>();
  if (!flag) return Response.json({ error: 'Flag not found or already resolved' }, { status: 404 });

  const { keep_id } = body;
  if (keep_id !== flag.family_a_id && keep_id !== flag.family_b_id) {
    return Response.json({ error: 'keep_id must be one of the two flagged families' }, { status: 400 });
  }
  const discardId = keep_id === flag.family_a_id ? flag.family_b_id : flag.family_a_id;

  // One atomic batch: merge, delete flags referencing the discard family
  // (their NOT NULL FK blocks the family delete), delete the family, and
  // write the merge to record_changes. Flags referencing only the keep
  // family remain pending and stay reviewable.
  try {
    await mergeFamilies(env.DB, keep_id, discardId, ctx.userId, flagId);
  } catch (err) {
    if (err instanceof Error && err.message === 'Family not found') {
      // Concurrent resolution: another admin merged/deleted one of these
      // families between the flag read and the batch.
      return Response.json(
        { error: 'This flag was resolved by another admin — refresh the list' },
        { status: 409 }
      );
    }
    throw err;
  }

  return Response.json({ ok: true });
}

async function handleDismiss(
  env: Env,
  flagId: string,
  ctx: AuthContext
): Promise<Response> {
  const flag = await env.DB.prepare(
    `SELECT id FROM duplicate_flags WHERE id = ? AND status = 'pending'`
  ).bind(flagId).first<{ id: string }>();
  if (!flag) return Response.json({ error: 'Flag not found or already resolved' }, { status: 404 });

  await env.DB.prepare(`
    UPDATE duplicate_flags SET status = 'dismissed', reviewed_by = ?, reviewed_at = datetime('now')
    WHERE id = ?
  `).bind(ctx.userId, flagId).run();

  return Response.json({ ok: true });
}
