import { createClient, type Client } from '@openauthjs/openauth/client';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context, MiddlewareHandler } from 'hono';
import type { AdminEnv } from './types';
import { subjects } from './subjects';
import { assertDomainAccess, type UserProps } from './authz';
import {
  SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, verifySession,
  signCompact, verifyCompact,
} from './session';

type Ctx = Context<{ Bindings: AdminEnv; Variables: { user: string } }>;

// PKCE + state challenge, held in a short-lived signed cookie so the callback
// is bound to the browser that started the flow (RFC 9700 §4.7.1 — without it
// an attacker can complete login-CSRF by handing a victim their own code).
const OAUTH_COOKIE = 'admin_oauth';
const OAUTH_TTL_SECONDS = 600;
interface OauthChallenge { s: string; v?: string }

// The OpenAuth client is injectable so worker tests can exercise the real
// callback handler with a fake exchange/verify (no issuer stub exists in any
// CCF repo; the real round-trip is verified manually at first deploy).
export interface AuthClient {
  authorize(redirectUri: string, response: 'code', opts?: { pkce?: boolean }): Promise<{
    url: string;
    challenge: { state: string; verifier?: string };
  }>;
  exchange(code: string, redirectUri: string, verifier?: string): Promise<{ err?: unknown; tokens?: { access: string } }>;
  verify(s: typeof subjects, access: string): Promise<{ err?: unknown; subject?: { properties: UserProps } }>;
}

// Compile-time drift guard: if the real OpenAuth Client stops being
// structurally assignable to the subset AuthClient models, THIS fails to
// typecheck — the signal that the interface diverged from the dependency
// (authoritative-source-for-platform-capability). Kept as a type-level check
// so no runtime cost.
const _clientConforms: (c: Client) => AuthClient = (c) => c;
void _clientConforms;

export function realClient(env: AdminEnv): AuthClient {
  // No authGroup is ever appended: this is a DOMAIN-mode client.
  return createClient({ clientID: env.OPENAUTH_CLIENT_ID, issuer: env.OPENAUTH_ISSUER });
}

function redirectUri(c: Ctx): string {
  return new URL('/auth/callback', c.req.url).toString();
}

export async function startLogin(c: Ctx, client: AuthClient) {
  const { url, challenge } = await client.authorize(redirectUri(c), 'code', { pkce: true });
  const cookie = await signCompact<OauthChallenge>(
    { s: challenge.state, v: challenge.verifier },
    c.env.FOODBOX_ADMIN_SESSION_SECRET,
    OAUTH_TTL_SECONDS
  );
  setCookie(c, OAUTH_COOKIE, cookie, {
    httpOnly: true, secure: true, sameSite: 'Lax', path: '/auth', maxAge: OAUTH_TTL_SECONDS,
  });
  return c.redirect(url, 302);
}

export async function handleCallback(c: Ctx, client: AuthClient) {
  const code = c.req.query('code');
  const state = c.req.query('state');

  // Read + clear the one-time challenge cookie up front, before any early
  // return, so it never survives a failed attempt.
  const challengeCookie = getCookie(c, OAUTH_COOKIE);
  const challenge = challengeCookie
    ? await verifyCompact<OauthChallenge>(challengeCookie, c.env.FOODBOX_ADMIN_SESSION_SECRET)
    : null;
  deleteCookie(c, OAUTH_COOKIE, { path: '/auth' });

  if (!code) {
    console.warn('admin login denied', { reason: 'missing code' });
    return c.redirect('/denied', 302);
  }

  // State binding: the challenge cookie must exist, verify, and match the
  // issuer-echoed state. Every denial logs — a locked-out staffer must be
  // diagnosable from Workers Logs (event-handler-observability).
  if (!challenge || !state || challenge.s !== state) {
    console.warn('admin login denied', {
      reason: 'state mismatch or missing/expired challenge cookie',
      hadCookie: !!challengeCookie, hadState: !!state,
    });
    return c.redirect('/denied', 302);
  }

  const exchanged = await client.exchange(code, redirectUri(c), challenge.v);
  if (exchanged.err || !exchanged.tokens) {
    console.warn('admin login denied', { reason: 'exchange failed', err: String(exchanged.err) });
    return c.redirect('/denied', 302);
  }

  const verified = await client.verify(subjects, exchanged.tokens.access);
  if (verified.err || !verified.subject) {
    console.warn('admin login denied', { reason: 'verify failed', err: String(verified.err) });
    return c.redirect('/denied', 302);
  }

  const props = verified.subject.properties;
  // The allowlist basis never checks email, and an empty email would mint a
  // session that verifies to '' — an unlogged infinite login loop. Deny loudly.
  if (!props.email) {
    console.warn('admin login denied', { reason: 'no email in subject', authzBasis: props.authzBasis });
    return c.redirect('/denied', 302);
  }
  try {
    assertDomainAccess(props, c.env.AUTH_DOMAIN);
  } catch {
    console.warn('admin login denied', {
      email: props.email,
      authzBasis: props.authzBasis,
      googleDomain: props.googleDomain,
      reason: 'basis/domain assertion failed',
    });
    return c.redirect('/denied', 302);
  }

  const cookie = await signSession(props.email, c.env.FOODBOX_ADMIN_SESSION_SECRET);
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
    if (!email) {
      // A present-but-invalid cookie is signal (tampering, secret rotation,
      // or expiry en masse); a missing cookie is routine.
      if (cookie) console.warn('admin session rejected', { hadCookie: true });
      return c.redirect('/login', 302);
    }
    c.set('user', email);
    return next();
  };
}
