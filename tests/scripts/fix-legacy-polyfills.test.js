import { describe, it, expect } from 'vitest';
import { fixLegacyPolyfills } from '../../scripts/fix-legacy-polyfills.mjs';

describe('fixLegacyPolyfills', () => {
  it('transforms an arrow function down to ES5', () => {
    const out = fixLegacyPolyfills('var e=(e,t)=>()=>t.exports;');
    expect(out).not.toContain('=>');
  });

  it('transforms a template literal down to ES5', () => {
    const out = fixLegacyPolyfills('var u=typeof x<`u`;');
    expect(out).not.toMatch(/`/);
  });

  it('leaves already-ES5 code functionally intact', () => {
    const out = fixLegacyPolyfills('function add(a,b){return a+b;}');
    expect(out).toContain('function add');
  });
});
