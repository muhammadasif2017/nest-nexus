# Manual Test Scenarios — nest-nexus

## Features

| # | Feature | File |
|---|---------|------|
| 1 | JWT Auth (register · login · refresh · logout) | [01-auth-jwt.md](01-auth-jwt.md) |
| 2 | OAuth2 — Google & GitHub | [02-auth-oauth.md](02-auth-oauth.md) |
| 3 | Two-Factor Auth — TOTP + backup codes | [03-auth-2fa.md](03-auth-2fa.md) |
| 4 | Magic Link login | [04-auth-magic-link.md](04-auth-magic-link.md) |
| 5 | Session-based auth + CSRF | [05-auth-session.md](05-auth-session.md) |
| 6 | User profile (REST) | [06-users.md](06-users.md) |
| 9 | Health checks + Prometheus metrics | [09-health-metrics.md](09-health-metrics.md) |
| 10 | API key auth (M2M) | [10-auth-api-key.md](10-auth-api-key.md) |
| 11 | Passkey / WebAuthn login | [11-auth-webauthn.md](11-auth-webauthn.md) |

## Setup

```bash
BASE=http://localhost:3000
```

Start the server:
```bash
npm run start:dev
```

### Postman

1. Open Postman → **Import** → select any `.md` file to read the raw requests,
   or create an **Environment** with variable `BASE_URL = http://localhost:3000`.
2. Requests that need a `Bearer` token: set **Auth → Bearer Token** to `{{ACCESS_TOKEN}}`.
3. Requests that set cookies (login, register): enable **Postman → Settings → Automatically
   follow redirects** and **Send cookies**.
4. CSRF-protected session routes need the `X-CSRF-Token` header — see [05-auth-session.md](05-auth-session.md).

### curl tips

- All examples use `BASE=http://localhost:3000` and `TOKEN=<your access token>`.
- Add `-v` to any curl call to inspect response headers and cookies.
- Add `-c cookies.txt -b cookies.txt` to persist cookies across calls.
