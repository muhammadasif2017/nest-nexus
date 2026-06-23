import { AuthSubject } from '../authorization.service';

// Attribute-based access: decisions computed from attributes of the subject
// (user), the resource (document), and the environment. Hand-rolled predicate
// functions — no external rule engine — so the decision logic stays readable.

// The resource attributes ABAC reasons over for a document.
export interface DocumentAttrs {
  ownerId: string;
  visibility: string; // private | internal | public
}

export interface PolicyContext {
  user: AuthSubject;
  resource: DocumentAttrs;
  env?: { now?: Date };
}

export type Policy = (ctx: PolicyContext) => boolean;

// Named policy registry, keyed by `<resource>.<action>`. PolicyGuard resolves a
// policy by name from the @Policy() decorator; can() consults it for read.
export const POLICIES: Record<string, Policy> = {
  // Read visibility rule:
  //  - public   → anyone
  //  - internal → any authenticated user
  //  - private  → owner only
  'document.read': ({ user, resource }) => {
    if (resource.visibility === 'public') return true;
    if (resource.visibility === 'internal') return true;
    return resource.ownerId === user.sub;
  },
};

// Evaluate a named policy. Unknown policy name → deny (deny-by-default).
export function evaluatePolicy(name: string, ctx: PolicyContext): boolean {
  const policy = POLICIES[name];
  if (!policy) return false;
  return policy(ctx);
}
