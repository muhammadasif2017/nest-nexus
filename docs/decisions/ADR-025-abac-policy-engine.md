# ADR-025: ABAC — Attribute-Based Policy Functions

## Status
Accepted

## Date
2026-06-24

## Context
Some decisions can't be expressed by roles or static scopes — they depend on *attributes*
of the resource, the subject, and the environment. Example: a document's `visibility`
(`private | internal | public`) determines who may read it, regardless of role. This is
ABAC.

## Decision
Implement ABAC as **hand-rolled TypeScript predicate functions** in a named registry
(`src/modules/authorization/abac/policies.ts`), resolved by name via a `@Policy('...')`
decorator + `PolicyGuard`.

- **No external rule engine** (OPA/Cedar/JSON-logic, no new dependency). The decision
  logic is a plain function — readable, debuggable, unit-testable. A rule engine is
  warranted only if policies become runtime-editable by non-developers, which is an
  explicit non-goal here (this is a learning-lab showcase).
- **`evaluatePolicy(name, ctx)` denies unknown policy names** (deny-by-default).
- **Resource-loading happens in the guard**: route guards run *before* the handler, so the
  resource isn't loaded yet. `PolicyGuard` reads the `:id` route param and loads the
  document's attributes itself (one query) to evaluate the predicate. This restricts the
  guard to single-resource routes (those with `:id`).
- **Collection routes (create/list) have no `:id`** → their attribute checks happen in
  the service layer via `AuthorizationService.can()`, which composes ABAC with RBAC and
  ReBAC. This is the "both layers" design: guards for single-resource routes, the service
  for per-row/collection decisions.
- **`super_admin` bypasses** before any resource load.

## Alternatives Considered

### A policy-evaluation library (OPA/Cedar/json-logic-js)
- Pros: declarative, runtime-editable, battle-tested
- Cons: a new dependency + a DSL to learn; hides the decision behind a parser, which works
  against the learning-lab goal of *seeing* the model
- Rejected: predicate functions are clearer here; revisit if rules must be data-driven

### Evaluate ABAC only in the service layer (no guard)
- Pros: one place, resource already loaded
- Cons: loses the declarative `@Policy()` route annotation; every route must remember to
  call the check
- Rejected: the guard keeps single-resource routes declarative; the service covers the
  rest

## Consequences
- ABAC and ReBAC each load the resource by `:id` in their guard — a single-resource route
  using both guards can fetch the row twice. Accepted as a known cost for the demo; not
  optimized (no request-scoped caching) unless a real need appears.
- `document.read` is the shipped policy: `public` → anyone, `internal` → any authenticated
  user, `private` → owner only. New attribute rules are added as named entries in the
  registry.
