import type { Env } from '../schema';
import { requireRole } from '../middleware';
import type { AuthContext } from '../middleware';
import { normalizeName, normalizePhone } from '../db';

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

  if (pathname === '/api/admin/import' && request.method === 'POST') {
    return handleImport(request, env, ctx);
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

// ── Bubble import ─────────────────────────────────────────────────────────────

interface ImportFamily {
  bubble_id: string;
  name: string;
  phone: string | null;
  address: string | null;
  zip_code: string | null;
  date_of_birth: string | null;
  language: string | null;
  ethnicity: string | null;
  hispanic: string | null;
  health_insurance: string | null;
  snap_benefits: string | null;
  receives_texts: boolean | null;
  want_text_updates: boolean | null;
  id_confirmed: boolean | null;
  bag_received: boolean | null;
  num_people: number | null;
  num_children_under_18: number | null;
  num_children_under_5: number | null;
  num_with_diabetes: number | null;
  ami_bracket: string | null;
  first_visit_date: string | null;
  visits: string[];
  proxies: { name: string; phone: string | null }[];
}

async function handleImport(
  request: Request,
  env: Env,
  ctx: AuthContext
): Promise<Response> {
  let body: { families: ImportFamily[] };
  try {
    body = await request.json() as typeof body;
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const rows = body.families;
  if (!Array.isArray(rows) || rows.length === 0) {
    return Response.json({ error: 'No families provided' }, { status: 400 });
  }

  // Load all existing phone→id mappings once for dedup and visit-merging
  const existingFamilyRows = await env.DB.prepare(
    `SELECT id, phone FROM families WHERE phone IS NOT NULL`
  ).all<{ id: string; phone: string }>();
  const phoneToId = new Map<string, string>(
    (existingFamilyRows.results ?? []).map(r => [r.phone, r.id])
  );
  const existingPhones = new Set(phoneToId.keys());

  const now = new Date().toISOString();
  let imported = 0;
  let visits_added = 0;
  let skipped = 0;
  const errors: { name: string; error: string }[] = [];

  for (const row of rows) {
    if (!row.name?.trim()) { skipped++; continue; }

    const phone = normalizePhone(row.phone);

    if (phone && existingPhones.has(phone)) {
      // Family exists — add any new visits rather than skipping
      const familyId = phoneToId.get(phone);
      if (familyId && row.visits?.length) {
        try {
          const existing = await env.DB.prepare(
            `SELECT visit_date FROM visits WHERE family_id = ?`
          ).bind(familyId).all<{ visit_date: string }>();
          const existingDates = new Set((existing.results ?? []).map(r => r.visit_date));

          const visitStmts: D1PreparedStatement[] = [];
          for (const visitDate of row.visits) {
            if (!visitDate || existingDates.has(visitDate)) continue;
            const vid = crypto.randomUUID().replace(/-/g, '');
            visitStmts.push(
              env.DB.prepare(
                `INSERT INTO visits (id, family_id, visit_date, volunteer_id, created_at) VALUES (?, ?, ?, ?, ?)`
              ).bind(vid, familyId, visitDate, ctx.userId, now)
            );
          }
          if (visitStmts.length) {
            await env.DB.batch(visitStmts);
            visits_added += visitStmts.length;
          }
        } catch (e) {
          errors.push({ name: row.name, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
      skipped++;
      continue;
    }

    try {
      const id = crypto.randomUUID().replace(/-/g, '');

      const stmts: D1PreparedStatement[] = [
        env.DB.prepare(`
          INSERT INTO families (
            id, name, phone, address, zip_code, date_of_birth,
            language, ethnicity, hispanic, ami_bracket, num_people,
            num_children_under_18, num_children_under_5, num_with_diabetes,
            health_insurance, snap_benefits, receives_texts, want_text_updates,
            id_confirmed, bag_received, first_visit_date,
            created_by, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?
          )
        `).bind(
          id, row.name.trim(),
          phone, row.address, row.zip_code, row.date_of_birth,
          row.language, row.ethnicity, row.hispanic, row.ami_bracket, row.num_people,
          row.num_children_under_18, row.num_children_under_5, row.num_with_diabetes,
          row.health_insurance, row.snap_benefits,
          row.receives_texts === true ? 1 : row.receives_texts === false ? 0 : null,
          row.want_text_updates === true ? 1 : row.want_text_updates === false ? 0 : null,
          row.id_confirmed === true ? 1 : row.id_confirmed === false ? 0 : null,
          row.bag_received === true ? 1 : row.bag_received === false ? 0 : null,
          row.first_visit_date,
          ctx.userId, now, now
        ),
      ];

      for (const visitDate of (row.visits ?? [])) {
        if (!visitDate) continue;
        const vid = crypto.randomUUID().replace(/-/g, '');
        stmts.push(
          env.DB.prepare(
            `INSERT INTO visits (id, family_id, visit_date, volunteer_id, created_at) VALUES (?, ?, ?, ?, ?)`
          ).bind(vid, id, visitDate, ctx.userId, now)
        );
      }

      for (const proxy of (row.proxies ?? [])) {
        if (!proxy.name && !proxy.phone) continue;
        const pid = crypto.randomUUID().replace(/-/g, '');
        stmts.push(
          env.DB.prepare(
            `INSERT INTO proxies (id, family_id, proxy_name, proxy_phone, created_at) VALUES (?, ?, ?, ?, ?)`
          ).bind(pid, id, proxy.name || null, normalizePhone(proxy.phone), now)
        );
      }

      await env.DB.batch(stmts);

      if (phone) existingPhones.add(phone);
      imported++;
    } catch (e) {
      errors.push({ name: row.name, error: e instanceof Error ? e.message : 'Unknown error' });
    }
  }

  return Response.json({ imported, visits_added, skipped, errors });
}
