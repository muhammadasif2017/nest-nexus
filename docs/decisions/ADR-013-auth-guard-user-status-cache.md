# ADR-012: In-Process User Status Cache in Auth Guards

## Status
Accepted

## Date
2026-06-16

## Context
Every authenticated request passes through `JwtStrategy.validate()`. Prior to this change,
`validate()` issued a `SELECT isActive FROM "User" WHERE id = $1` on every request to confirm
the user has not been deactivated since their JWT was issued. `SessionGuard.canActivate()` did
the same with a wider `SELECT id, email, roles, isActive`.

At low traffic this is tolerable. Under load (e.g. 100 req/s with 10 concurrent users) it
produces 100 redundant single-row reads per second against the primary Postgres connection
pool — reads that almost always return the same row with no changes.

Two constraints bound the solution:

1. **Safety**: A deactivated account must be blocked promptly. The delay between an admin
   deactivating a user and that user being rejected must be short and bounded.

2. **Horizontal scale**: Multiple pods each have their own in-process state. An invalidation
   signal that only reaches one pod is insufficient if requests are load-balanced across all.

The existing event system (`EventEmitter2`) and Redis Pub/Sub infrastructure from ADR-011
already solve cross-instance cache invalidation for `CacheInvalidationService`. However,
wiring auth guards through `CacheInvalidationService` would create a dependency from the
infrastructure layer into the auth layer, inverting the intended coupling direction.

## Decision
`JwtStrategy` and `SessionGuard` each maintain an in-process `Map` keyed by user ID:

- **TTL**: 30 seconds. Cache entries older than 30s are ignored and re-fetched from the DB.
- **Invalidation**: Both classes listen directly on `user.updated` and `user.deactivated`
  domain events via `@OnEvent()`. On receipt they delete the entry immediately, so a
  deactivated user is rejected on the next request — not after the TTL expires.
- **Bounded size** (`JwtStrategy`): A `MAX_CACHE_SIZE` guard evicts expired entries when
  the map grows beyond 10,000 entries, preventing unbounded memory growth under high user
  cardinality.

The event listener approach keeps the auth guards self-contained: they own their own cache
and their own invalidation logic. `CacheInvalidationService` (ADR-011) remains responsible
only for the `users:*` query-result cache — a separate concern.

## Alternatives Considered

### Redis-backed cache (read from Redis instead of DB on cache miss)
- Pros: Shared across pods — a deactivation on Pod A is immediately visible to Pod B
  without waiting for a Pub/Sub round-trip
- Cons: Every request still pays a network round-trip (to Redis instead of Postgres);
  adds a Redis dependency to the auth hot path; if Redis is unavailable, auth fails
- Rejected: The in-process Map eliminates the network round-trip entirely. The 30s TTL
  bounds the stale window acceptably; event invalidation handles prompt deactivation.
  Redis unavailability should not cause authentication failures.

### Zero caching — keep per-request DB call, add a read replica
- Pros: Always fresh; no stale-data window; no cache invalidation logic
- Cons: Read replicas have replication lag; does not eliminate the per-request DB cost,
  only distributes it; operational overhead of a replica for a single-row lookup
- Rejected: Adds infrastructure cost without eliminating the root cause.

### Longer TTL (match JWT expiry — 15 minutes)
- Pros: Fewer DB reads
- Cons: A deactivated user would be blocked only after their current JWT expires (up to
  15 minutes). For a security-sensitive operation like account deactivation, this window
  is unacceptable.
- Rejected: The 30s TTL is the balance point — low enough to feel prompt, high enough
  to eliminate the per-request DB cost for active sessions.

### No cache — accept the per-request DB cost
- Pros: Zero complexity, always correct
- Cons: Linear scaling: DB load grows with request rate regardless of active user count;
  under sustained traffic the isActive checks compete with business queries for connection
  pool slots
- Rejected: The per-request cost is unnecessary for a value that changes rarely.

## Consequences
- Deactivated users are blocked within 30 seconds (or on the next request after the
  deactivation event is received, whichever is sooner). This is documented and accepted.
- Services that deactivate users **must** emit `user.deactivated` (or `user.updated`) via
  `EventEmitter2` for prompt invalidation. Skipping the event means the cache will not be
  cleared until the 30s TTL expires.
- The `Map` is per-process. In a multi-pod deployment, event invalidation is local only —
  the `user.deactivated` event is not broadcast via Redis Pub/Sub to other pods. Other pods
  rely on the 30s TTL for eventual consistency. If sub-30s cross-pod propagation is required
  in future, extend `CacheInvalidationService` to publish a `user.deactivated` signal over
  the existing `cache:invalidation` channel and have the guards subscribe to it.
- `JwtStrategy` exposes `invalidateUserCache(userId)` for callers that need to force
  immediate invalidation outside of the event system (e.g., integration tests).
- ADR-011 noted that a future Redis connection consolidation effort was deferred. That
  consolidation has been completed: `RedisLockService` and `RedisHealthIndicator` now share
  a single `RedisClientService` connection instead of creating separate clients, reducing
  per-pod Redis connections from 5 to 4.
