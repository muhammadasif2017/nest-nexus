# CLAUDE.md — Project Conventions for nest-nexus

## What this project is

Production-ready NestJS boilerplate with PostgreSQL + Prisma, a versioned REST API,
JWT auth, BullMQ queues, Redis cache, health probes, and structured logging.
See `Readme.md` for architecture overview. See `docs/decisions/` for ADRs.

## Module structure (follow existing pattern)

Every feature module lives in `src/modules/<domain>/` and contains:

```
<domain>/
├── dto/            Input DTOs (class-validator) + Output DTOs (@Expose)
├── <domain>.service.ts
├── <domain>.controller.ts  REST — CRUD on domain entities
└── <domain>.module.ts
```

`PrismaService` is globally available — do not import `PrismaModule` in feature modules,
just inject `PrismaService` in your service constructor. Add new models to
`prisma/schema.prisma` and run `npx prisma migrate dev` to generate the migration.

Register every new module in `src/app.module.ts`.

## Guard pattern

Guards resolve the request via `getRequestFromContext()` (`src/common/utils/`), which
reads `req` from the HTTP execution context. See `src/common/guards/` for the
established pattern.

## Serialization — use @Expose(), not manual picks

Never hand-pick fields to return from a service. Define an output DTO with
`@Expose()` on allowed fields and `@Exclude()` as the class default.
`SerializeInterceptor` handles the transformation globally.
Fields without `@Expose()` are stripped automatically — this is how sensitive
fields (password) stay out of responses. Refresh tokens live in a separate
`RefreshToken` table and are never attached to user response objects.

## Exception filter

`GlobalExceptionFilter` handles REST errors — it sets the HTTP status and returns a
consistent JSON envelope (`statusCode`, `errorCode`, `message`, `path`, `timestamp`).
Do not throw raw errors from controllers — throw NestJS built-in exceptions
(`UnauthorizedException`, `NotFoundException`, etc.) and let the filter handle them.

## Cache invalidation — always event-driven

After any mutation in a service, emit a domain event via `EventEmitter2`:
```typescript
this.eventEmitter.emit('user.updated', { userId });
```
`CacheInvalidationService` listens and deletes stale keys locally + via Redis
Pub/Sub (cross-instance). Do not call `cacheService.del()` directly from
feature services — emit the event instead.

When **deactivating** a user, emit `user.deactivated` (not just `user.updated`).
`JwtStrategy` maintains an in-process cache of user active-status
and listens specifically for `user.deactivated` to invalidate immediately. Without
this event, a deactivated user can continue making authenticated requests for up
to 30 seconds. See ADR-013.

## Roles — assignment and freshness

Roles (`User.roles String[]`) are writable **only** via `PATCH /users/:id/roles`
(`@Roles(Role.SUPER_ADMIN)`, body `SetRolesInput`). Never add `roles` to
`UpdateUserInput` or any self-service DTO — keeping it off the self-update path is
what makes privilege escalation structurally impossible. `register` always lands on
the schema default `["user"]`; the first `super_admin` comes from `prisma/seed.ts`.
`UsersService.setRoles()` blocks demoting the **last** `super_admin`
(`ConflictException`) — that would be an irreversible lockout.

`JwtStrategy.validate()` sources `roles` from the DB (its `isActive` cache extended
to carry roles), so the token's `roles` claim is overridden per request — a role
change applies to live tokens within ~30s without a refresh. `setRoles()` emits
`user.updated` to clear that cache. See ADR-029.

## Authorization — four techniques, one decision point

The `document` resource (`src/modules/document/`) is a demo exercising four authz
techniques side by side. Everything routes through `AuthorizationService`
(`src/modules/authorization/`). **`super_admin` short-circuits every check to ALLOW**
and never consults the permission map.

- **RBAC → Scopes**: roles expand to `Permission` strings via `ROLE_PERMISSIONS`
  (`rbac/role-permissions.map.ts`) — the single source of truth for "what a kind of
  user can do". `@RequirePermission(Permission.X)` + `PermissionsGuard` gate a route on
  a scope. See ADR-023, ADR-024.
- **ABAC**: `@Policy('document.read')` + `PolicyGuard` evaluate a named predicate
  (`abac/policies.ts`) over user + resource attributes (e.g. `visibility`). See ADR-025.
