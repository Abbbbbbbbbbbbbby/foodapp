import { createSubjects } from '@openauthjs/openauth/subject';
import { object, string, optional, array } from 'valibot';

// MUST match the CCF OpenAuthJS issuer subject schema (OpenAuthJS/src/subjects.ts).
// googleGroups is mandatory here even though this client is domain-mode:
// verification fails on any group-stamped token if the field is missing.
export const subjects = createSubjects({
  user: object({
    id: string(),
    authMethod: string(),
    email: string(),
    authzBasis: string(),
    githubLogin: optional(string()),
    googleDomain: optional(string()),
    googleGroups: optional(array(string())),
  }),
});
