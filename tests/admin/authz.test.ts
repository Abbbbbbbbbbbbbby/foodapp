// Pure domain-mode assertion tests (mirrors grantsdatabase/test/auth.test.ts).
import { describe, it, expect } from 'vitest';
import { assertDomainAccess, NotAuthorizedError } from '../../src/admin/authz';

const DOMAIN = 'creightoncommunityfoundation.org';

describe('assertDomainAccess', () => {
  it('accepts a domain-basis subject with the matching googleDomain', () => {
    expect(() => assertDomainAccess({ authzBasis: 'domain', googleDomain: DOMAIN }, DOMAIN)).not.toThrow();
  });

  it('accepts an allowlist-basis subject (operator-granted exception, any provider)', () => {
    expect(() => assertDomainAccess({ authzBasis: 'allowlist' }, DOMAIN)).not.toThrow();
  });

  it('rejects group_membership basis (tampered ?authGroup= upgrade attack)', () => {
    expect(() => assertDomainAccess(
      { authzBasis: 'group_membership', googleDomain: DOMAIN }, DOMAIN
    )).toThrow(NotAuthorizedError);
  });

  it('rejects a domain-basis subject from the wrong Workspace domain', () => {
    expect(() => assertDomainAccess(
      { authzBasis: 'domain', googleDomain: 'evil.example' }, DOMAIN
    )).toThrow(NotAuthorizedError);
  });

  it('rejects a missing basis', () => {
    expect(() => assertDomainAccess({ googleDomain: DOMAIN }, DOMAIN)).toThrow(NotAuthorizedError);
  });

  it('rejects domain basis with missing googleDomain', () => {
    expect(() => assertDomainAccess({ authzBasis: 'domain' }, DOMAIN)).toThrow(NotAuthorizedError);
  });
});
