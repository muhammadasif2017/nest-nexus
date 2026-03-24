# Nexus

> A production-ready NestJS enterprise boilerplate — secure, observable, and built to scale.

Nexus is an opinionated, fully-annotated backend architecture that collapses months of
infrastructure decisions into a single starting point. Every pattern was chosen for a
reason, every security layer has a documented rationale, and every module is designed to
be extended without being rewritten.

---

## What's Inside

| Layer | Technology | Purpose |
|---|---|---|
| **Framework** | NestJS 10 | Module system, DI container, decorators |
| **Database** | MongoDB + Mongoose | Primary data store with schema hooks |
| **API** | GraphQL (Apollo) + REST | Dual API surface, code-first schema |
| **Real-time** | Socket.io + SSE | WebSocket gateway + server-sent events |
| **Auth** | JWT + Sessions + OAuth2 | Hybrid authentication, token rotation |
| **2FA** | TOTP (otplib) | Authenticator app support with backup codes |
| **Passwordless** | Magic links | Email-based authentication |
| **Cache** | Redis (ioredis) | Application cache + BullMQ backbone |
| **Queues** | BullMQ | Background jobs, retries, dead-letter |
| **Scheduler** | @nestjs/schedule | Cron jobs with distributed locking |
| **Storage** | AWS S3 / MinIO | Direct, presigned, and multipart uploads |
| **Images** | Sharp | Variant generation, EXIF stripping, LQIP |
| **Scanning** | ClamAV | Async virus scanning with quarantine flow |
| **Security** | Helmet, CSRF, Throttler | Layered HTTP security hardening |
| **Observability** | Prometheus + Grafana | Metrics, dashboards, alerting rules |
| **Health** | Terminus | Kubernetes-ready liveness/readiness probes |
| **Logging** | Pino | Structured JSON logs with redaction |
| **Containers** | Docker + Compose | Full local stack in one command |

---

## Quick Start

### Prerequisites

- Node.js 20+
- Docker and Docker Compose

### 1. Clone and install

```bash
git clone https://github.com/your-org/nexus.git
cd nexus
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Open `.env` and fill in the required values. The three you must set before anything works:

```bash
SESSION_SECRET=    # 64-char random hex: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=        # 64-char random hex (different from SESSION_SECRET)
JWT_REFRESH_SECRET=# 64-char random hex (different from both above)
```

Everything else has a safe default for local development.

### 3. Start the infrastructure

```bash
# Start MongoDB, Redis, MinIO, and ClamAV
docker-compose up -d mongo redis minio clamav

# Verify all services are healthy
docker-compose ps
```

### 4. Run the application

```bash
# Development (hot reload)
npm run start:dev

# Production build
npm run build && npm start
```

### 5. Verify it's working

```bash
# Health check
curl http://localhost:3000/api/v1/health/ready

# GraphQL Playground
open http://localhost:3000/graphql

# Queue dashboard
open http://localhost:3000/admin/queues
```

### Start the observability stack (optional)

```bash
docker-compose --profile observability up -d

open http://localhost:3001   # Grafana (admin / changeme)
open http://localhost:9090   # Prometheus
```

---

## Project Structure

```
src/
├── main.ts                          # Bootstrap: security middleware, versioning
├── app.module.ts                    # Root composition module
│
├── config/                          # Typed, Zod-validated environment config
│   ├── app.config.ts
│   ├── database.config.ts
│   ├── redis.config.ts
│   ├── jwt.config.ts
│   ├── oauth.config.ts
│   ├── storage.config.ts
│   ├── alerts.config.ts
│   └── config.validation.ts         # Zod schema — app refuses to start if invalid
│
├── common/                          # Shared, zero-business-logic primitives
│   ├── decorators/                  # @CurrentUser(), @Roles(), @Public(), @AllowPending2FA()
│   ├── enums/                       # Role enum
│   ├── filters/                     # GlobalExceptionFilter (REST + GraphQL aware)
│   ├── guards/                      # JwtAuthGuard, RolesGuard (both context-aware)
│   └── interceptors/                # LoggingInterceptor, SerializeInterceptor
│
├── database/                        # MongoDB connection (forRootAsync)
├── cache/                           # Redis CacheModule + CacheInvalidationService
├── logger/                          # Pino logger with request redaction
├── events/                          # EventEmitter2 (wildcard, global)
├── queues/                          # BullMQ queues, processors, dead-letter, Bull Board
├── scheduler/                       # Cron jobs with distributed Redis locking
├── storage/                         # S3 abstraction, Sharp pipeline, ClamAV quarantine
├── health/                          # Terminus liveness + readiness + deep checks
├── metrics/                         # Prometheus metrics + HTTP interceptor
├── graphql/                         # GraphQLModule configuration
│
└── modules/                         # Feature modules (one per domain)
    ├── auth/                        # JWT, sessions, OAuth2, TOTP, magic links
    ├── users/                       # UserSchema, DataLoader, serialization
    └── notifications/               # WebSocket gateway, SSE, fan-out delivery