- **ReBAC**: `@RequireRelation(Relation.X)` + `RelationGuard` check a `RelationTuple`
  for the relation (or a stronger one via implication: `owner ⇒ editor ⇒ viewer`).
  Relation checks are **not cached** — a grant/revoke takes effect immediately, no event
  to emit. See ADR-026.

**Guard composition**: `DocumentController` applies all three guards class-wide. Each is
a **no-op unless its decorator is present** on the route — so the decorators select which
technique(s) gate that route, and **stacked decorators = logical AND**. All three guards
load by `:id` (single-resource routes only).

**`AuthorizationService.can()`** is for composed object-level decisions a stacked-AND
guard cannot express (read = `read:any` scope OR ABAC visibility OR `viewer` relation).
Feature services call it directly; route guards do not. List endpoints use
`readableDocumentWhere()` — a DB-level Prisma `where` filter so pagination runs over the
readable subset (never filter after `skip`/`take`).

**No-enumeration**: a denied **read** returns `404`, identical to a missing resource, so
a caller cannot probe which ids exist. Applies in both `PolicyGuard` and
`DocumentService.findOne()`. Write/delete/share keep `403` (they passed a relation guard,
so the id is already known to the caller). Error copy must not betray the real reason.
See ADR-028.

## Refresh token security — critical invariants

`TokenService.rotateRefreshToken()` must remain atomic in this order:
1. Verify JWT signature
2. Find user + token hash match
3. Detect reuse → revoke family if detected
4. Revoke old token BEFORE issuing new one
5. Issue new token pair

Do not reorder steps 4 and 5. If new token generation fails after step 4,
the user re-authenticates — that's the safe failure mode. The reverse
(issue first, revoke second) can leave two valid tokens in circulation.

See ADR-002 for the family-based reuse-detection rationale. ADR-001 is superseded
(refresh tokens are now in a `RefreshToken` table, not an embedded MongoDB array);
see ADR-008 for the PostgreSQL/Prisma migration decision.

## Config — always typed and validated

All environment variables are accessed via `ConfigService` using dotted paths
(`config.get('jwt.secret')`). Never read `process.env` directly in application
code. The Zod schema in `src/config/config.validation.ts` must be updated when
adding new env vars — the app refuses to start if validation fails.

Connection pool size is configurable via env var with a safe default:
- `DATABASE_POOL_MAX` (default `10`) — Prisma/pg connection pool

## REST API surface

All endpoints are REST. Domain CRUD (e.g. users) lives in a `<domain>.controller.ts`.
Auth flows (OAuth redirects, token refresh) and health checks are REST as well. ADR-003 (the old GraphQL/REST boundary)
is superseded — GraphQL was removed.

## BullMQ jobs — always wire the dead-letter hook

Every processor must implement `@OnWorkerEvent('failed')` and call
`DeadLetterService.handleFailedJob()`. Without this, final failures disappear
silently. See `src/core/queues/processors/` for the established pattern.

Queue names are constants in `src/core/queues/queues.constants.ts` — never inline
string literals in `BullModule.registerQueue()` or `@InjectQueue()`.

Default job options (set in `QueuesModule`): 3 attempts, exponential backoff
starting at 2 seconds. Override per-job only when the use case requires it.
Job payload types go in `src/core/queues/dto/` and are validated at enqueue time
with `satisfies` to catch shape errors at compile time.

## Database error handling

Catch `Prisma.PrismaClientKnownRequestError` for expected database errors:
- `P2002` → unique constraint violated → throw `ConflictException`
- `P2025` → record not found (update/delete on non-existent row) → throw `NotFoundException`

`GlobalExceptionFilter` handles both codes automatically. Feature services only need
explicit catches when the error needs context-specific messaging.

## Auth — mechanisms

**JWT flow**: lives in `AuthModule`. Bearer access token + HttpOnly `refresh_token`
cookie. All REST endpoints use this. See ADR-010.
`AuthModule` is split into one controller per technique (core JWT, OAuth, 2FA,
magic links) — see ADR-015. All four share the same module and the same JWT
state model; this is a file-organization split, not a module boundary split.
`AuthController` itself covers only: register, login, refresh, logout, me,
device sessions.

