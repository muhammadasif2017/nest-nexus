# ADR-007: cache-manager v6 and @keyv/redis

## Status
Accepted

## Date
2026-06-15

## Context
`@nestjs/cache-manager@3.x` (the version compatible with NestJS v11) declares a
peer dependency on `cache-manager@>=6`. The project was using `cache-manager@^5.4.0`
with `cache-manager-ioredis-yet@^2.x` as the Redis store adapter.

cache-manager v5→v6 is a breaking API change: v5 used a `store.create()` factory
pattern; v6 replaced this with [Keyv](https://keyv.org/) — a unified key-value
storage interface with adapters for each backend. The old `cache-manager-ioredis-yet`
store adapter only implements the v5 factory API and cannot be used with v6.

## Decision
Upgrade to cache-manager v6 and replace `cache-manager-ioredis-yet` with
`@keyv/redis` — the official Keyv adapter for Redis (backed by `@redis/client`,
the official Redis client maintained by Redis Ltd.).

The `@nestjs/cache-manager@3.x` module automatically wraps a bare `KeyvStoreAdapter`
in a `Keyv` instance (with the factory-provided TTL) when the store passed in
`stores[]` is not already a full `Keyv` instance. This means `new KeyvRedis(url)`
can be passed directly without manually constructing `new Keyv({ store: ... })`.

Redis connection URL is built from `redis.host`, `redis.port`, and the optional
`redis.password` config values. Passwords are `encodeURIComponent`-escaped before
interpolation to handle special characters (`@`, `:`, `/`).

## Alternatives Considered

### Downgrade @nestjs/cache-manager to v2.x (NestJS 10 era)
- Pros: Keeps cache-manager v5 and `cache-manager-ioredis-yet`; no migration needed
- Cons: `@nestjs/cache-manager@2.x` declares `@nestjs/common@^10` as a peer —
  incompatible with our v11 upgrade (ADR-006); would require pinning two
  incompatible version ranges
- Rejected: Creates a peer dep contradiction at the NestJS version boundary

### Keep cache-manager v5 with legacy-peer-deps
- Pros: No application code change; `cache-manager-ioredis-yet` works as-is
- Cons: `@nestjs/cache-manager@3.x` requires `>=6` at runtime, not just in peer
  declarations — the module would fail to initialise even if npm installed successfully
- Rejected: Would cause a startup crash, not just a warning

### Use ioredis directly via a custom Keyv adapter
- Pros: Stays with the ioredis client already in the project
- Cons: Requires maintaining a thin adapter wrapper; `@keyv/redis` is well-maintained
  and uses the official Redis client which is the direction the ecosystem is moving
- Rejected: Unnecessary maintenance burden for equivalent functionality

## Consequences
- The project now uses `@redis/client` (via `@keyv/redis`) alongside `ioredis`.
  Both are in the dependency tree: `ioredis` is used directly by `@nestjs-modules/ioredis`
  and `@socket.io/redis-adapter`; `@redis/client` is used only for caching.
  This is acceptable until a future consolidation effort picks one Redis client.
- Default TTL is 5 minutes (300,000 ms), set in `CacheModule.useFactory`.
  Feature modules that need different TTLs should call `cacheManager.set(key, value, ttl)`
  directly with a per-call TTL rather than reconfiguring the module.
- `REDIS_PASSWORD` is optional in `config.validation.ts`. Development environments
  without Redis auth simply omit the variable.
- TLS support is not yet wired — add `rediss://` scheme support when production
  Redis requires TLS (most managed Redis providers do).
