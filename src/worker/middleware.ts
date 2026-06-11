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
  return {
    userId: session.userId,
    phone: session.phone,
    role: session.role,
    sessionId: session.sessionId,
  };
}

export function requireRole(...roles: UserRole[]) {
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
