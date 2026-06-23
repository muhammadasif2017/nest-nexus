# ADR-019: API Key Auth for M2M / Non-User Callers

## Status
Accepted

## Date
2026-06-22

## Context
All existing auth mechanisms (JWT, session, OAuth, 2FA, magic link) assume a human
logging in. There was no way for a non-human caller — a cron job, an internal script,
Bull Board's admin UI — to authenticate without either sharing a real user's JWT/session
(coupling the caller to a person's account lifecycle) or having no auth at all. The
latter was true in practice: `/api/queues` (Bull Board, dev-only) was mounted with zero
auth.

Requirements:
- Long-lived secret, unlike a 15-minute JWT access token.
- Instantly revocable, unlike a JWT (which is valid until expiry — no server-side kill
  switch without a blocklist).
- Not tied to a login flow — no human in the loop.
- Scopable, so a key can be limited to "read-only" or similar in the future.

## Decision
Add `ApiKeyService` + `ApiKeyController` (`POST /auth/api-keys`, `DELETE
/auth/api-keys/:id`, both JWT-protected so only a logged-in user can mint/revoke their
own keys) + `ApiKeyGuard`.

- **Secret generation**: `crypto.randomBytes(32)` hex-encoded (256 bits of entropy),
  stored as a SHA-256 hash (`ApiKey.keyHash`) — same pattern as magic-link tokens
  (`MagicLinkService`), not bcrypt. Rationale is identical to the magic-link case: a
  high-entropy random token's security comes from entropy, not from a slow hash; bcrypt's
  work factor is irrelevant here and only adds latency.
- **Scopes**: freeform `string[]`, not a fixed enum. No current caller enforces a scope
  check yet (the only wired consumer, Bull Board, treats any valid key as full access) —
  freeform avoids inventing an enum for scopes nothing reads yet. Revisit as an enum once
  a real scope-checking consumer exists.
- **Revocation**: soft-delete via `revokedAt` timestamp, not row deletion — preserves
  `lastUsedAt`/audit trail. `revoke()` scopes the lookup to `{ id, userId }` so revoking
  another user's key returns 404 (not 403), avoiding existence leakage across users.
- **Guard vs. middleware**: `ApiKeyGuard` (`CanActivate`) is the Nest-native form for
  routes inside Nest's pipeline. Bull Board is a raw Express router mounted via
  `app.use()` in `main.ts`, outside Nest's DI-routed request pipeline — `@UseGuards()`
  cannot apply to it. `createApiKeyExpressMiddleware()` (same file,
  `src/common/guards/api-key.guard.ts`) is a plain Express middleware factory that calls
  the exact same `ApiKeyService.validate()` — single source of truth for "what does a
  valid key mean," two adapters for the two pipeline types.
- **First wired consumer**: `/api/queues` (Bull Board, dev-only admin UI) — was
  previously unauthenticated. This is now gated by `createApiKeyExpressMiddleware`,
  closing a real (if dev-only, low-severity) gap.

## Alternatives Considered

### Reuse JWT with a long expiry for service accounts
- Pros: no new auth mechanism, no new table
- Cons: no instant revocation (must wait out expiry or build a blocklist); conflates
  "service account" with "user" in the same token shape; awkward to scope
- Rejected: defeats the point of a short-lived JWT; building a blocklist is more
  complexity than a dedicated key table

### HMAC-signed keys (no DB lookup, like a JWT) instead of DB-stored hash + lookup
- Pros: no DB round-trip to validate
- Cons: can't revoke a signed key without a blocklist (same problem as above) — the
  whole reason for this feature is instant revocation
- Rejected: contradicts the core requirement

### Enum-based scopes from day one
- Pros: type-safe, no typos
- Cons: no consumer reads scopes yet — inventing an enum now means guessing values that
  may not match what a future feature actually needs
- Rejected: premature; freeform `string[]` until a real scope check exists

## Consequences
- New `ApiKey` table (migration `20260622113557_add_api_key`), one row per key, multiple
  keys per user allowed.
- `ApiKeyGuard` exists but most routes don't use it yet — it's infra ahead of consumers
  by design (see `docs/usecases/10-auth-api-key.md` for the candidate list: `/metrics`,
  `/upload/*`, `/health/deep`). Wiring those is a separate decision per route, not
  bundled into this one.
- Any future M2M endpoint should reuse `ApiKeyGuard` (Nest routes) or
  `createApiKeyExpressMiddleware` (non-Nest routes) rather than inventing a new check.
