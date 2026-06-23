# Nexus

> What does it take to support six authentication methods in one NestJS backend — OAuth, 2FA, passkeys, magic links, API keys, and sessions? I built them to find out.

Most backends ship one auth flow and call it done. Nexus implements six —
OAuth2, TOTP 2FA, magic links, WebAuthn/passkeys, API keys, and server-side
sessions — alongside a hardened JWT core with refresh-token rotation and
family-based reuse detection.

The auth lives in a realistic setting: Postgres/Prisma, Redis, BullMQ queues
with dead-letter handling, S3 storage, and a full Prometheus/Grafana
observability stack — the infrastructure a real service runs on, so the auth
flows are tested against production-shaped concerns rather than a toy harness.

This is a reference implementation, not a clone-and-start template — there is
deliberately no business domain, because the subject *is* authentication. The
API surface is REST, documented with OpenAPI/Swagger.

---

## What's Inside

| Layer | Technology | Purpose |
|---|---|---|
| **Framework** | NestJS 11 | Module system, DI container, decorators |
| **Database** | PostgreSQL + Prisma v7 | Primary data store with type-safe, generated client |
| **Query Insights** | @prisma/sqlcommenter | SQL comment annotations for Cloud SQL Query Insights |
| **API** | REST (Swagger/OpenAPI) | Versioned REST surface with generated OpenAPI docs |
| **Real-time** | Socket.io + SSE | WebSocket gateway + server-sent events |
| **Auth** | JWT + Sessions + OAuth2 | Hybrid authentication, token rotation |
| **2FA** | TOTP (otplib) | Authenticator app support with backup codes |
| **Passwordless** | Magic links | Email-based authentication |
| **Cache** | Redis (ioredis) | Application cache + BullMQ backbone |
| **Queues** | BullMQ | Background jobs, retries, dead-letter |
| **Scheduler** | @nestjs/schedule | Cron jobs with distributed locking |
| **Storage** | AWS S3 / MinIO | Direct upload, ownership-scoped delete, presigned GET URLs |
| **Images** | Sharp | Avatar resize to WebP, magic-byte type validation |
| **Scanning** | ClamAV | Inline virus scanning of uploads before storage |
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

Open `.env` and fill in the required values. The four you must set before anything works:

```bash
SESSION_SECRET=     # 64-char random hex: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
JWT_SECRET=         # 64-char random hex (different from SESSION_SECRET)
JWT_REFRESH_SECRET= # 64-char random hex (different from both above)
DATABASE_URL=       # postgresql://user:password@localhost:5432/nest_nexus
```

Everything else has a safe default for local development.

### 3. Start the infrastructure

```bash
# Start PostgreSQL, Redis, MinIO, and ClamAV
docker-compose up -d postgres redis minio clamav

# Verify all services are healthy
docker-compose ps
```

### 4. Run database migrations

```bash
# Apply all migrations and generate the Prisma client
npx prisma migrate dev

# (First run only) If the database does not exist yet, Prisma will create it
```

### 5. Run the application

```bash
# Development (hot reload)
npm run start:dev

# Production build
npm run build && npm start
```

### 6. Verify it's working

