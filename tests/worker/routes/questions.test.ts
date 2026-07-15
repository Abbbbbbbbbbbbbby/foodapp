import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('GET /api/questions', () => {
  it('returns questions array (no auth required)', async () => {
    const res = await SELF.fetch('http://example.com/api/questions');
    expect(res.status).toBe(200);
    const data = await res.json<{ questions: unknown[] }>();
    expect(Array.isArray(data.questions)).toBe(true);
  });
});
