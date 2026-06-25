# ADR-030: Remove Session-Based Authentication

## Status
Accepted — supersedes ADR-010 (session flow portion) and ADR-014

## Date
2026-06-25

## Context
ADR-010 established JWT + session as dual auth flows. ADR-014 isolated the session
flow into its own `SessionAuthModule` to keep the two mechanisms cleanly separated.

After the authorization layer shipped (ADR-023–029), the project's auth surface was
audited for unused complexity. The session flow (`POST /auth/session/login`,
`POST /auth/session/logout`) had no active consumers and carried real infrastructure
overhead:

- `express-session` + `connect-pg-simple` — a dedicated PostgreSQL connection pool
  (`DATABASE_SESSION_POOL_MAX`) just to persist session rows
- `csrf-csrf` — a double-submit CSRF middleware scoped to `/api/v1/auth/session/*`,
  required because browser-sent cookies are CSRF-vulnerable (Bearer tokens are not)
- `SESSION_SECRET` — a required 32-char env var that failed startup validation if absent
- `SessionGuard`, `SessionSerializer`, `SessionLoginInput`, and all associated tests

Removing it reduces the dependency count by five packages and the env var count by two,
with no change to any active auth path.

A secondary finding during the audit: the OAuth strategies (Google, GitHub, Microsoft)
do **not** pass `state: true` in their Passport constructor options. `passport-oauth2`
only activates `SessionStateStore` when `state: true` is set; without it, no
`req.session` access occurs during the OAuth redirect flow. This means
`express-session` had no remaining consumers and could be fully removed — not just the
session-auth login routes.

## Decision
Remove the session-based login/logout mechanism entirely:

- Delete `src/modules/session-auth/` and deregister `SessionAuthModule`
- Remove the `express-session` / `connect-pg-simple` / `csrf-csrf` middleware stack
  from `main.ts`
- Remove `SESSION_SECRET` and `DATABASE_SESSION_POOL_MAX` from config validation
- Uninstall the five affected packages

JWT remains the sole auth mechanism. OAuth, 2FA, magic-link, API keys, and WebAuthn
are unaffected — none had a dependency on `SessionAuthModule` or `req.session`.

## Alternatives Considered

### Keep session auth, just don't use it
- Pros: preserves the feature for future SSR clients
- Cons: dead infrastructure still runs at startup; `SESSION_SECRET` still required in
  every deployment; five packages still in the dependency tree; CSRF middleware still
  active on a path with no routes behind it
- Rejected: carrying live infrastructure for a zero-consumer feature is not a
  reasonable trade-off in a learning-lab project

### Keep `express-session` but remove `SessionAuthModule`
- Pros: preserves a session store if OAuth ever needs `state: true`
- Cons: OAuth strategies verified to not use `state: true`; keeping the middleware
  would require keeping `SESSION_SECRET` and `connect-pg-simple`, removing most of
  the benefit
- Rejected: the audit confirmed no remaining session consumer; full removal is cleaner

## Consequences
- Five packages removed: `express-session`, `connect-pg-simple`, `csrf-csrf`,
  `@types/express-session`, `@types/connect-pg-simple`
- Two env vars removed: `SESSION_SECRET`, `DATABASE_SESSION_POOL_MAX`
- `main.ts` bootstrap is simpler — no session store setup, no CSRF middleware
- If session-based auth is ever added back, ADR-014's `SessionAuthModule` pattern
  is the right structure to follow
- OAuth strategies must remain without `state: true` unless a custom state store
  is explicitly wired; adding `state: true` to any OAuth strategy without also
  restoring `express-session` middleware will cause runtime errors
