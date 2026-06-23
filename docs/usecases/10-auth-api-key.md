# Auth — API Key

Base URL: `http://localhost:3000`

## Use cases

- **M2M / service calls** — cron jobs, internal scripts, or other services calling REST
  endpoints without a real user login.
- **Third-party webhooks** — an external service authenticates back to this API with a
  key instead of OAuth/JWT.
- **CI/CD integrations** — pipeline scripts hitting deploy hooks, health checks, etc.
- **Scoped, revocable, long-lived access** — unlike a JWT (short-lived, login-bound), a
  key is long-lived but instantly revocable and scoped (`scopes: string[]`).
- **No login flow needed** — useful whenever the caller isn't a human.

## Status in this app

`ApiKeyService` + `ApiKeyController` (create/revoke) + `ApiKeyGuard` are implemented and
unit-tested.

**Wired:** `/api/queues` (Bull Board admin UI, dev-only) — was previously unauthenticated,
now gated by `createApiKeyExpressMiddleware()` (`src/common/guards/api-key.guard.ts`),
mounted in `main.ts` ahead of the Bull Board router. Bull Board sits outside Nest's
request pipeline (it's a raw Express router), so `@UseGuards(ApiKeyGuard)` can't apply
directly — the middleware factory reuses the exact same `ApiKeyService.validate()` call.

**Not wired** (candidates found during the `main.ts` audit, left for a future decision):

| Route | Why it's a candidate |
|---|---|
| `/metrics` (Prometheus scrape) | No auth today — gate to the scrape client only |
| `/upload/avatar`, `/upload/file` | JWT-only today; could allow a backend service to upload on a user's behalf |
| `/health/deep` | Exposes internal dependency status; lower priority — `/live` and `/ready` must stay public for orchestrators |

---

## 1. Create an API key

**POST** `/api/v1/auth/api-keys` (JWT-protected)

```bash
TOKEN="<paste accessToken here>"
curl -s -X POST http://localhost:3000/api/v1/auth/api-keys \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"scopes":["read","write"]}' | jq
```

**Expect:** `201` with `{ apiKey: "<64-char hex>" }`. The raw key is shown **once** — it
is never returned again. Save it.

**Verify:**
- Response contains `apiKey`, not `keyHash` (raw key only, never the hash)
- DB only ever stores the SHA-256 hash (`prisma/schema.prisma` → `ApiKey.keyHash`)

---

## 2. Use the key (Bull Board, dev-only)

```bash
API_KEY="<paste apiKey from step 1>"
curl -s http://localhost:3000/api/queues \
  -H "X-API-Key: $API_KEY" | jq
```

**Negative:**
```bash
# Missing header → 401
curl -s http://localhost:3000/api/queues | jq

# Unknown/garbage key → 401
curl -s http://localhost:3000/api/queues -H "X-API-Key: not-a-real-key" | jq
```

---

## 3. Revoke a key

**DELETE** `/api/v1/auth/api-keys/:id` (JWT-protected)

```bash
KEY_ID="<id of the key to revoke>"
curl -s -X DELETE http://localhost:3000/api/v1/auth/api-keys/$KEY_ID \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expect:** `204 No Content`.

**Verify:**
- Using the revoked key afterward returns `401`
- Revoking someone else's key (wrong owner) returns `404`, not `403` — existence isn't
  leaked across users
