# Health Checks + Prometheus Metrics

All health endpoints are public (no auth required) and excluded from rate limiting.

---

## Health Checks

### 1. Liveness probe

**GET** `/api/v1/health/live`

```bash
curl -s http://localhost:3000/api/v1/health/live | jq
```

**Expect (healthy):**
```json
{
  "status": "ok",
  "info": { "memory_heap": { "status": "up" } },
  "error": {},
  "details": { "memory_heap": { "status": "up" } }
}
```

**HTTP status:** `200` when healthy, `503` when unhealthy.

**Use case:** Kubernetes liveness probe — restart pod if this fails.

**Postman:** Method: **GET** → `{{baseUrl}}/api/v1/health/live` — no auth, no body. All health endpoints follow the same pattern.

---

### 2. Readiness probe

**GET** `/api/v1/health/ready`

```bash
curl -s http://localhost:3000/api/v1/health/ready | jq
```

**Expect:**
```json
{
  "status": "ok",
  "info": {
    "database": { "status": "up" },
    "redis": { "status": "up" }
  }
}
```

**Use case:** Kubernetes readiness probe — remove pod from load balancer if DB/Redis is down.

**Simulate DB failure:**
```bash
# Stop PostgreSQL temporarily, then:
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/health/ready
# Expect 503
```

---

### 3. Deep health check

**GET** `/api/v1/health/deep`

```bash
curl -s http://localhost:3000/api/v1/health/deep | jq
```

**Expect:** All four checks passing:
```json
{
  "status": "ok",
  "info": {
    "database": { "status": "up" },
    "redis":    { "status": "up" },
    "memory":   { "status": "up" },
    "disk":     { "status": "up" }
  }
}
```

**Verify thresholds:**
- `memory`: heap usage below 512 MB (or configured threshold)
- `disk`: usage below 90% of storage

---

### 4. Health check HTTP status codes

```bash
# All three should return 200 when healthy
for PROBE in live ready deep; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/v1/health/$PROBE)
  echo "$PROBE: $STATUS"
done
```

**Expect:** All `200`.

---

## Prometheus Metrics

### 5. Scrape metrics endpoint

**GET** `/metrics`  
Note: No `/api/v1` prefix — Prometheus expects bare `/metrics`.

```bash
curl -s http://localhost:3000/metrics
```

**Expect:** Prometheus text format output, e.g.:
```
# HELP http_requests_total Total number of HTTP requests
# TYPE http_requests_total counter
http_requests_total{method="GET",path="/api/v1/health/live",status="200"} 3

# HELP http_request_duration_seconds HTTP request duration in seconds
# TYPE http_request_duration_seconds histogram
http_request_duration_seconds_bucket{le="0.005",...} 10
```

**Verify specific metrics exist:**
```bash
curl -s http://localhost:3000/metrics | grep "http_requests_total"
curl -s http://localhost:3000/metrics | grep "http_request_duration_seconds"
curl -s http://localhost:3000/metrics | grep "nodejs_"
```

---

### 6. Metrics increment after requests

```bash
# Baseline count
BEFORE=$(curl -s http://localhost:3000/metrics | grep 'http_requests_total{.*"200"' | awk '{print $2}')

# Make some requests
for i in {1..5}; do
  curl -s http://localhost:3000/api/v1/health/live > /dev/null
done

# Check count increased
AFTER=$(curl -s http://localhost:3000/metrics | grep 'http_requests_total{.*"200"' | awk '{print $2}')
echo "Before: $BEFORE, After: $AFTER"
# AFTER should be BEFORE + 5 (or more if other requests arrived)
```

---

## Dev-Only Endpoints

These only exist when `NODE_ENV !== production`.

### 7. Swagger UI

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/docs
# Expect 200 in dev, 404 in production
```

**Browser:** Navigate to `http://localhost:3000/api/docs` — interactive REST API docs.

**Postman alternative:** Swagger UI at `/api/docs` also exposes a **Try it out** button for every REST endpoint — useful if you want to test auth flows without setting up the collection manually.

### 8. Bull Board (queue monitoring)

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/queues
# Expect 200 in dev
```

**Browser:** Navigate to `http://localhost:3000/api/queues` — view email queue jobs,
retry failed jobs, inspect job payloads.

**Verify after sending a magic link:**
1. Go to `http://localhost:3000/api/queues`
2. Find the `email` queue
3. See the `magic-link` job — status should be `completed` (or `failed` if SMTP not configured)
4. Click the job to see payload: `{ to, displayName, magicLink, expiresInMinutes }`
