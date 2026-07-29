import type { Env } from './schema';
import { handleAuthRoutes } from './routes/auth';
import { handleFamilyRoutes } from './routes/families';
import { handleVisitRoutes } from './routes/visits';
import { handleQuestionRoutes } from './routes/questions';
import { handleAdminRoutes } from './routes/admin';
import { handleRecordRoutes } from './routes/records';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return cors(new Response(null, { status: 204 }));
    }

    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return cors(Response.json({ ok: true, env: env.ENVIRONMENT }));
      }

      const authResponse = await handleAuthRoutes(request, env, url.pathname);
      if (authResponse) return cors(authResponse);

      const familyResponse = await handleFamilyRoutes(request, env, url.pathname);
      if (familyResponse) return cors(familyResponse);

      const visitResponse = await handleVisitRoutes(request, env, url.pathname);
      if (visitResponse) return cors(visitResponse);

      const questionResponse = await handleQuestionRoutes(request, env, url.pathname);
      if (questionResponse) return cors(questionResponse);

      const adminResponse = await handleAdminRoutes(request, env, url.pathname);
      if (adminResponse) return cors(adminResponse);

      const recordResponse = await handleRecordRoutes(request, env, url.pathname);
      if (recordResponse) return cors(recordResponse);

      // Unknown /api/* routes return JSON 404
      if (url.pathname.startsWith('/api/')) {
        return cors(Response.json({ error: 'Not found' }, { status: 404 }));
      }

      // All other requests: serve the PWA static assets (SPA fallback to index.html)
      return env.ASSETS.fetch(request);
    } catch (err) {
      console.error(err);
      return cors(Response.json({ error: 'Internal server error' }, { status: 500 }));
    }
  },
};

export function cors(response: Response): Response {
  const h = new Headers(response.headers);
  h.set('Access-Control-Allow-Origin', '*');
  h.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  h.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: h });
}