```bash
# Health check
curl http://localhost:3000/api/v1/health/ready

# Swagger API docs
open http://localhost:3000/api/docs

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
│   ├── database.config.ts           # DATABASE_URL for Prisma
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
│   ├── filters/                     # GlobalExceptionFilter (consistent REST envelope)
│   ├── guards/                      # JwtAuthGuard, RolesGuard
│   └── interceptors/                # LoggingInterceptor, SerializeInterceptor
│
├── core/                            # Infrastructure modules
│   ├── prisma/                      # PrismaService wrapper, @Global()
│   ├── cache/                       # Redis CacheModule + CacheInvalidationService
│   ├── redis/                       # Shared Redis connection
│   ├── logger/                      # Pino logger with request redaction
│   ├── events/                      # EventEmitter2 (wildcard, global)
│   ├── queues/                      # BullMQ email queue, processor, dead-letter
│   ├── scheduler/                   # Cron jobs with distributed Redis locking
│   ├── storage/                     # S3/MinIO abstraction, Sharp, ClamAV
│   ├── mailer/                      # Email sending
│   ├── health/                      # Terminus liveness + readiness + deep checks
│   └── metrics/                     # Prometheus metrics + HTTP interceptor
│
└── modules/                         # Feature modules — auth-focused, no business domain
    ├── auth/                        # JWT, OAuth2 (Google/GitHub/Microsoft), TOTP, magic links, WebAuthn, API keys
    ├── session-auth/                # Server-side session login (separate module)
    ├── users/                       # REST controller, serialization
    └── notifications/               # WebSocket gateway, SSE, fan-out delivery

prisma/
├── schema.prisma                    # Models: User, RefreshToken, OauthProvider, WebauthnCredential, ApiKey
├── prisma.config.ts                 # Prisma 7 runtime config (DATABASE_URL, migrations path)
└── migrations/                      # Auto-generated SQL migrations (committed to version control)
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
(server-side sessions in PostgreSQL via `connect-pg-simple`) serves traditional web clients
where the server holds state. Both paths share the same `AuthService` and converge on the same
`req.user` object that guards and decorators read from.

### Refresh token rotation with reuse detection

Every successful refresh issues a new refresh token and invalidates the old one. If an
already-used token is presented — the signature of a stolen token being replayed — the
entire token *family* is immediately revoked, forcing a full re-login. The family concept
means a single stolen token can't silently persist access; the moment it's used, the
legitimate user's next refresh triggers full revocation.

Tokens are stored as bcrypt hashes (cost 8) in a dedicated `RefreshToken` table with a
FK to `User`. Cost 8 (vs 12 for passwords) is intentional: cryptographically random tokens
derive their brute-force resistance from entropy, not work factor — keeping rotation latency
low while remaining storage-safe against database compromise.

### Guards read the request uniformly

`JwtAuthGuard` and `RolesGuard` resolve `req.user` through a shared helper, so the same
guard works across every REST controller. WebSocket connections handle authentication
manually in `handleConnection()` because HTTP guards don't run after the WebSocket upgrade.

### The exception filter returns one consistent envelope

A single `GlobalExceptionFilter` catches everything and returns a consistent JSON envelope:
status code, `errorCode`, message, path, and timestamp. Internal 5xx details are masked in
production so stack traces and database structure never leak to clients.

Prisma errors are translated automatically: `P2002` (unique constraint) → 409 Conflict,
`P2025` (record not found on update/delete) → 404 Not Found.

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

### File uploads are virus-scanned before storage

Two endpoints, both JWT-protected. File bytes flow through NestJS → S3 (direct upload):

- **`POST /upload/avatar`** (max 5MB): ClamAV scan → Sharp resize to a 256×256 WebP →
  upload to `avatars/{userId}/`. Image type is validated by **magic bytes**, not the
  client-supplied `Content-Type`.
- **`POST /upload/file`** (max 20MB): ClamAV scan → store as-is under `uploads/{userId}/`.
- **`DELETE /upload/*`**: ownership-checked — the key must be prefixed with the caller's
  own `avatars/{userId}/` or `uploads/{userId}/`, else `403`.

The `StorageService` wraps S3 (or MinIO locally) and can also issue presigned GET URLs for
reads. Files are not tracked in a database table — the S3 key is the record.

### BullMQ jobs have a two-layer failure strategy

Layer 1 is automatic retry with exponential backoff — handles transient failures (network
blips, momentary Redis timeouts). Layer 2 is the dead-letter store — on final failure,
the job is persisted, classified by error type (transient, permanent, external),
and an alert is fired for critical queues. Operators can inspect, acknowledge, and replay
dead-letter jobs without touching the database directly.

---

## Authentication Flows

### JWT Login

```
POST /api/v1/auth/login
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
    → Find matching bcrypt hash in RefreshToken table (WHERE userId + family)
    → REUSE DETECTED? → revoke entire token family → force re-login
    → Mark old token isRevoked=true → issue new token pair
  → New refresh token → replaces HttpOnly cookie
  → New access token → response body
```

### OAuth2 (Google / GitHub / Microsoft)

```
GET /api/v1/auth/google          → redirects to Google consent screen
GET /api/v1/auth/google/callback → Passport verifies, OAuthService upserts OauthProvider row
                                 → issues token pair → redirects to frontend
                                   with access token as query param (?token=...)

GitHub and Microsoft follow the same pattern: /auth/github(/callback), /auth/microsoft(/callback)
```

### TOTP Two-Factor

```
POST /api/v1/auth/2fa/setup    → returns QR code URI + raw secret (secret stored encrypted)
POST /api/v1/auth/2fa/enable   → verifies first code → enables 2FA → returns backup codes
POST /api/v1/auth/2fa/disable  → verifies a code → disables 2FA

On login (2FA enabled):
  → Password valid → issue 2FA pending token (scope: 'two_factor_pending')
  → POST /api/v1/auth/2fa/verify → code valid → issue full auth tokens
```

---

## Real-Time Architecture

### WebSocket (bidirectional, persistent)

```
Client                              Server
  │                                    │
  ├─ connect({ auth: { token } }) ────→│ handleConnection()
  │                                    │   verify JWT manually
  │                                    │   join private room 'user:{userId}'
  │                                    │
  │←── notification ───────────────────│ server.to('user:{id}').emit(...)
  │                                    │   Redis adapter fans out across instances
  │
  ├─ ping ────────────────────────────→│ @SubscribeMessage('ping')
  ├─ join:room ───────────────────────→│ @SubscribeMessage('join:room')
  │←── room:joined ────────────────────│   own user room only (authorization check)
```

### SSE (unidirectional)

```
GET /api/v1/notifications/stream  (@Sse)
  → Creates a per-user RxJS Subject
  → Returns Observable<MessageEvent> (NestJS keeps the connection open)
  → Pushes events as they occur; cleans up the Subject on client disconnect
```

---

## Queue Architecture

### Job lifecycle

```
producer.add(jobName, data)
  → BullMQ.add with default options (attempts: 3, exponential backoff from 2s,
    removeOnComplete: keep last 100)

Worker.process()
  → Exponential backoff retry on failure
  → On final failure (attemptsMade >= maxAttempts):
      → DeadLetterService.handleFailedJob() — persists the failed job for inspection
```

### Queues

One queue is implemented: `email` (concurrency 5), handling welcome, password-reset,
email-verification, 2FA-code, and magic-link messages. Virus scanning and avatar
processing run **synchronously** in the upload request, not via queues.

| Queue | Concurrency | Purpose |
|---|---|---|
| `email` | 5 | Welcome, password reset, email verification, 2FA code, magic link |

---

## Image Processing

`ImageService` (Sharp) handles avatar uploads:

- **Magic-byte validation** — the file's real type is read from its leading bytes,
  not trusted from the client `Content-Type` (JPEG/PNG/GIF/WebP allowed).
- **Avatar resize** — 256×256, `fit: cover`, re-encoded to WebP (quality 80).
- A generic `resize(width, height)` helper (aspect-preserved WebP) is also available
  for other callers.

Sharp re-encodes to WebP, which drops the original EXIF in the process. Multi-variant
generation and LQIP placeholders are not implemented.

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

Two custom application metrics, plus the default Node.js/process metrics that
`prom-client` collects automatically:

| Metric | Type | Captures |
|---|---|---|
| `http_requests_total` | Counter | Request count by method / route / status |
| `http_request_duration_seconds` | Histogram | Per-request latency (for P50/P99) |
| `nodejs_*`, `process_*` | (default) | Heap, event-loop lag, CPU, memory (prom-client defaults) |

### Grafana dashboard

One dashboard is pre-provisioned (loads at startup, no manual import):

- **HTTP** — request rate, error rate (4xx/5xx), latency P50/P99, error-rate %
- **Node.js Runtime** — memory, CPU usage

---

## Environment Variables

See `.env.example` for the complete annotated reference. Required variables:

```bash
SESSION_SECRET          # 64-char random hex
JWT_SECRET              # 64-char random hex
JWT_REFRESH_SECRET      # 64-char random hex (different from JWT_SECRET)
DATABASE_URL            # postgresql://user:password@host:5432/dbname
```

Optional variables enable additional features:

```bash
GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET    # Enables Google OAuth
GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET    # Enables GitHub OAuth
MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET # Enables Microsoft OAuth
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

npx prisma migrate dev          # Create and apply a new migration (dev)
npx prisma migrate deploy       # Apply pending migrations (CI / production)
npx prisma studio               # Browse and edit data in the browser
npx prisma generate             # Regenerate the Prisma client after schema changes
```

---

## Docker Commands

```bash
# Start full local stack
docker-compose up -d

# Start only infrastructure (run app locally for hot reload)
docker-compose up -d postgres redis minio clamav

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

## Extending the Project

Nexus isn't a template to clone — but the extension points are documented here
because building each seam cleanly was part of the exercise, and because a
reader (or future me) should be able to see how a new module, queue, or OAuth
provider slots in. The feature-module steps below use a hypothetical `orders`
module purely to illustrate the pattern; no business domain actually exists.

### Adding a new feature module

```bash
# NestJS CLI generates the module scaffold
nest generate module modules/orders
nest generate service modules/orders
nest generate controller modules/orders
```

Follow the existing module pattern:

1. Add the model to `prisma/schema.prisma`
2. Run `npx prisma migrate dev --name add-orders` to generate and apply the migration
3. Define input DTOs in `dto/` with class-validator decorators
4. Define the output DTO in `dto/` with `@Expose()`
5. Implement the service — inject `PrismaService` directly (it's `@Global()`)
6. Emit domain events via `EventEmitter2` after every mutation
7. Implement the controller
8. Register the module in `app.module.ts`

### Adding a new queue

1. Add the queue name constant to `src/queues/queues.constants.ts`
2. Register it with `BullModule.registerQueue({ name: QUEUE_YOUR_QUEUE })` in `QueuesModule`
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
- [ ] `NODE_ENV=production` is set (enables HTTPS-only cookies, strict CSP, removes Swagger UI and Bull Board)
- [ ] PostgreSQL is not publicly accessible (firewall rules or VPC)
- [ ] Redis is password-protected (`requirepass` in `redis.conf`)
- [ ] S3 bucket blocks public access except for explicitly public prefixes
- [ ] `/admin/queues` (Bull Board) is behind IP allowlist or admin-only auth
- [ ] `/metrics` (Prometheus) is not publicly accessible (network policy or firewall)
- [ ] `ALERTS_WEBHOOK_URL` is configured so critical job failures page someone
- [ ] ClamAV signatures are updating automatically (`CLAMAV_NO_FRESHCLAMD=false`)
- [ ] Rate limiting thresholds are tuned for expected traffic patterns
- [ ] Grafana admin password is changed from the default
- [ ] `prisma migrate deploy` (not `migrate dev`) is used in production CI pipelines

---

## License

MIT — use it, extend it, ship it.

---

<p align="center">Built across seven architectural phases · Annotated for understanding, not just copying</p>
