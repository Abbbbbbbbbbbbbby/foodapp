// Boots the foodbox-admin worker for e2e AFTER the PWA server (which owns
// the local D1 migrations) is healthy. Two wrangler dev processes share the
// local D1 state; the admin worker only reads it. --inspector-port 9230 is
// required: both processes default to 9229 and the second dies with
// "Address already in use".
import { spawn } from 'node:child_process';

const PWA_HEALTH = 'http://127.0.0.1:8787/api/health';
const deadline = Date.now() + 110_000;

async function waitForPwa() {
  let lastError = 'no attempt made yet';
  for (;;) {
    try {
      const res = await fetch(PWA_HEALTH);
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err?.message ?? String(err);
    }
    if (Date.now() > deadline) {
      // Carry the last failure: ECONNREFUSED (never started) reads very
      // differently from a 500 (migrations failed).
      console.error(`e2e-admin-server: PWA server never became healthy at ${PWA_HEALTH} (last error: ${lastError})`);
      process.exit(1);
    }
    await new Promise(r => setTimeout(r, 500));
  }
}

await waitForPwa();

const child = spawn('npx', [
  'wrangler', 'dev', '--local-upstream', '127.0.0.1', '-c', 'wrangler.admin.jsonc',
  '--port', '8788', '--inspector-port', '9230',
  '--var', 'ENVIRONMENT:test',
  '--var', 'FOODBOX_ADMIN_SESSION_SECRET:e2e-admin-secret',
], { stdio: 'inherit' });

child.on('error', (err) => {
  console.error('e2e-admin-server: failed to spawn wrangler', err);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 1));
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => child.kill(sig));
}
