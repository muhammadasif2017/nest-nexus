# ADR-011: Event-Driven Cache Invalidation via EventEmitter2 + Redis Pub/Sub

## Status
Accepted

## Date
2026-06-16

## Context
The project uses `@nestjs/cache-manager` (backed by `@keyv/redis`) to cache query results.
After any mutation, the corresponding cache entries must be deleted to prevent stale reads.

Two requirements shape the design:

1. **Separation of concerns**: Feature services (e.g., `UsersService`) should not know
   about the cache layer. Coupling them to `CacheManager` spreads cache-key knowledge
   across every service that writes data.

2. **Cross-instance consistency**: In a horizontally scaled deployment (multiple pods behind
   a load balancer), each pod maintains its own in-process cache layer. If Pod A mutates
   a user and deletes from its local cache, Pod B still serves the stale entry from its
   own cache. A purely local invalidation strategy is insufficient.

## Decision
Feature services emit domain events via `EventEmitter2`:
```typescript
this.eventEmitter.emit('user.updated', { userId });
```

`CacheInvalidationService` listens for these events, deletes the relevant keys locally,
then publishes a message to a Redis Pub/Sub channel (`cache:invalidation`). All running
instances subscribe to that channel and delete the same keys from their local caches.

The publisher and subscriber are separate `ioredis` connections — a connection in
subscribe mode can only receive messages and cannot publish.

## Alternatives Considered

### Direct cache.del() calls in feature services
- Pros: Simple, explicit, easy to trace
- Cons: Feature services must import and depend on `CacheManager`; cache-key strings
  are duplicated or shared via constants across every service that writes; adding a new
  cached query requires updating every service that can invalidate it
- Rejected: Cross-cutting cache concerns belong in a dedicated service, not scattered
  across domain services

### Short TTL without explicit invalidation (cache-aside with expiry only)
- Pros: Zero invalidation code; stale data expires automatically
- Cons: Stale window is bounded by TTL (5 minutes default), not by the mutation event;
  a user who updates their profile sees their own stale data for up to 5 minutes;
  unacceptable for user-facing mutations
- Rejected: Explicit invalidation is required for consistency after writes

### Redis keyspace notifications (server-side auto-notify on key expiry/delete)
- Pros: No separate Pub/Sub channel needed; Redis notifies subscribers automatically
- Cons: Requires `CONFIG SET notify-keyspace-events` on the Redis server — not possible
  on managed Redis providers (Elasticache, Upstash) without administrative access;
  notification payload is the key name only — a deleted key from one cache layer doesn't
  imply the same key exists on other instances
- Rejected: Requires Redis configuration access not guaranteed in managed environments

### Shared Redis cache (single `@keyv/redis` store, no local memory layer)
- Pros: All pods share one cache; invalidation from any pod is immediately visible to all
- Cons: Every cache read is a network round-trip to Redis — loses the latency benefit
  of local in-process caching for hot keys; Redis becomes a single point of failure
  for the caching layer
- Rejected: The local cache layer is the performance benefit; Pub/Sub preserves it while
  solving cross-instance consistency

## Consequences
- `CacheInvalidationService` is the single place where cache keys are defined as strings.
  When a new cacheable query is added to a service, register its invalidation handler in
  `CacheInvalidationService` — do not add `cache.del()` calls to the feature service.
- Two extra `ioredis` connections exist alongside the BullMQ and `@keyv/redis` connections.
  This is acceptable; all three share the same Redis instance. A future consolidation
  effort could reduce connection count if it becomes a bottleneck.
- The Pub/Sub channel `cache:invalidation` carries key arrays as JSON. If an event handler
  throws, those keys are not retried — the next TTL expiry is the fallback. This is
  acceptable because invalidation failures are transient and the TTL bounds the stale window.
- Feature services must emit events even when a mutation affects no cached data. The
  `CacheInvalidationService` silently no-ops if no handler exists for the event — no error
  is raised for unrecognised event names.
