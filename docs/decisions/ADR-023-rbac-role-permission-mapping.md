# ADR-023: RBAC — Role → Permission Mapping

## Status
Accepted

## Date
2026-06-24

## Context
The repo shipped authentication breadth (JWT, session, OAuth, 2FA, magic link, API key,
WebAuthn) but only the thinnest authorization: a `Role` enum, a `User.roles String[]`,
and a `RolesGuard` that checks "does the user hold one of these roles." That answers
"is this user an admin," not "may this user perform this action." Four authorization
models are being added (RBAC, ABAC, ReBAC, Scopes) — see ADR-024..026. This ADR covers
the RBAC layer and how roles expand into fine-grained permissions.

## Decision
Keep the existing `Role` enum and `RolesGuard` unchanged, and add a code-defined
`ROLE_PERMISSIONS` map (`src/modules/authorization/rbac/role-permissions.map.ts`) that
expands each role into a set of `Permission` strings. This map is the single bridge
between coarse RBAC (roles) and fine-grained Scopes (ADR-024).

- **Storage is hybrid**: role *assignments* stay in the DB (`User.roles`), permission
  *definitions* live in code (`Permission` enum + `ROLE_PERMISSIONS`). No new table —
  permissions aren't runtime-editable, so a migration buys nothing.
- **`super_admin` is special-cased**, not enumerated in the map. It short-circuits to
  ALLOW in `AuthorizationService` and never consults `ROLE_PERMISSIONS`. Its map entry is
  intentionally empty.
- **Permissions are role-derived only** — there is no per-user direct grant table.
  "What a kind of user can do" is RBAC's job; "what this user can do to this object" is
  ReBAC's (ADR-026). Adding per-user permission rows would blur that line.
- **Permissions are not embedded in the JWT.** The JWT already carries `roles`;
  `AuthorizationService.hasPermission()` maps roles → permissions per request. Embedding
  permissions would bloat the token and go stale on a role change until the next refresh
  — the same staleness hazard ADR-013 addresses for deactivation.

## Alternatives Considered

### Store role→permission mapping in the database
- Pros: editable without a deploy; supports an admin UI later
- Cons: a migration + join on every authz check, for data that changes at the speed of
  code; no consumer needs runtime editing
- Rejected: premature; revisit if/when roles become user-managed

### Embed resolved permissions in the JWT
- Pros: no per-request mapping
- Cons: token bloat; stale permissions after a role change until refresh
- Rejected: contradicts the deactivation-freshness stance in ADR-013

## Consequences
- `ROLE_PERMISSIONS` is the one place to edit when a role gains/loses a capability.
- `RolesGuard` (coarse, "is admin") and `PermissionsGuard` (fine, "has document:write")
  coexist; routes pick whichever expresses intent.
- A role change takes effect on the user's next token issuance (login/refresh), matching
  existing JWT semantics.
