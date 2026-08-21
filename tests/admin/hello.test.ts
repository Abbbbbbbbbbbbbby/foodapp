// C2.0 toolchain gate: proves vitest-pool-workers boots from
// wrangler.admin.jsonc (second config, custom_domain route) and compiles
// the hono/jsx entry.
import { exports as workerExports } from 'cloudflare:workers';
import { describe, it, expect } from 'vitest';

describe('foodbox-admin toolchain', () => {
  it('serves /healthz from the admin worker', async () => {
    const res = await workerExports.default.fetch('http://127.0.0.1/healthz');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });
});
