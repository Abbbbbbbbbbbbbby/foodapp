// Domain-mode authorization assertion (OpenAuthJS docs client-integration.md
// Pattern 2). Pure function so it unit-tests without any network or Hono.

export class NotAuthorizedError extends Error {
  constructor(msg = 'Not authorized for the foodbox admin console') {
    super(msg);
    this.name = 'NotAuthorizedError';
  }
}

export interface UserProps {
  email?: string;
  authzBasis?: string;
  googleDomain?: string;
}

// Accept `domain` (CCF Workspace accounts — googleDomain must match) or
// `allowlist` (operator-granted exceptions on the issuer, any provider —
// issue #13 explicitly wants external collaborators grantable this way).
// Reject everything else, notably `group_membership`: a tampered
// ?authGroup= on the authorize URL must never widen access here.
export function assertDomainAccess(props: UserProps, authDomain: string): void {
  if (props.authzBasis === 'allowlist') return;
  if (props.authzBasis !== 'domain') throw new NotAuthorizedError();
  if (props.googleDomain !== authDomain) throw new NotAuthorizedError();
}
