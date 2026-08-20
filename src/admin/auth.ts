import { createClient } from '@openauthjs/openauth/client';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context, MiddlewareHandler } from 'hono';
import type { AdminEnv } from './types';
import { subjects } from './subjects';
import { assertDomainAccess, type UserProps } from './authz';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, verifySession } from './session';

type Ctx = Context<{ Bindings: AdminEnv; Variables: { user: string } }>;

// The OpenAuth client is injectable so worker tests can exercise the real
// callback handler with a fake exchange/verify (no issuer stub exists in any
// CCF repo; the real round-trip is verified manually at first deploy).
export interface AuthClient {
  authorize(redirectUri: string, response: 'code'): Promise<{ url: string }>;
  exchange(code: string, redirectUri: string): Promise<{ err?: unknown; tokens?: { access: string } }>;
  verify(s: typeof subjects, access: string): Promise<{ err?: unknown; subject?: { properties: UserProps } }>;
}

export function realClient(env: AdminEnv): AuthClient {
  // No authGroup is ever appended: this is a DOMAIN-mode client.
  return createClient({ clientID: env.OPENAUTH_CLIENT_ID, issuer: env.OPENAUTH_ISSUER }) as unknown as AuthClient;
}

function redirectUri(c: Ctx): string {
  return new URL('/auth/callback', c.req.url).toString();
}

export async function startLogin(c: Ctx, client: AuthClient) {
  const { url } = await client.authorize(redirectUri(c), 'code');
  return c.redirect(url, 302);
}

export async function handleCallback(c: Ctx, client: AuthClient) {
  const code = c.req.query('code');
  if (!code) {
    console.warn('admin login denied', { reason: 'missing code' });
    return c.redirect('/denied', 302);
  }

  const exchanged = await client.exchange(code, redirectUri(c));
  if (exchanged.err || !exchanged.tokens) {
    console.warn('admin login denied', { reason: 'exchange failed' });
    return c.redirect('/denied', 302);
  }

  const verified = await client.verify(subjects, exchanged.tokens.access);
  if (verified.err || !verified.subject) {
    console.warn('admin login denied', { reason: 'verify failed' });
    return c.redirect('/denied', 302);
  }

  const props = verified.subject.properties;
  try {
    assertDomainAccess(props, c.env.AUTH_DOMAIN);
  } catch {
    // Log before redirecting: a locked-out CCF staffer must be diagnosable
    // from Workers Logs (event-handler-observability).
    console.warn('admin login denied', {
      email: props.email,
      authzBasis: props.authzBasis,
      googleDomain: props.googleDomain,
      reason: 'basis/domain assertion failed',
    });
    return c.redirect('/denied', 302);
  }

  const cookie = await signSession(props.email ?? '', c.env.FOODBOX_ADMIN_SESSION_SECRET);
  setCookie(c, SESSION_COOKIE, cookie, {
    httpOnly: true, secure: true, sameSite: 'Lax', path: '/', maxAge: SESSION_TTL_SECONDS,
  });
  return c.redirect('/', 302);
}

export function logout(c: Ctx) {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.redirect('/login', 302);
}

export function requireAuth(): MiddlewareHandler<{ Bindings: AdminEnv; Variables: { user: string } }> {
  return async (c, next) => {
    const cookie = getCookie(c, SESSION_COOKIE);
    const email = cookie ? await verifySession(cookie, c.env.FOODBOX_ADMIN_SESSION_SECRET) : null;
    if (!email) return c.redirect('/login', 302);
    c.set('user', email);
    return next();
  };
}
