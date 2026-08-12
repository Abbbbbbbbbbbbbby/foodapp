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
    `SELECT id, role, active, phone FROM users WHERE id = ?`
  ).bind(id).first<{ id: string; role: string; active: number; phone: string }>();
  if (!user) return Response.json({ error: 'Not found' }, { status: 404 });

  // Block self-demotion and self-deactivation
  const wouldDemote = body.role !== undefined && body.role !== 'admin';
  const wouldDeactivate = body.active !== undefined && !body.active;
  if (id === ctx.userId && (wouldDemote || wouldDeactivate)) {
    return Response.json({ error: 'Cannot demote or deactivate your own account' }, { status: 400 });
  }

  // Block removing the last active admin (pre-check + atomic WHERE guard)
  const isRemovingAdmin = user.role === 'admin' && user.active === 1 && (wouldDemote || wouldDeactivate);
  if (isRemovingAdmin) {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?`
    ).bind(id).first<{ n: number }>();
    if ((row?.n ?? 0) === 0) {
      return Response.json({ error: 'Cannot remove the last admin' }, { status: 400 });
    }
  }

  const updates: string[] = [];
  const values: unknown[] = [];
  if (body.role !== undefined) { updates.push('role = ?'); values.push(body.role); }
  if (body.active !== undefined) { updates.push('active = ?'); values.push(body.active ? 1 : 0); }

  if (updates.length === 0) return Response.json({ ok: true });

  // When removing admin status, add a subquery to the WHERE clause so
  // concurrent requests that both pass the pre-check can't both succeed.
  const whereExtra = isRemovingAdmin
    ? ` AND (role != 'admin' OR active = 0 OR (SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1 AND id != ?) > 0)`
    : '';
  const bindArgs = isRemovingAdmin ? [...values, id, id] : [...values, id];
  const result = await env.DB.prepare(
    `UPDATE users SET ${updates.join(', ')} WHERE id = ?${whereExtra}`
  ).bind(...bindArgs).run();

  if (isRemovingAdmin && result.meta.rows_written === 0) {
    return Response.json({ error: 'Cannot remove the last admin' }, { status: 400 });
  }

  return Response.json({ ok: true });
}

// Last-admin protection for the delete-user batch. Every statement carries
// this predicate, so a guard rejection no-ops the WHOLE batch. Exported so
// the SQL-level race test asserts against this exact string, not a copy that
// could silently drift from the deployed SQL.
export const LAST_ADMIN_GUARD = `(SELECT role != 'admin' OR active = 0 OR (SELECT COUNT(*) FROM users WHERE role = 'admin' AND active = 1 AND id != ?1) > 0 FROM users WHERE id = ?1)`;

async function handleDeleteUser(
  env: Env,
  id: string,
  ctx: AuthContext
): Promise<Response> {
  if (id === ctx.userId) {
    return Response.json({ error: 'Cannot delete your own account' }, { status: 400 });
  }

  const user = await env.DB.prepare(
    `SELECT id, role, active, phone FROM users WHERE id = ?`
  ).bind(id).first<{ id: string; role: string; active: number; phone: string }>();
  if (!user) return Response.json({ error: 'Not found' }, { status: 404 });

  if (user.role === 'admin' && user.active === 1) {
    const row = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?`
    ).bind(id).first<{ n: number }>();
    if ((row?.n ?? 0) === 0) {
      return Response.json({ error: 'Cannot delete the last admin' }, { status: 400 });
    }
  }

  // One atomic batch. Every statement carries the SAME last-admin guard
  // predicate as the DELETE, so on a guard rejection the whole batch no-ops
  // (no orphaned reference-clears), while on success the clears run BEFORE
  // the DELETE so D1's foreign-key enforcement accepts it. The guard reads
  // only from users, which nothing here mutates before the DELETE, so the
  // predicate is stable across the batch.
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE families SET created_by = NULL WHERE created_by = ?1 AND ${LAST_ADMIN_GUARD}`).bind(id),
    env.DB.prepare(`UPDATE families SET updated_by = NULL WHERE updated_by = ?1 AND ${LAST_ADMIN_GUARD}`).bind(id),
    env.DB.prepare(`UPDATE visits SET volunteer_id = NULL WHERE volunteer_id = ?1 AND ${LAST_ADMIN_GUARD}`).bind(id),
    env.DB.prepare(`UPDATE visits SET updated_by = NULL WHERE updated_by = ?1 AND ${LAST_ADMIN_GUARD}`).bind(id),
    env.DB.prepare(`UPDATE duplicate_flags SET reviewed_by = NULL WHERE reviewed_by = ?1 AND ${LAST_ADMIN_GUARD}`).bind(id),
    env.DB.prepare(`DELETE FROM otp_codes WHERE phone = ?2 AND ${LAST_ADMIN_GUARD}`).bind(id, user.phone),
    env.DB.prepare(`DELETE FROM users WHERE id = ?1 AND ${LAST_ADMIN_GUARD}`).bind(id),
  ]);

  const deleteResult = results[results.length - 1];
  if (deleteResult.meta.rows_written === 0) {
    // Pre-checks passed but the guarded delete matched nothing. Two causes:
    // the concurrent last-admin race, or the user row was removed between
    // the pre-check and the batch (the guard's scalar subquery goes NULL and
    // the whole batch no-ops). Distinguish them so the admin isn't told
    // "last admin" about a user who is already gone.
    const stillThere = await env.DB.prepare(
      `SELECT 1 FROM users WHERE id = ?`
    ).bind(id).first();
    if (!stillThere) {
      return Response.json({ error: 'User was already deleted' }, { status: 404 });
    }
    return Response.json({ error: 'Cannot delete the last admin' }, { status: 400 });
  }

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

  // Primary dedup key: the stable Bubble source id — makes re-running the
  // same import a no-op for every row, phone or no phone (issue #6 item 3).
  const bubbleRows = await env.DB.prepare(
    `SELECT id, bubble_id FROM families WHERE bubble_id IS NOT NULL`
  ).all<{ id: string; bubble_id: string }>();
  const bubbleToId = new Map<string, string>(
    (bubbleRows.results ?? []).map(r => [r.bubble_id, r.id])
  );

  // For families with no phone, dedup by normalized name to prevent
  // re-importing the same phoneless family on subsequent CSV runs
  const noPhoneNameRows = await env.DB.prepare(
    `SELECT id, LOWER(name) AS n FROM families WHERE phone IS NULL`
  ).all<{ id: string; n: string }>();
  const noPhoneNameToId = new Map<string, string>(
    (noPhoneNameRows.results ?? []).map(r => [r.n, r.id])
  );

  const now = new Date().toISOString();
  let imported = 0;
  let visits_added = 0;
  let skipped_existing = 0;
  let skipped_no_name = 0;
  const errors: { name: string; error: string }[] = [];

  for (const row of rows) {
    if (!row.name?.trim()) { skipped_no_name++; continue; }

    const phone = normalizePhone(row.phone);

    // Existing-family resolution, strongest key first: Bubble source id,
    // then phone, then (phoneless rows only) normalized name. All three
    // paths merge new visits — a phoneless returning family must not have
    // its visit history dropped just because it deduped by name.
    const bubbleHit = row.bubble_id ? bubbleToId.get(row.bubble_id) : undefined;
    const familyId = bubbleHit
      ?? (phone ? phoneToId.get(phone) : undefined)
      ?? (!phone ? noPhoneNameToId.get(row.name.trim().toLowerCase()) : undefined);
    if (familyId) {
      if (row.visits?.length) {
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
      // Family matched by phone/name from a pre-bubble_id import: adopt the
      // row's bubble_id so future re-imports dedup on the primary key.
      if (row.bubble_id && !bubbleHit && !bubbleToId.has(row.bubble_id)) {
        try {
          await env.DB.prepare(
            `UPDATE families SET bubble_id = ? WHERE id = ? AND bubble_id IS NULL`
          ).bind(row.bubble_id, familyId).run();
          bubbleToId.set(row.bubble_id, familyId);
        } catch (e) {
          errors.push({ name: row.name, error: e instanceof Error ? e.message : 'Unknown error' });
        }
      }
      skipped_existing++;
      continue;
    }

    try {
      const id = crypto.randomUUID().replace(/-/g, '');

      const stmts: D1PreparedStatement[] = [
        env.DB.prepare(`
          INSERT INTO families (
            id, name, name_normalized, bubble_id, phone, address, zip_code, date_of_birth,
            language, ethnicity, hispanic, ami_bracket, num_people,
            num_children_under_18, num_children_under_5, num_with_diabetes,
            health_insurance, snap_benefits, receives_texts, want_text_updates,
            id_confirmed, bag_received, first_visit_date,
            created_by, created_at, updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?
          )
        `).bind(
          id, row.name.trim(), normalizeName(row.name.trim()),
          row.bubble_id ?? null,
          phone, row.address ?? null, row.zip_code ?? null, row.date_of_birth ?? null,
          row.language ?? null, row.ethnicity ?? null, row.hispanic ?? null, row.ami_bracket ?? null, row.num_people ?? null,
          row.num_children_under_18 ?? null, row.num_children_under_5 ?? null, row.num_with_diabetes ?? null,
          row.health_insurance ?? null, row.snap_benefits ?? null,
          row.receives_texts === true ? 1 : row.receives_texts === false ? 0 : null,
          row.want_text_updates === true ? 1 : row.want_text_updates === false ? 0 : null,
          row.id_confirmed === true ? 1 : row.id_confirmed === false ? 0 : null,
          row.bag_received === true ? 1 : row.bag_received === false ? 0 : null,
          row.first_visit_date ?? null,
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

      if (phone) phoneToId.set(phone, id);
      else noPhoneNameToId.set(row.name.trim().toLowerCase(), id);
      // A repeated bubble_id later in the SAME file merges into this family
      // instead of failing the unique index.
      if (row.bubble_id) bubbleToId.set(row.bubble_id, id);
      imported++;
    } catch (e) {
      errors.push({ name: row.name, error: e instanceof Error ? e.message : 'Unknown error' });
    }
  }

  return Response.json({ imported, visits_added, skipped_existing, skipped_no_name, errors });
}