```

---

## Architecture Decisions

### Security is layered, not bolted on

Every incoming request passes through seven security layers before reaching application code:
CORS → Helmet → Compression → Cookie Parser → Session → Rate Limiting → Guards.
Each layer has a single, non-overlapping responsibility. Removing one degrades security
in exactly one dimension, which makes the tradeoffs explicit.

### Authentication is hybrid by design

The JWT path (stateless Bearer tokens + HttpOnly refresh cookie) serves API clients — mobile
apps, SPAs, third-party integrations — that manage their own session state. The session path
(server-side sessions in MongoDB via express-session) serves traditional web clients where
the server holds state. Both paths share the same `AuthService` and converge on the same
`req.user` object that guards and decorators read from.

### Refresh token rotation with reuse detection

Every successful refresh issues a new refresh token and invalidates the old one. If an
already-used token is presented — the signature of a stolen token being replayed — the
entire token *family* is immediately revoked, forcing a full re-login. The family concept
means a single stolen token can't silently persist access; the moment it's used, the
legitimate user's next refresh triggers full revocation.

### Guards are context-aware

`JwtAuthGuard` and `RolesGuard` both override `getRequest()` to handle GraphQL's nested
context structure alongside standard HTTP. The same guard works on REST controllers,
GraphQL resolvers, and returns the correct `req.user` from both. WebSocket connections
handle authentication manually in `handleConnection()` because HTTP guards don't run
after the WebSocket upgrade.

### The exception filter speaks two languages

A single `GlobalExceptionFilter` handles both REST and GraphQL. For HTTP contexts it sets
the response status code and returns a consistent JSON envelope. For GraphQL contexts it
returns a `GraphQLError` with structured `extensions.code` — because GraphQL always returns
HTTP 200, and error information travels in the response body. Apollo's `formatError` runs as
a final pass to strip stack traces in production.

### Cache invalidation is event-driven and cross-instance

When `UsersService.update()` runs, it emits `user.updated` via EventEmitter2.
`CacheInvalidationService` listens for that event, deletes the affected cache keys locally,
and publishes an invalidation message to a Redis Pub/Sub channel. Every other running
instance receives that message and deletes the same keys from their view of the cache.
The stale window is near-zero rather than "up to TTL."

### Cron jobs use distributed locking

Every `@Cron()` handler acquires a Redis lock before doing any work. The lock uses
`SET key value NX PX ttl` (atomic compare-and-set) and releases via a Lua script
(atomic compare-and-delete). If the lock is already held by another instance, the handler
logs and returns immediately. This eliminates duplicate work and phantom concurrency bugs
in horizontally scaled deployments.

### File uploads follow a three-pattern strategy

**Direct** (file < 10MB or needs server-side processing): file bytes flow through
NestJS → S3. Enables image processing and virus scanning before storage.
**Presigned** (file 10–100MB): NestJS issues a signed URL, client uploads directly to S3,
client confirms back to NestJS. Server never touches the file bytes.
**Multipart** (file > 100MB): NestJS orchestrates part-level presigned URLs, client uploads
parts in parallel, NestJS completes the assembly. All three patterns write to the same
`FileRecord` schema with a status lifecycle (PENDING → COMPLETE/FAILED).

### BullMQ jobs have a two-layer failure strategy

Layer 1 is automatic retry with exponential backoff — handles transient failures (network
blips, momentary Redis timeouts). Layer 2 is the dead-letter store — on final failure,
the job is persisted to MongoDB, classified by error type (transient, permanent, external),
and an alert is fired for critical queues. Operators can inspect, acknowledge, and replay
dead-letter jobs without touching the database directly.

---

## Authentication Flows

### JWT Login

```
POST /graphql { mutation login(input) }
  → AuthService validates credentials (timing-safe bcrypt)
  → TokenService issues access token (15m) + refresh token (7d)
  → Access token → response body (store in memory, not localStorage)
  → Refresh token → HttpOnly cookie (browser stores automatically)
```

### Token Refresh

```
POST /api/v1/auth/refresh (refresh_token cookie sent automatically)
  → TokenService.rotateRefreshToken()
    → Verify JWT signature
    → Find matching bcrypt hash in user.refreshTokens
    → REUSE DETECTED? → revoke entire token family → force re-login
    → Mark old token consumed → issue new token pair
  → New refresh token → replaces HttpOnly cookie
  → New access token → response body
