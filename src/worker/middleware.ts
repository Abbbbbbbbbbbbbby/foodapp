import type { Env, UserRole } from './schema';
import { verifyJwt, getSession } from './auth';
import type { SessionPayload } from './auth';

export type AuthContext = Pick<SessionPayload, 'userId' | 'phone' | 'role' | 'sessionId'>;

export async function getAuthContext(
  request: Request,
  env: Env
): Promise<AuthContext | null> {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7);
  const payload = await verifyJwt(token, env.JWT_SECRET);
  if (!payload) return null;
  const session = await getSession(env.SESSIONS, payload.sessionId);
  if (!session) return null;
  // Re-check active on every request: deactivation must end access
  // immediately, not up to 12h later when the session expires (issue #6).
  const live = await env.DB.prepare(
    `SELECT active FROM users WHERE id = ?`
  ).bind(session.userId).first<{ active: number }>();
  if (!live || live.active !== 1) return null;
  return {
    userId: session.userId,
    phone: session.phone,
    role: session.role,
    sessionId: session.sessionId,
  };
}

export function requireRole(...roles: UserRole[]) {
  if (roles.length === 0) throw new Error('requireRole: at least one role is required');
  return async (
    request: Request,
    env: Env
  ): Promise<AuthContext | Response> => {
    const ctx = await getAuthContext(request, env);
    if (!ctx) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!roles.includes(ctx.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    return ctx;
  };
}
