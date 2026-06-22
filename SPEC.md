# Spec: Auth Mechanism Audit + Gap-Fill

## Objective

Goal of project: learn + cover all common web auth mechanisms. This spec audits
what nest-nexus already has, and specs the two missing mechanisms so coverage
is complete. OAuth providers (Google/GitHub/Microsoft) count as ONE mechanism
type ("OAuth/social login") per user's framing — not counted per-provider.

## Audit — Common Web Auth Mechanisms

| Mechanism | Status | Where |
|---|---|---|
| Password + JWT (access/refresh) | ✅ Implemented | `src/modules/auth/`, `token.service.ts`, `strategies/jwt.strategy.ts`, `strategies/jwt-refresh.strategy.ts` |
| Session-cookie auth | ✅ Implemented | `src/modules/session-auth/` (separate module per ADR-014) |
| OAuth / social login (single bucket) | ✅ Implemented + Microsoft to add | `src/modules/auth/oauth/` — Google + GitHub strategies. Microsoft specced below as Gap 3 |
| Magic link (passwordless email) | ✅ Implemented | `src/modules/auth/magic-link/` |
| 2FA / TOTP | ✅ Implemented | `src/modules/auth/two-factor/`, secret encrypted at rest (ADR-012) |
| API key auth | ❌ Missing | nothing found (`main.ts` hit was unrelated) |
| Passkey / WebAuthn | ❌ Missing | not present |

Out of scope per "common web mechanisms" framing (not specced): SAML SSO, mTLS,
SMS OTP, LDAP/Kerberos, biometric, device-code flow.

## Gap 1: API Key Auth

**Use case**: machine-to-machine / service-to-service calls that shouldn't carry
a user JWT (e.g. internal cron hitting REST endpoints, third-party webhooks).

**Design**:
- New table `ApiKey` (Prisma): `id`, `keyHash` (SHA-256, like magic-link tokens —
  no bcrypt, key is high-entropy random), `userId` or `serviceName`, `scopes: string[]`,
  `revokedAt`, `lastUsedAt`, `createdAt`.
- Raw key shown once on creation, never stored plaintext.
- New `ApiKeyGuard` in `src/common/guards/` following the context-aware pattern
  (`getRequest()` override for HTTP + GraphQL, per CLAUDE.md guard convention) —
  reads `X-API-Key` header, hashes, looks up, checks `revokedAt`/scopes.
- REST only (per CLAUDE.md API boundary — this is an infra/auth concern, not
  domain CRUD): `POST /auth/api-keys` (create, JWT-protected), `DELETE /auth/api-keys/:id` (revoke).
- Lives in `AuthModule` alongside other auth techniques (one controller:
  `ApiKeyController`), consistent with ADR-015 file-organization split.

## Gap 2: Passkey / WebAuthn

**Use case**: phishing-resistant, passwordless login using device biometrics/security keys.

**Design**:
- Library: `@simplewebauthn/server` (standard NestJS-compatible WebAuthn lib).
- New table `WebauthnCredential`: `id`, `userId`, `credentialId`, `publicKey`,
  `counter`, `transports`, `createdAt`.
- New `WebauthnController` in `src/modules/auth/webauthn/` (matches ADR-015 split):
  - `POST /auth/webauthn/register/options` (JWT-protected, generates challenge)
  - `POST /auth/webauthn/register/verify`
  - `POST /auth/webauthn/login/options` (`@Public()`)
  - `POST /auth/webauthn/login/verify` (`@Public()`, issues JWT pair on success)
- Challenge storage: short-TTL Redis key (reuse existing cache service), not DB.
- On successful login/verify, same JWT issuance path as `AuthService.login()`.

## Gap 3: Microsoft OAuth Provider

**Use case**: add Microsoft as third OAuth provider alongside existing Google/GitHub,
same bucket — no new auth *type*, just provider parity.

**Design**:
- New `MicrosoftStrategy` in `src/modules/auth/oauth/strategies/microsoft.strategy.ts`,
  mirrors `github.strategy.ts` exactly (same `OAuthProfile` shape, same `validate()` shape).