```

### OAuth2 (Google / GitHub)

```
GET /api/v1/auth/google          → redirects to Google consent screen
GET /api/v1/auth/google/callback → Passport verifies, OAuthService upserts user
                                 → issues token pair → redirects to frontend
                                   with access token in URL fragment (#token=...)
```

### Account Linking

```
GET /api/v1/auth/google/link     → requires JWT (authenticated user)
                                 → embeds userId in OAuth state parameter
GET /api/v1/auth/google/callback → detects state → links provider to existing account
                                 → safety checks: provider not already linked,
                                   not claimed by another account
```

### TOTP Two-Factor

```
POST → initiateTwoFactor()       → returns QR code URI + raw secret
POST → confirmTwoFactor(code)    → verifies first code → enables 2FA → returns backup codes

On login (2FA enabled):
  → Password valid → issue 2FA pending token (scope: 'two_factor_pending', 5m TTL)
  → POST verifyTwoFactor(pendingToken, totpCode)
  → Code valid → issue full auth tokens
```

---

## Real-Time Architecture

### WebSocket (bidirectional, persistent)

```
Client                              Server
  │                                    │
  ├─ connect({ auth: { token } }) ────→│ handleConnection()
  │                                    │   verify JWT manually
  │                                    │   join room 'user:{userId}'
  │←── connection:established ─────────│   deliver unread notifications
  │                                    │
  │←── notification:new ───────────────│ @OnEvent('notification.created')
  │                                    │   server.to('user:{id}').emit(...)
  │                                    │   Redis adapter fans out to all instances
  │
  ├─ notification:mark_read ──────────→│ @SubscribeMessage()
  │←── notification:updated ───────────│   marks read, acknowledges sender
```

### SSE (unidirectional, reconnect-safe)

```
GET /api/v1/notifications/stream
  → Creates per-user RxJS Subject
  → Returns Observable<MessageEvent> (NestJS keeps connection open)
  → Each event carries id: (MongoDB ObjectId)

On reconnect (browser sends Last-Event-ID header automatically):
  → findMissedNotifications(userId, lastEventId)
  → MongoDB: { _id: { $gt: ObjectId(lastEventId) } }
  → Replays missed events → resumes live stream
```

---

## Queue Architecture

### Job lifecycle

```
Producer.enqueue()
  → Rate limit check (per-user Redis counter)
  → Priority assignment (1=CRITICAL, 5=HIGH, 10=NORMAL, 50=LOW)
  → BullMQ.add(jobName, data, options)

Worker.process()
  → Exponential backoff retry (attempts: 3, delay: 2s/4s/8s)
  → On success: removeOnComplete (keep last 1000, max 24h)
  → On final failure:
      → DeadLetterService.handleFailedJob()
          → Classify error (transient / permanent / external)
          → Persist to MongoDB dead-letter collection
          → Webhook alert for critical queues
```

### Queues

| Queue | Concurrency | Purpose |
|---|---|---|
| `email` | 5 | Welcome, magic link, digest emails |
| `image-processing` | 2 | Sharp variant generation, metadata extraction |
| `virus-scan` | 3 | ClamAV scanning, quarantine/release |
| `notifications` | 5 | Fan-out to WebSocket + SSE |
| `cleanup` | 10 | Orphaned S3 objects, expired tokens |

---

## Image Processing Pipeline

Every image upload produces four variants in a single Sharp pipeline pass (one decode, multiple outputs):

| Variant | Dimensions | Fit | Format | Quality |
|---|---|---|---|---|
| `thumbnail` | 150×150 | cover (square crop) | WebP | 80 |
| `medium` | 800×600 | inside (aspect preserved) | WebP | 82 |
| `large` | 1920×1080 | inside | WebP | 85 |
| `original` | unchanged | — | WebP | 90 |

EXIF data (GPS coordinates, device serial numbers, timestamps) is stripped from all
variants regardless of the `withMetadata` setting — privacy by default.

A base64 LQIP (Low Quality Image Placeholder, 20×20px blurred WebP) is generated and
stored alongside variant URLs. Frontends can inline this as the initial `src` for
progressive loading before the full image arrives.

---

## Observability

### Endpoints

| Endpoint | Purpose | Kubernetes role |
|---|---|---|
| `GET /api/v1/health/live` | Is the process alive and not OOM? | Liveness probe |
| `GET /api/v1/health/ready` | Are all dependencies reachable? | Readiness probe |
| `GET /api/v1/health/deep` | Full dependency diagnostics | Manual inspection |
| `GET /metrics` | Prometheus scrape target | Metrics collection |

### Key metrics

| Metric | Type | Alert threshold |
|---|---|---|
| `http_requests_total` | Counter | Error rate > 5% for 2m |
| `http_request_duration_seconds` | Histogram | P95 > 1s for 5m |
| `bullmq_queue_depth{state="waiting"}` | Gauge | > 500 for 5m |
| `auth_events_total{outcome="failure"}` | Counter | > 10/min (brute force) |
| `cache_operations_total` | Counter | Hit ratio < 80% |
| `websocket_connections_active` | Gauge | Sudden drop |

### Grafana dashboards

Pre-provisioned dashboards load automatically at startup (no manual import required):

- **API Overview** — request rate, error rate, P95/P99 latency by route
- **Queue Health** — depth, throughput, failure rate per queue
- **Infrastructure** — Redis memory, MongoDB operation rate, disk usage
- **Security** — auth event rate, failed login spikes, rate limit triggers

---

## Environment Variables

See `.env.example` for the complete annotated reference. Required variables:

```bash
SESSION_SECRET          # 64-char random hex
JWT_SECRET              # 64-char random hex
JWT_REFRESH_SECRET      # 64-char random hex (different from JWT_SECRET)
MONGODB_URI             # MongoDB connection string
```

Optional variables enable additional features:

```bash
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET    # Enables Google OAuth
GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET    # Enables GitHub OAuth
AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY  # Enables real S3 (MinIO used otherwise)
ALERTS_WEBHOOK_URL                         # Enables Slack/webhook job failure alerts
```

---

## Scripts

```bash
npm run start:dev     # Development server with hot reload
npm run start:debug   # Development server with debugger attached
npm run build         # Compile TypeScript → dist/
npm start             # Run compiled application
npm test              # Jest unit tests
npm run test:e2e      # End-to-end tests
npm run test:cov      # Tests with coverage report
npm run typecheck     # TypeScript type check without emitting
npm run lint          # ESLint with auto-fix
```

---

## Docker Commands

```bash
# Start full local stack
docker-compose up -d

# Start only infrastructure (run app locally for hot reload)
docker-compose up -d mongo redis minio clamav

# Start with observability stack
docker-compose --profile observability up -d

# View logs for a specific service
docker-compose logs -f app

# Reset all data (destructive)
docker-compose down -v

# Build production image
docker build --target production -t nexus:latest .
```

---

## Extending the Boilerplate

### Adding a new feature module

```bash
# NestJS CLI generates the module scaffold
nest generate module modules/orders
nest generate service modules/orders
nest generate resolver modules/orders   # For GraphQL
```

Follow the existing module pattern:

1. Define the Mongoose schema in `schemas/`
2. Define input DTOs in `dto/` with class-validator decorators
3. Define the output DTO in `dto/` with `@Expose()` and `@ObjectType()`
4. Implement the service (inject `CacheService` for cacheable reads)
5. Emit domain events via `EventEmitter2` after every mutation
6. Implement the resolver or controller
7. Register the module in `app.module.ts`

### Adding a new queue

1. Add the queue name constant to `QUEUE_NAMES` in `queues.module.ts`
2. Register it with `BullModule.registerQueue({ name: QUEUE_NAMES.YOUR_QUEUE })`
3. Create a producer service in `queues/producers/`
4. Create a processor extending `WorkerHost` in `queues/processors/`
5. Add the `@OnWorkerEvent('failed')` hook pointing to `DeadLetterService`
6. Add the queue to `QueueManagerService.getQueueMetrics()` for monitoring

### Adding a new OAuth provider

1. Install the Passport strategy: `npm install passport-<provider>`
2. Create `src/modules/auth/strategies/<provider>.strategy.ts`
3. Add credentials to `oauth.config.ts` and `config.validation.ts`
4. Add the strategy to `AuthModule` providers
5. Add initiation and callback routes to `oauth.controller.ts`

---

## Security Checklist

Before deploying to production, verify:

- [ ] All secrets in `.env` are unique, random, and at least 32 characters
- [ ] `NODE_ENV=production` is set (enables HTTPS-only cookies, strict CSP, removes Apollo Sandbox)
- [ ] MongoDB is not publicly accessible (firewall rules or VPC)
- [ ] Redis is password-protected (`requirepass` in `redis.conf`)
- [ ] S3 bucket blocks public access except for explicitly public prefixes
- [ ] `/admin/queues` (Bull Board) is behind IP allowlist or admin-only auth
- [ ] `/metrics` (Prometheus) is not publicly accessible (network policy or firewall)
- [ ] `ALERTS_WEBHOOK_URL` is configured so critical job failures page someone
- [ ] ClamAV signatures are updating automatically (`CLAMAV_NO_FRESHCLAMD=false`)
- [ ] Rate limiting thresholds are tuned for expected traffic patterns
- [ ] Grafana admin password is changed from the default

---

## License

MIT — use it, extend it, ship it.

---

<p align="center">Built across seven architectural phases · Annotated for understanding, not just copying</p>