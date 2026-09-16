import type { Env } from './schema';
import { handleAuthRoutes } from './routes/auth';
import { handleFamilyRoutes } from './routes/families';
import { handleVisitRoutes } from './routes/visits';
import { handleQuestionRoutes } from './routes/questions';
import { handleAdminRoutes } from './routes/admin';
import { handleRecordRoutes } from './routes/records';
import { handleDuplicateRoutes } from './routes/duplicates';
import { handleClientEventRoutes, purgeOldClientEvents } from './routes/clientEvents';
import { rescanAllDuplicates } from './duplicates';
import { handleExportRoute } from './routes/export';

// Browser origins allowed to call this API. Auth is a Bearer header (no cookies),
// so this is abuse damping, not CSRF defense: a hostile page can fire no-cors POSTs
// that trigger SMS/D1 work even though it can't read the responses. Requests with a
// present-but-unlisted Origin are rejected before any handler runs; requests with no
// Origin header (curl, native fetch, server-side) pass through untouched.
// The workers.dev entry serves bookmarked tablets until the follow-up PR that flips
// workers_dev off removes it (and the alias) together.
const ALLOWED_ORIGINS = new Set([
  'https://foodboxdata.creightoncommunityfoundation.org',
  'https://foodbox-data-app.jeff-be7.workers.dev',
  'http://localhost:8787',
  'http://127.0.0.1:8787',
  'http://localhost:5173',
  // wrangler dev's local-upstream mapping can strip the port from the
  // browser's Origin header — accept the portless local forms too.
  'http://localhost',
  'http://127.0.0.1',
]);

// Pre-auth POST endpoints a hostile page could drive cross-origin.
function isOriginGatedPost(method: string, pathname: string): boolean {
  return method === 'POST' && (pathname.startsWith('/api/auth/') || pathname === '/api/client-events');
}

// Same-origin requests are always allowed regardless of the allowlist:
// browsers send Origin on ALL non-GET requests including same-origin ones,
// so a Workers Builds preview hostname would otherwise 403 its own login.
// Any host this worker itself serves is by definition not a hostile page.
function isAllowedOrigin(origin: string, url: URL): boolean {
  return origin === url.origin || ALLOWED_ORIGINS.has(origin);
}

export default {
  async fetch(request: Request, env: Env, execCtx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }), request);
    }

    if (isOriginGatedPost(request.method, url.pathname)) {
      const origin = request.headers.get('Origin');
      if (origin !== null && !isAllowedOrigin(origin, url)) {
        // Log before rejecting: rejected input must be visible in Workers Logs.
        console.warn('cross-origin rejected', origin, url.pathname);
        return cors(Response.json({ error: 'Origin not allowed' }, { status: 403 }), request);
      }
      // Auth POSTs must be JSON — an HTML form or no-cors text/plain POST can't be
      // the PWA, and rejecting here keeps form-based SMS-burn vectors out entirely.
      // client-events is exempt: sendBeacon sends text/plain by spec.
      const contentType = request.headers.get('Content-Type') ?? '';
      if (url.pathname.startsWith('/api/auth/') && !contentType.toLowerCase().includes('application/json')) {
        console.warn('non-json auth POST rejected', contentType, url.pathname);
        return cors(Response.json({ error: 'Content-Type must be application/json' }, { status: 415 }), request);
      }
    }

    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return cors(Response.json({ ok: true, env: env.ENVIRONMENT }), request);
      }

      const authResponse = await handleAuthRoutes(request, env, url.pathname);
      if (authResponse) return cors(authResponse, request);

      const familyResponse = await handleFamilyRoutes(request, env, url.pathname, execCtx);
      if (familyResponse) return cors(familyResponse, request);

      const visitResponse = await handleVisitRoutes(request, env, url.pathname);
      if (visitResponse) return cors(visitResponse, request);

      const questionResponse = await handleQuestionRoutes(request, env, url.pathname);
      if (questionResponse) return cors(questionResponse, request);

      // Checked before handleAdminRoutes: that handler gates its ENTIRE
      // '/api/admin/' prefix to the admin role, which would 403 a staff
      // caller before ever reaching this route's own admin-or-staff check.
      const exportResponse = await handleExportRoute(request, env, url.pathname);
      if (exportResponse) return cors(exportResponse, request);

      const adminResponse = await handleAdminRoutes(request, env, url.pathname);
      if (adminResponse) return cors(adminResponse, request);

      const duplicateResponse = await handleDuplicateRoutes(request, env, url.pathname);
      if (duplicateResponse) return cors(duplicateResponse, request);

      const recordResponse = await handleRecordRoutes(request, env, url.pathname, execCtx);
      if (recordResponse) return cors(recordResponse, request);

      const clientEventResponse = await handleClientEventRoutes(request, env, url.pathname);
      if (clientEventResponse) return cors(clientEventResponse, request);

      // Unknown /api/* routes return JSON 404
      if (url.pathname.startsWith('/api/')) {
        return cors(Response.json({ error: 'Not found' }, { status: 404 }), request);
      }

      // All other requests: serve the PWA static assets (SPA fallback to index.html)
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      return cors(Response.json({ error: 'Internal server error' }, { status: 500 }), request);
    }
  },

  async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    if (controller.cron === '0 6 * * SUN') {
      await rescanAllDuplicates(env.DB);
    } else {
      await purgeOldClientEvents(env.DB);
    }
  },
};

export function cors(response: Response, request: Request): Response {
  const origin = request.headers.get('Origin');
  // Non-browser callers send no Origin and need no CORS headers. Reflect
  // same-origin and allowlisted origins; anything else gets no CORS headers,
  // so its page can't read the response.
  if (origin === null || !isAllowedOrigin(origin, new URL(request.url))) return response;
  const h = new Headers(response.headers);
  h.set('Access-Control-Allow-Origin', origin);
  h.set('Vary', 'Origin');
  h.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
}