- Library: `passport-microsoft` (or `passport-azure-ad` if tenant-restricted login
  needed — default to `passport-microsoft` for simplicity, same as GitHub's `passport-github2`).
- `src/config/oauth.config.ts`: add `microsoftClientId`, `microsoftClientSecret`,
  `microsoftCallbackUrl` (default `http://localhost:3000/api/v1/auth/microsoft/callback`).
- `src/config/config.validation.ts`: add corresponding Zod fields (per CLAUDE.md config rule).
- `OAuthController` (`src/modules/auth/oauth/oauth.controller.ts`): add
  `GET /auth/microsoft` + `GET /auth/microsoft/callback`, mirroring GitHub routes.
- Register `MicrosoftStrategy` in `AuthModule` providers.

## Tech Stack

Existing: NestJS, Prisma/PostgreSQL, Redis, class-validator, Passport.
New dependencies: `@simplewebauthn/server` (+ `@simplewebauthn/types`) for Gap 2;
`passport-microsoft` for Gap 3.
No new dependency needed for Gap 1 (Node `crypto` only, mirrors magic-link).

## Commands

Build: `npm run build`
Test: `npm test`
Test (single file): `npm test -- <path>`
E2E: `docker-compose up -d postgres redis && npm run test:e2e`
Lint: `npm run lint`
Dev: `npm run start:dev`
Migrate: `npx prisma migrate dev`

## Project Structure (new files)

```
src/modules/auth/
├── api-key/
│   ├── api-key.controller.ts
│   ├── api-key.service.ts
│   ├── api-key.controller.spec.ts
│   ├── api-key.service.spec.ts
│   └── dto/create-api-key.input.ts
├── webauthn/
│   ├── webauthn.controller.ts
│   ├── webauthn.service.ts
│   ├── webauthn.controller.spec.ts
│   ├── webauthn.service.spec.ts
│   └── dto/webauthn-verify.input.ts
src/common/guards/
└── api-key.guard.ts (+ .spec.ts)
src/modules/auth/oauth/strategies/
└── microsoft.strategy.ts (+ .spec.ts)
prisma/schema.prisma  → add ApiKey, WebauthnCredential models
```

## Code Style

Match existing `magic-link.service.ts` pattern for token hashing:
```typescript
private hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}
```
Guards follow `session-auth.guard.ts` context-aware `getRequest()` pattern.
DTOs use `class-validator` decorators; output DTOs use `@Expose()` per CLAUDE.md
serialization rule. No raw `process.env` — all config via `ConfigService`.

## Testing Strategy

Unit tests mock `PrismaService` (no real DB), following existing
`*.service.spec.ts` / `*.controller.spec.ts` pairs in `src/modules/auth/`.
Add E2E coverage in `test/` for: API key happy-path + revoked-key rejection;
WebAuthn registration + login ceremony (mock the browser-side attestation/assertion
per `@simplewebauthn` test utilities).

## Boundaries

- **Always**: emit `EventEmitter2` events on key/credential creation+revocation
  (no direct `cacheService.del()`, per CLAUDE.md cache rule); update
  `config.validation.ts` if new env vars added (e.g. WebAuthn RP ID/origin).
- **Ask first**: adding `@simplewebauthn/server`/`passport-microsoft` dependencies; any change to
  `prisma/schema.prisma`; any change to existing auth flows (JWT/session/OAuth/2FA/magic-link).
- **Never**: store API keys or WebAuthn challenges in plaintext beyond their
  short TTL; touch `TokenService.rotateRefreshToken()` step ordering (ADR-002 invariant).

## Success Criteria

- API key: valid key authenticates REST request via `ApiKeyGuard`; revoked key
  returns 401; key never logged/returned after creation response.
- WebAuthn: user can register a credential and log in with it standalone
  (no password fallback needed for that login attempt); replay of same
  assertion counter rejected.
- All new unit + e2e tests pass; `npm run lint` clean.

## Decisions (resolved)

1. API key scopes: freeform `string[]`.
2. WebAuthn: single-credential first cut (multi-device deferred).
3. Microsoft OAuth: `passport-microsoft`.

## Tasks (priority order: easiest → highest learning value)

- [ ] Task 1: Microsoft OAuth strategy
  - Acceptance: `GET /auth/microsoft` redirects to MS login; callback issues JWT
    pair same as Google/GitHub; `microsoft.strategy.spec.ts` covers `validate()`.
  - Verify: `npm test -- microsoft.strategy`, manual OAuth round-trip in browser.
  - Files: `src/modules/auth/oauth/strategies/microsoft.strategy.ts` (+ .spec.ts),
    `src/modules/auth/oauth/oauth.controller.ts`, `src/config/oauth.config.ts`,
    `src/config/config.validation.ts`, `src/modules/auth/auth.module.ts`.

- [ ] Task 2: API key auth
  - Acceptance: `POST /auth/api-keys` (JWT-protected) returns raw key once;
    `ApiKeyGuard` accepts valid `X-API-Key`, rejects missing/revoked/unknown key (401);
    `DELETE /auth/api-keys/:id` revokes; key hash only, never plaintext at rest.
  - Verify: `npm test -- api-key`, e2e happy-path + revoked-key rejection test.
  - Files: `prisma/schema.prisma` (ApiKey model), `src/modules/auth/api-key/*`,
    `src/common/guards/api-key.guard.ts` (+ .spec.ts).

- [ ] Task 3: Passkey / WebAuthn
  - Acceptance: register flow stores credential; login flow verifies assertion
    and issues JWT pair without password; replayed counter rejected.
  - Verify: `npm test -- webauthn`, e2e ceremony test using `@simplewebauthn` test utils.
  - Files: `prisma/schema.prisma` (WebauthnCredential model),
    `src/modules/auth/webauthn/*`, RP ID/origin env vars in
    `src/config/*.config.ts` + `config.validation.ts`.
