# ADR-029: Runtime Role Management + DB-Sourced Roles in JWT Validation

## Status
Accepted

## Date
2026-06-24

## Context
Roles drive the entire authorization stack (RBAC → Scopes → the object-level checks in
`AuthorizationService`, see ADR-023..026), but until now there was **no way to change a
user's roles through the application**:

- `register` always lands on the schema default `User.roles String[] @default(["user"])`.
- `UpdateUserInput` exposes only `displayName` and `avatarUrl` — `roles` is read-only output
  (`@Expose()` on `UserOutput`), never writable.
- The only path to grant an elevated role was a direct DB edit or a seed script.

A seed (`prisma/seed.ts`) bootstraps the first `super_admin`, which solves *bootstrap* but
not *ongoing management*. Two problems remained:

1. **No runtime role assignment.** Promoting/demoting a user required DB access or a redeploy.

2. **Role changes were invisible to live sessions.** ADR-023 deliberately keeps roles in the
   JWT and maps them to permissions per request. Its stated consequence: "A role change takes
   effect on the user's next token issuance (login/refresh)." For a *demotion* — the
   security-sensitive direction — waiting up to a full token lifetime for the old roles to
   drain is the same hazard ADR-013 rejected for account deactivation.

## Decision
Two coupled changes.

### 1. A `super_admin`-gated role-assignment endpoint
`PATCH /users/:id/roles` (`UsersController`), guarded `@Roles(Role.SUPER_ADMIN)`, body
validated by `SetRolesInput` (`@IsEnum(Role, { each: true })` + `@ArrayNotEmpty` +
`@ArrayUnique`). It replaces a user's role set wholesale via `UsersService.setRoles()`.

- **Roles stay off `UpdateUserInput`.** Keeping the field out of the self-update DTO is the
  control that prevents privilege escalation — `PATCH /users/me` physically cannot set roles.
  Role assignment is a separate, highest-privilege route.
- **Last-super_admin invariant.** `setRoles()` blocks (`ConflictException`) any change that
  would leave the system with zero `super_admin`s. No route can re-grant `super_admin`
  (only `super_admin` may call this endpoint), so demoting the last one is an irreversible
  lockout. This is the one rule a route guard cannot express — it requires a DB count.
- `setRoles()` emits `user.updated`, reusing the existing ADR-011 / ADR-013 event path.

### 2. `JwtStrategy` reads roles from the DB, not the token
`JwtStrategy.validate()` already cached `isActive` per user (30s TTL, invalidated on
`user.updated` / `user.deactivated` — ADR-013). We extend that same cache entry to carry
`roles`, and `validate()` now returns `{ ...payload, roles: <db roles> }` — the token's
`roles` claim is **ignored** in favour of the DB value.

Because `setRoles()` emits `user.updated`, the existing `@OnEvent` listener already clears the
cache, so a role change applies to already-issued tokens within the 30s window (or instantly
on the same instance after the event). No new event, no new infrastructure — the role-staleness
problem reduces to the deactivation-staleness problem ADR-013 already solved.

## Alternatives Considered

### Role staleness: short access-token TTL only
- Pros: zero code; relies on existing refresh rotation
- Cons: a demoted user keeps elevated access for up to the full token lifetime; weak for the
  security-sensitive direction
- Rejected: unacceptable window for demotions; the cache already exists to do better

### Role staleness: token-version / denylist invalidation
- Pros: strong, surgical per-token revocation
- Cons: new `tokenVersion` column or a Redis denylist + per-request check; a forced re-auth
  for the affected user
- Rejected: more machinery for the same outcome the existing `isActive` cache already
  delivers — extending that cache to roles is the smaller, consistent change

### Role staleness: drop roles from the JWT entirely, load every request
- Pros: never stale
- Cons: abandons JWT statelessness; a DB/cache hit on every request
- Rejected: the 30s-TTL cache gives freshness without a per-request lookup for active sessions

### Endpoint: allow roles on `UpdateUserInput` with a guard
- Pros: one DTO, one route
- Cons: a single missed guard on the self-update path becomes privilege escalation; mixing a
  self-service field with an admin-only field on one DTO is a footgun
- Rejected: separating the write path is the safer default — escalation is structurally
  impossible, not guard-dependent

## Consequences
- **Roles are now DB-sourced at request time, not trusted from the token.** The JWT `roles`
  claim is effectively advisory; `JwtStrategy` overrides it. This **revises ADR-023's last
  consequence**: a role change now takes effect within ~30s on existing tokens, not only on
  next token issuance. (ADR-023's reasoning for not embedding *permissions* still stands.)
- Same multi-pod caveat as ADR-013: `@OnEvent` invalidation is in-process; other pods rely on
  the 30s TTL. If sub-30s cross-pod role propagation is needed, extend
  `CacheInvalidationService` to broadcast `user.updated` over the existing Pub/Sub channel.
- `setRoles()` performs the last-super_admin count only when the new role set drops
  `super_admin` — the common promote/keep cases skip the extra read.
- The check-and-write runs in a **Serializable** transaction. Without it, two concurrent
  demotions of different `super_admin`s could each observe count > 1 and both commit,
  leaving zero — the exact lockout the invariant exists to prevent. Serializable isolation
  makes the read+write a single conflict-detected unit.
- The first `super_admin` must still come from outside the request path (seed / DB); the
  endpoint manages every role change after that.
