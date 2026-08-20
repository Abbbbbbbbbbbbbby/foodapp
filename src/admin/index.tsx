import { Hono } from 'hono';
import type { AdminEnv } from './types';

const app = new Hono<{ Bindings: AdminEnv }>();

app.get('/healthz', (c) => c.text('ok'));
app.get('/', (c) => c.html(<p>foodbox-admin toolchain check</p>));

export default app;