**OAuth** (Google, GitHub, Microsoft): `OAuthController` + strategies live in
`src/modules/auth/oauth/`. The callback always issues JWT tokens.

**2FA pending scope**: `TwoFactorController` lives in `src/modules/auth/two-factor/`.
Login with 2FA enabled issues a JWT with `scope: 'two_factor_pending'`.
Only `POST /auth/2fa/verify` (decorated `@AllowPending2FA()`) accepts it. All other
endpoints reject it. Do not accept pending-scope tokens elsewhere.

**Magic links**: `MagicLinkController` lives in `src/modules/auth/magic-link/`.

**API keys** (M2M, not a login flow): `ApiKeyController` lives in
`src/modules/auth/api-key/`. `POST /auth/api-keys` (create) and `DELETE
/auth/api-keys/:id` (revoke) are JWT-protected — a user mints/revokes their own keys.
`ApiKeyGuard` (`src/common/guards/api-key.guard.ts`) protects routes inside Nest's
pipeline; `createApiKeyExpressMiddleware()` (same file) protects non-Nest routes (e.g.
Bull Board, mounted via raw `app.use()` in `main.ts`) — both call the same
`ApiKeyService.validate()`. One credential per user is **not** enforced (unlike
WebAuthn below) — a user can have many keys. See ADR-019.

**WebAuthn/Passkey**: `WebauthnController` lives in `src/modules/auth/webauthn/`.
`POST /auth/webauthn/register/options` + `/register/verify` are JWT-protected.
`POST /auth/webauthn/login/options` + `/login/verify` are `@Public()` — login is
passwordless, no JWT exists yet at that point. **One credential per user** —
`WebauthnCredential.userId` is `@unique`; re-registering replaces the existing
passkey (`upsert`), not adds a second one. Registration/login challenges live in the
Redis cache (`CACHE_MANAGER`, keyed `webauthn:register:<userId>` /
`webauthn:login:<email>`, 5-min TTL) — never in a DB table; they're write-once-read-once
and don't need durability. `login/options` always returns `200` with a generated
challenge even if the email has no account/passkey (`allowCredentials: []` in that
case) — matches the no-enumeration policy already used by `/auth/login` and magic-link
send. See ADR-020.

**Passkey-only signup** (separate from `register/options`+`/verify` above, which require
an existing JWT user): `POST /auth/webauthn/signup/options` + `/signup/verify`, both
`@Public()`. Creates a brand-new user with `password: null`, `hasPassword: false` — the
passkey is the only credential, no password ever exists. No User row is created until
`/signup/verify` succeeds (pending state — challenge + displayName — lives in cache as
JSON, keyed `webauthn:signup:<email>`), so an abandoned signup ceremony never leaves an
orphan user. Email-uniqueness is checked at both `/options` and `/verify` (the ceremony
is a two-step round trip — a second signup can race in between). Do not branch
`registerOptions()`/`registerVerify()` to add this — they're deliberately separate
functions; see ADR-021.

## Magic link token security

Magic link tokens use `crypto.randomBytes(32)` hashed with SHA-256 (not bcrypt).
bcrypt is for long-lived credentials where brute-force resistance comes from the work
factor. A 32-byte random token stored as a SHA-256 hash is single-use, 15-minute TTL,
and provides 256-bit entropy — the work factor is irrelevant. Always clear the hash
immediately after successful verification.

## TOTP secret encryption — critical invariant

`twoFactorSecret` is **never stored plaintext**. Always encrypt via
`encryptTotpSecret(secret, key)` from `src/common/crypto/totp-crypto.util.ts`
before writing to the database, and decrypt with `decryptTotpSecret` before
passing to `authenticator.verify()`. The encryption key comes from
`config.get('app.totpEncryptionKey')` (validated at startup).

A plaintext TOTP secret exposed in a DB breach has no expiry — the attacker
can generate valid 2FA codes indefinitely. The encrypted format is
`enc:<base64(iv || authTag || ciphertext)>`. The `enc:` prefix is what
distinguishes encrypted values from legacy plaintext in the DB.

See ADR-012 for rationale and migration notes.

## Testing

Unit tests mock `PrismaService` — do not use a real database connection in unit tests.
E2E tests (`test/` directory) may use real infrastructure via
`docker-compose up -d postgres redis` before the test run.



Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes m;;''ade unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.
