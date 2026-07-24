import type { Env } from '../schema';
import { requireRole } from '../middleware';
import type { AuthContext } from '../middleware';

interface AdminUser {
  id: string;
  name: string;
  phone: string;
  role: 'admin' | 'staff' | 'volunteer';
  active: number;
  self_registered: number;
  created_at: string;
  last_family_name: string | null;
  last_family_at: string | null;
  last_visit_date: string | null;
}

export async function handleAdminRoutes(
  request: Request,
  env: Env,
  pathname: string
): Promise<Response | null> {
  if (!pathname.startsWith('/api/admin/')) return null;

  const ctxOrResponse = await requireRole('admin')(request, env);
  if (ctxOrResponse instanceof Response) return ctxOrResponse;
  const ctx = ctxOrResponse as AuthContext;

  if (pathname === '/api/admin/users' && request.method === 'GET') {
    return handleListUsers(env);
  }

  const idMatch = pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (idMatch) {
    if (request.method === 'PATCH') return handleUpdateUser(request, env, idMatch[1], ctx);
    if (request.method === 'DELETE') return handleDeleteUser(env, idMatch[1], ctx);
  }

  return null;
}

async function handleListUsers(env: Env): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT
      u.id, u.name, u.phone, u.role, u.active, u.self_registered, u.created_at,
      (SELECT f.name FROM families f WHERE f.created_by = u.id ORDER BY f.created_at DESC LIMIT 1) AS last_family_name,
      (SELECT f.created_at FROM families f WHERE f.created_by = u.id ORDER BY f.created_at DESC LIMIT 1) AS last_family_at,
      (SELECT v.visit_date FROM visits v WHERE v.volunteer_id = u.id ORDER BY v.created_at DESC LIMIT 1) AS last_visit_date
    FROM users u
    ORDER BY u.created_at DESC
  `).all<AdminUser>();

  const users = (result.results ?? []).map(u => ({
    ...u,
    active: u.active === 1 || (u.active as unknown) === true,
    self_registered: u.self_registered === 1 || (u.self_registered as unknown) === true,
  }));

  return Response.json({ users });
}

async function handleUpdateUser(
  request: Request,
  env: Env,
  id: string,
  ctx: AuthContext
): Promise<Response> {
  let body: { role?: string; active?: boolean };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const validRoles = new Set(['admin', 'staff', 'volunteer']);
  if (body.role !== undefined && !validRoles.has(body.role)) {
    return Response.json({ error: `invalid role: ${body.role}` }, { status: 400 });
  }

  const user = await env.DB.prepare(
    `SELECT id, role FROM users WHERE id = ?`
  ).bind(id).first<{ id: string; role: string }>();
  if (!user) return Response.json({ error: 'Not found' }, { status: 404 });

  const updates: string[] = [];
  const values: unknown[] = [];
  if (body.role !== undefined) { updates.push('role = ?'); values.push(body.role); }
  if (body.active !== undefined) { updates.push('active = ?'); values.push(body.active ? 1 : 0); }

  if (updates.length === 0) return Response.json({ ok: true });

  await env.DB.prepare(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values, id).run();

  return Response.json({ ok: true });
}

async function handleDeleteUser(
  env: Env,
  id: string,
  ctx: AuthContext
): Promise<Response> {
  if (id === ctx.userId) {
    return Response.json({ error: 'Cannot delete your own account' }, { status: 400 });
  }

  const user = await env.DB.prepare(
    `SELECT id FROM users WHERE id = ?`
  ).bind(id).first<{ id: string }>();
  if (!user) return Response.json({ error: 'Not found' }, { status: 404 });

  // Null out FK references before deleting so the delete doesn't violate
  // constraints if foreign_keys pragma is on
  await env.DB.prepare(`UPDATE families SET created_by = NULL WHERE created_by = ?`).bind(id).run();
  await env.DB.prepare(`UPDATE visits SET volunteer_id = NULL WHERE volunteer_id = ?`).bind(id).run();
  await env.DB.prepare(`DELETE FROM otp_codes WHERE phone = (SELECT phone FROM users WHERE id = ?)`).bind(id).run();
  await env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(id).run();

  return Response.json({ ok: true });
}
