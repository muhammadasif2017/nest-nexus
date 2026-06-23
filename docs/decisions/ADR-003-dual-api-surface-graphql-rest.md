# ADR-003: Dual API Surface — GraphQL + REST

## Status
Superseded (2026-06-23) — GraphQL was removed; the API surface is now REST-only.
Domain CRUD (users) moved to a REST controller. This ADR is retained for history.

## Date
2026-06-15

## Context
The boilerplate must serve multiple consumer types:
- SPAs and mobile apps that need flexible data fetching
- Webhook receivers and third-party integrations that expect REST semantics
- Auth flows with redirect-based OAuth (inherently HTTP, not GraphQL)
- File upload endpoints (GraphQL multipart is non-standard and poorly supported)

## Decision
Expose both GraphQL (Apollo, code-first) and REST (NestJS controllers) with a
clear allocation of which operations go where:

**GraphQL** owns all CRUD operations on domain entities: users, posts, etc.
Clients request exactly the fields they need; DataLoaders batch N+1 queries.

**REST** owns:
- Auth flows: `/api/v1/auth/*` (login, refresh, OAuth redirects/callbacks)
- File uploads: `/api/v1/storage/*` (multipart form data, presigned URL orchestration)
- Health/metrics: `/api/v1/health/*`, `/metrics` (infrastructure, not domain)
- WebSocket upgrade path (HTTP → WS) for real-time

## Alternatives Considered

### GraphQL only
- Pros: Single paradigm, no REST conventions to maintain, federation-ready
- Cons: OAuth callbacks are redirect-based HTTP — forcing them through GraphQL
  requires awkward REST shims anyway; file uploads via GraphQL multipart have
  poor client library support; health checks and Prometheus scraping expect
  plain HTTP endpoints
- Rejected: The carve-outs needed for auth and uploads effectively recreate REST;
  better to be explicit about the boundary

### REST only
- Pros: Familiar, well-tooled, predictable
- Cons: Over-fetching/under-fetching requires versioned endpoint proliferation;
  client-side data stitching for composite views; no built-in batching (N+1)
- Rejected: GraphQL's flexibility for data-fetching is a significant DX win that
  REST can't match without extensive custom work

### tRPC
- Pros: End-to-end type safety with no codegen step
- Cons: TypeScript-only consumers; no REST compatibility for third parties;
  NestJS integration is unofficial; learning curve for non-TypeScript teams
- Rejected: Too restrictive for a boilerplate targeting diverse consumers

## Consequences
- Guards (`JwtAuthGuard`, `RolesGuard`) override `getRequest()` to extract the
  request from both HTTP and GraphQL execution contexts — same guard works on both.
- The `GlobalExceptionFilter` has two code paths: HTTP status codes for REST,
  `GraphQLError` with `extensions.code` for GraphQL (HTTP 200 envelope).
- GraphQL schema is written to `src/schema.graphql` at build time, enabling
  frontend codegen without running the server.
- Auth resolvers exist in both layers: `auth.resolver.ts` for GraphQL mutations
  (login, register) and `auth.controller.ts` for REST endpoints (refresh, OAuth).
