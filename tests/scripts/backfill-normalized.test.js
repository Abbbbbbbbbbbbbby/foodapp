import { describe, it, expect } from 'vitest';
import { normalizeName as scriptNormalize } from '../../scripts/backfill-normalized.mjs';
import { normalizeName as workerNormalize } from '../../src/worker/db';

// The backfill script carries its own copy of normalizeName (it runs under
// plain node, outside the worker bundle). If the copies diverge, the backfill
// writes values the worker's search can never match — silently defeating the
// entire point of the script.
describe('backfill-normalized normalizeName parity', () => {
  const samples = [
    'José María',
    'Nguyễn Văn',
    'MARTÍNEZ-LÓPEZ',
    "O'Brien",
    'plain name',
    'Ẽ̃mixed  Ç',
  ];

  it('matches the worker normalization character-for-character', () => {
    for (const s of samples) {
      expect(scriptNormalize(s)).toBe(workerNormalize(s));
    }
  });
});
