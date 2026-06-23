# ADR-024: Scopes — Fine-Grained Permission Strings

## Status
Accepted

## Date
2026-06-24

## Context
RBAC (ADR-023) answers authorization at role granularity. Many routes need finer intent:
"this route requires the ability to write a document," independent of which role grants
it. Scopes express that as `<resource>:<action>` permission strings checked at the route.

## Decision
Add a `Permission` enum (`src/common/enums/permission.enum.ts`, e.g. `document:read`,
`document:write`, `document:delete`, `document:read:any`) plus a `@RequirePermission(...)`
decorator and `PermissionsGuard` (`src/common/guards/`).

- **Guard contract**: `PermissionsGuard` reads the required permissions from route
  metadata and requires the user to hold **all** of them (logical AND). It is a pure
  scope check — it needs no resource instance, so it works on collection routes
  (create/list) where no `:id` exists.
- **Delegates to `AuthorizationService.hasPermission()`** — the same decision function
  used everywhere else, so guards and the service layer never diverge.
- **Source of truth is role-derived** (`ROLE_PERMISSIONS`, ADR-023). A user's scopes are
  the union of their roles' permissions; `super_admin` holds all.
- **Denial throws `ForbiddenException`** (not a bare `return false`) so
  `GlobalExceptionFilter` produces the standard JSON envelope with a message.

## Alternatives Considered

### Per-user scope grants in the DB
- Pros: assign a capability to one user without a role change
- Cons: a second grant axis overlapping ReBAC (per-user, per-object); extra table + merge
  + cache invalidation
- Rejected: role-derived only; per-object access is ReBAC's job (ADR-026)

### Reuse `RolesGuard` everywhere
- Pros: nothing new
- Cons: couples route intent to role names; "admin or moderator or …" lists leak the role
  hierarchy into every controller
- Rejected: scopes express intent without naming roles

## Consequences
- Routes declare capability, not roles: `@RequirePermission(Permission.DOCUMENT_WRITE)`.
- `document:read:any` is a cross-cutting scope (read any document regardless of
  relationship), granted to elevated roles — it lets the composed read decision
  short-circuit before ABAC/ReBAC for moderators/admins.
- Stacking `@RequirePermission` with `@RequireRelation`/`@Policy` on one route yields a
  logical-AND gate (all must pass).
