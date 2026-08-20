// Hand-written env for the admin worker. Do NOT regenerate
// worker-configuration.d.ts from wrangler.admin.jsonc — that file belongs to
// the main worker's config.
export interface AdminEnv {
  DB: D1Database;
  ENVIRONMENT: string;
  AUTH_DOMAIN: string;
  OPENAUTH_ISSUER: string;
  OPENAUTH_CLIENT_ID: string;
  FOODBOX_ADMIN_SESSION_SECRET: string;
}
