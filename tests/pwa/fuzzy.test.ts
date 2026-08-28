import { describe, it, expect } from 'vitest';
import { rankName, normalizeName } from '../../src/shared/fuzzy';

function norm(s: string) { return normalizeName(s); }

describe('rankName — short stored-token guard', () => {
  it('single-letter middle initial does not match unrelated query', () => {
    // "Jose A. Elizalde" — "a" token must not match query "sam"
    expect(rankName(norm('jose a elizalde'), norm('sam'), norm('sam'))).toBeNull();
  });

  it('single-letter token still matches itself exactly', () => {
    expect(rankName(norm('jose a elizalde'), norm('a'), norm('a'))).not.toBeNull();
  });

  it('"la" preposition does not fuzzy-match query "sam"', () => {
    expect(rankName(norm('anaberta de la cruz'), norm('sam'), norm('sam'))).toBeNull();
  });

  it('"de" preposition does not fuzzy-match query "sam"', () => {
    expect(rankName(norm('de la cruz'), norm('sam'), norm('sam'))).toBeNull();
  });

  it('"de la cruz" still found when query is "cruz"', () => {
    expect(rankName(norm('de la cruz'), norm('cruz'), norm('cruz'))).not.toBeNull();
  });
});

describe('rankName — normal fuzzy matching still works', () => {
  it('exact surname match — tier 1', () => {
    const r = rankName(norm('garcia maria'), norm('garcia'), norm('garcia'));
    expect(r).not.toBeNull();
    expect(r!.tier).toBe(1);
  });

  it('1-edit typo in surname — tier 2', () => {
    // "graica" → "garcia": 2 edits, within threshold for 6-char token
    const r = rankName(norm('garcia maria'), norm('graica'), norm('graica'));
    expect(r).not.toBeNull();
    expect(r!.tier).toBe(2);
  });

  it('accent-folded search finds accented name', () => {
    expect(rankName(norm('García'), norm('garcia'), norm('garcia'))).not.toBeNull();
  });

  it('no match when edit distance exceeds threshold', () => {
    expect(rankName(norm('smith'), norm('jones'), norm('jones'))).toBeNull();
  });
});
