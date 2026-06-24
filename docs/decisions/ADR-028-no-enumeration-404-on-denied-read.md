# ADR-028: Denied Reads Return 404, Not 403 (No-Enumeration)

## Status
Accepted

## Date
2026-06-24

## Context
A single-resource read can be denied for two different reasons: the resource does not
exist, or it exists but the caller is not allowed to read it. The naive mapping returns
`404` for the first and `403` for the second. That difference is an oracle: a caller who
sees `403` learns the id is real, and can enumerate which ids exist (and often infer
ownership/visibility) without ever being able to read a single one.

This matters for the `document` model, where `private` documents are readable only by the
owner or an explicitly granted ReBAC viewer. A `403` on every private id the attacker
guesses correctly leaks the id space.

## Decision
A **denied read is reported identically to a missing resource — `404 Not Found`**. The
caller cannot distinguish "does not exist" from "exists but forbidden to you".

Applies at both read entry points:
- `PolicyGuard` (single-resource `@Policy('document.read')` routes): a missing row *or* a
  failed policy evaluation both throw `NotFoundException`.
- `DocumentService.findOne()`: when `AuthorizationService.can()` denies, throw
  `NotFoundException` (not `ForbiddenException`).

Scope of the rule:
- **Reads only.** Write/delete/share keep `403 Forbidden`. Those routes are reached only
  after a ReBAC relation guard (editor/owner) has already confirmed a relationship to the
  resource, so the existence of the id is not a secret to that caller — a clear `403` is
  more honest and more debuggable there.
- **List** (`findAll`) sidesteps the question entirely: it returns only the readable
  subset, so non-readable rows are simply absent — never surfaced as an error.

## Alternatives Considered

### 403 on denied, 404 on missing (the naive mapping)
- Pros: precise, easiest to debug
- Rejected: the status-code difference is the enumeration oracle this ADR exists to close.

### 404 everywhere, including writes
- Pros: uniform
- Rejected: write/delete/share already passed a relation guard, so the caller demonstrably
  knows the resource — hiding it as `404` only obscures real authorization failures with
  no confidentiality gain.

## Consequences
- A legitimate owner who mistypes an id and a stranger probing a real id get the same
  `404` — intended.
- Error copy for denied reads must not betray the real reason (no "you lack permission"
  message on the `404`).
- Tests assert `NotFoundException` (not `ForbiddenException`) for denied private reads —
  see `policy.guard.spec.ts` and `document.service.spec.ts`.
