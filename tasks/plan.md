# Test Coverage Plan

Generated from coverage audit. Priority: security-critical first, then descending risk.

## Tasks

- [ ] **T1** — Unit tests for `totp-crypto.util.ts` (`encryptTotpSecret` / `decryptTotpSecret`)
- [ ] **T2** — Unit tests for `TwoFactorService` (setup, enable, disable, verify, backup codes)
- [ ] **T3** — Unit tests for `MagicLinkService` (send, verify, single-use invariant)
- [ ] **T4** — Extend `auth.service.spec.ts`: `oauthLogin()` and `issueTokens()` branches
- [ ] **T5** — Extend `users.service.spec.ts`: cache hit/miss and event emission assertions
- [ ] **T6** — Unit tests for `EmailProcessor` (job routing, dead-letter on final attempt)
- [ ] **T7** — Unit tests for `AuthController` REST endpoints (2FA verify scope, session flows, OAuth callback, magic-link routes)
- [ ] **T8** — Unit tests for `NotificationService` (SSE subscribe/cleanup, sendToUser, broadcast, event handlers)
- [ ] **T9** — Unit tests for `TokenService.generatePendingTwoFactorToken()`

## Acceptance criteria per task

### T1 — totp-crypto.util.ts
- `encryptTotpSecret` output starts with `enc:`
- Round-trip: encrypt then decrypt returns original secret
- Two calls with same input produce different ciphertext (random IV)
- `decryptTotpSecret` with no `enc:` prefix returns value as-is (legacy passthrough)
- `decryptTotpSecret` with wrong key throws

### T2 — TwoFactorService
- `setup()`: throws NotFoundException for unknown user; stores encrypted secret; returns secret + otpauthUrl + qrCodeDataUrl
- `enable()`: throws BadRequestException if no setup; throws ConflictException if already enabled; throws UnauthorizedException on bad TOTP; returns 10 backup codes on success; stores hashed backup codes
- `disable()`: throws BadRequestException if not enabled; throws UnauthorizedException on bad code; clears secret + backup codes on success
- `verify()`: returns true for valid TOTP; returns true for valid backup code; backup code is single-use (removed after use); returns false for invalid code; returns false if 2FA not enabled

### T3 — MagicLinkService
- `send()`: generates token, hashes it, stores hash; sets 15 min expiry; enqueues MAGIC_LINK email job; silently returns on P2025 (user not found); propagates non-P2025 errors
- `verify()`: returns userId on valid token; clears token after use; throws UnauthorizedException for invalid/expired token

### T4 — AuthService (extensions)
- `oauthLogin()`: existing provider → returns auth; email match links provider; no match creates new user; deactivated user throws ForbiddenException; 2FA-enabled user returns pending token; P2002 on create throws ConflictException; P2025 on update link → creates new user
- `issueTokens()`: returns full auth for active user; throws NotFoundException for unknown/inactive user

### T5 — UsersService (extensions)
- `findAll()`: cache hit skips DB call; cache miss populates cache
- `findById()`: cache hit skips DataLoader call; cache miss populates cache
- `update()`: emits `user.updated` event with userId
- `deactivate()`: emits `user.deactivated` event with userId

### T6 — EmailProcessor
- Routes each EmailJobName to correct private sender
- Unknown job name throws Error
- `onFailed()`: calls deadLetter on final attempt; silent on non-final attempt; no-op when job is undefined

### T7 — AuthController
- `POST /auth/refresh`: throws 401 when cookie missing
- `POST /auth/session/login`: returns 401 with TWO_FACTOR_REQUIRED when 2FA pending; regenerates session on success; stores user in session
- `POST /auth/session/logout`: destroys session
- `GET /auth/me`: returns current user payload
- `POST /auth/2fa/verify`: throws 401 on invalid code; issues full token pair + sets cookie on success
- `POST /auth/magic-link/send`: always returns 200 message
- `GET /auth/magic-link/verify`: sets cookie and returns auth on success
- OAuth callback: sets cookie, redirects to clientOrigin with token fragment

### T8 — NotificationService
- `subscribeSSE()`: adds client to map; multiple clients per user supported; cleanup removes client on unsubscribe; map entry deleted when last client leaves
- `sendToUser()`: delivers event to all clients for user; no-op when user has no clients
- `broadcast()`: delivers to all users' clients
- `onUserUpdated()`: calls sendToUser with correct type
- `onUserDeactivated()`: calls sendToUser with correct type

### T9 — TokenService (extension)
- `generatePendingTwoFactorToken()`: signs token with correct payload (sub, scope: 'two_factor_pending'); uses access secret; returns string
