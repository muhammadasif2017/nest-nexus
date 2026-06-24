# ADR-026: ReBAC — Relationship Tuples (Zanzibar-lite)

## Status
Accepted

## Date
2026-06-24

## Context
RBAC/Scopes answer "what a kind of user can do"; ABAC answers "given these attributes."
Neither expresses "this specific user may edit this specific document because they own it
/ were shared it." That per-subject, per-object relationship is ReBAC — the model behind
Google Zanzibar.

## Decision
Store flat relationship **tuples** `(subjectType, subjectId, relation, objectType,
objectId)` in a `RelationTuple` table, with relation *implication* resolved in code.
`RelationService` (`src/modules/authorization/rebac/`) does tuple grant/revoke + `check()`,
exposed at the route via `@RequireRelation(...)` + `RelationGuard`.

- **Relations**: `owner | editor | viewer`. Implication is a code map
  (`owner ⇒ editor ⇒ viewer`), not stored tuples: a `check(viewer)` is satisfied by any
  of owner/editor/viewer. This keeps the table flat while still modelling access levels.
- **Flat tuples only** — no transitive group nesting, usersets, or computed relations
  (full Zanzibar). Those are an explicit non-goal for this showcase.
- **On create**, the document's creator is granted an `owner` tuple, so relation checks
  (and implication to editor/viewer) work immediately without a special-case for the owner.
- **`check()` translates the required relation into its set of grantor relations** and
  queries for any matching tuple — a single indexed lookup on
  `(objectType, objectId, relation)`.
- **Guard loads only the `:id`** (no resource row needed — tuples reference `objectId`).
  `super_admin` bypasses.
- **Relation checks are not cached** — `check()`/`objectIdsFor()` query the DB per request,
  so a grant/revoke takes effect immediately with no cache to invalidate (no
  `authz.relation.changed` event is emitted). Add one only if a relation cache is introduced.
- **Grant is idempotent** (`upsert`) — re-sharing the same relation is a no-op, not a
  conflict. **Revoke** of a non-existent tuple throws `NotFoundException`.
- **Document deletion cascades tuple cleanup** in the service (`deleteMany` on the
  document's tuples) — there is no FK from `RelationTuple` to `Document` because tuples are
  polymorphic over `objectType`.

## Alternatives Considered

### Owner column only (no tuple table)
- Pros: trivial; covers ownership
- Cons: can't express "shared as editor/viewer" to other users — the whole point of ReBAC
- Rejected: too weak to demonstrate the model

### Full Zanzibar (usersets, group nesting, computed relations)
- Pros: the real thing; handles org hierarchies
- Cons: recursive tuple resolution + a rewrite engine — a project on its own
- Rejected: out of scope; flat tuples + a code implication map convey the core idea

### A real external engine (OpenFGA / SpiceDB)
- Pros: production-grade ReBAC
- Cons: external service dependency; defeats the in-repo learning goal
- Rejected: same rationale as the ABAC engine decision (ADR-025)

## Consequences
- New `RelationTuple` table (migration `20260623192256_add_document_and_relation_tuple`),
  unique on the full tuple, indexed for forward (`object→subjects`) lookups.
- Object-level reads compose ReBAC with ABAC and Scopes in `AuthorizationService.can()`:
  read = `read:any` scope OR ABAC visibility OR `viewer` relation. Single-resource write/
  delete routes gate on `editor`/`owner` relations at the guard.
- Because both ABAC and ReBAC guards load by `:id`, a route using both can double-fetch —
  see ADR-025 consequences.
