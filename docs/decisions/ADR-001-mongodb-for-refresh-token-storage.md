# ADR-001: Store Refresh Tokens in MongoDB with bcrypt Hashing

## Status
Superseded by ADR-008

> The storage location decision (MongoDB embedded array vs. separate collection)
> is superseded: the project migrated to PostgreSQL, and refresh tokens now live
> in a dedicated `RefreshToken` table with a FK to `User`. The bcrypt hashing
> strategy (cost 8 for random tokens) and the 7-day TTL remain unchanged.
> The reuse-detection algorithm documented in ADR-002 is also unchanged.

## Date
2026-06-15

## Context
Refresh tokens are long-lived credentials (7 days) that can mint new access tokens.
They must be stored server-side to support revocation. We need to decide:
1. Where to store them (MongoDB vs Redis vs separate table)
2. How to store them (raw vs hashed)

Requirements:
- Revocation must be immediate and permanent
- A stolen token replayed after rotation must be detectable
- Database compromise must not expose usable tokens
- Token lookup must be efficient during the critical refresh path

## Decision
Store refresh tokens as bcrypt hashes (cost 8) inside the user document's
`refreshTokens` array in MongoDB. Each entry includes the hash, a `jti` (unique
token ID), a `family` ID (shared by all tokens in a rotation chain), an `isRevoked`
flag, and an `expiresAt` timestamp.

## Alternatives Considered

### Redis (raw token as key, TTL for expiry)
- Pros: O(1) lookup by token, auto-expiry via TTL, very fast
- Cons: Raw tokens at rest — a Redis compromise exposes all active sessions;
  no natural home for family-based reuse detection metadata; losing Redis state
  (restart without persistence) logs out all users simultaneously
- Rejected: Security posture too weak for long-lived credentials; operational
  fragility unacceptable

### Redis with hashed token as key
- Pros: Fast lookup, auto-expiry
- Cons: Still requires a separate data structure to track token families;
  splitting session state across MongoDB (users) and Redis (tokens) creates
  consistency risks on failure
- Rejected: Complexity without sufficient benefit over MongoDB approach

### Separate MongoDB collection (`refresh_tokens`)
- Pros: Clean separation, index on `tokenHash` for O(1) lookup
- Cons: Cross-document joins needed to check user status during validation;
  an extra round-trip per refresh
- Rejected: Marginal performance gain not worth the join overhead; user document
  approach allows atomic revocation of all user tokens in a single update

### Raw token in user document (no hashing)
- Pros: Eliminates bcrypt overhead on every rotation
- Cons: Database backup or read access exposes all active refresh tokens
- Rejected: Violates defense in depth — credentials must never be stored in
  recoverable form

## Consequences
- bcrypt cost 8 (vs 12 for passwords) is intentional: refresh tokens are
  cryptographically random, so brute-force resistance comes from entropy, not
  work factor. Cost 8 is still sufficient while keeping rotation latency low.
- The `refreshTokens` array must be selected explicitly (`select: false` on
  schema) to prevent accidental exposure in user queries.
- `pruneExpiredTokens()` runs asynchronously after every token issuance to
  bound array growth without blocking the response.
- Multi-device logout is O(1): one MongoDB update sets `refreshTokens: []`.
