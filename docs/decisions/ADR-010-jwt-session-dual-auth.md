# ADR-010: JWT + express-session Dual Authentication

## Status
Accepted

## Date
2026-06-16

## Context
The boilerplate must serve multiple consumer types with different session-management needs:

- **API / SPA clients** — stateless; prefer Bearer tokens; can store and rotate
  refresh tokens client-side (or let the HttpOnly cookie handle it)
- **Server-rendered / traditional web clients** — prefer a single HttpOnly session cookie;
  no client-side token management; session state lives on the server
- **OAuth flows** (Google, GitHub) — inherently redirect-based; Passport's OAuth strategies
  attach the authenticated user to `req.user` between the initiation step (`/auth/google`)
  and the callback step (`/auth/google/callback`); this cross-redirect state is managed
  internally by Passport via express-session

Having only JWT would force SSR clients to handle token rotation themselves — a non-trivial
security concern. Having only sessions would lose the statelessness that makes JWT
attractive for API clients and horizontally scaled services.

## Decision
Support both mechanisms as first-class, parallel auth flows:

**JWT flow** (`/auth/login`, `/auth/register`, `/auth/refresh`, `/auth/logout`):
- Access token in `Authorization: Bearer` header (15-minute TTL)
- Refresh token in `refresh_token` HttpOnly cookie
- Rotation follows the token family model (ADR-002)
- Used by most REST endpoints

**Session flow** (`/auth/session/login`, `/auth/session/logout`):
- `express-session` with `connect-pg-simple` as the PostgreSQL-backed store
- Session cookie is HttpOnly and `sameSite: lax`
- Session is regenerated after login to prevent session fixation
- User payload stored in `req.session.user` — no tokens issued
- Targets traditional web apps that cannot handle Bearer token rotation

**OAuth flow** (`/auth/google`, `/auth/google/callback`, `/auth/github`, `/auth/github/callback`):
- Passport manages OAuth state (CSRF-state parameter) via express-session internally
- On callback, Passport populates `req.user` with the OAuth profile
- `AuthService.oauthLogin()` maps the profile to an internal user and issues JWT tokens
- Final output is JWT (same as the JWT flow) — the session is used only for OAuth state,
  not as the ongoing auth mechanism

**2FA pending scope**:
- When 2FA is enabled, initial login issues a short-lived JWT with `scope: 'two_factor_pending'`
- Only `POST /auth/2fa/verify` accepts this scoped token (enforced by `@AllowPending2FA()`)
- On successful TOTP verification, a full-scope JWT pair is issued

The `SessionSerializer` (Passport's `serializeUser`/`deserializeUser`) is registered but
dormant — `passport.session()` middleware is not active. It is in place for future
activation if Passport-native session mode is needed.

## Alternatives Considered

### JWT only (no sessions)
- Pros: Stateless; no server-side session store needed; simpler infrastructure
- Cons: OAuth state cannot survive the redirect without some server-side storage;
  `passport-google-oauth20` uses express-session to persist OAuth state — removing
  sessions would require implementing a custom stateless PKCE flow; SSR clients
  are forced to manage token rotation client-side, which is error-prone
- Rejected: OAuth support without sessions requires reimplementing what Passport
  provides; SSR client experience is significantly worse

### Sessions only (no JWT)
- Pros: Simple, well-understood; no token rotation logic
- Cons: Every request hits the session store (PostgreSQL) — adds latency for
  high-throughput API paths; incompatible with the stateless horizontal scaling
  goal for the API surface; SPA/mobile clients typically use Bearer tokens
- Rejected: Session-store lookup on every API request is unnecessary overhead;
  the API surface is designed for stateless clients

### Cookie-based JWT (JWT in HttpOnly cookie, no refresh rotation)
- Pros: SPA doesn't handle tokens explicitly; no CSRF risk if `sameSite: strict`
- Cons: Short-lived access tokens in cookies must be refreshed silently — requires
  either iframe-based refresh (CORS complexity) or rotating-cookie approach that is
  equivalent to the current HttpOnly refresh-cookie strategy; CSRF protection still
  needed for mutation endpoints
- Rejected: The current approach (Bearer access token + HttpOnly refresh cookie)
  provides the same XSS protection with simpler client-side handling

## Consequences
- `express-session` + `connect-pg-simple` are required dependencies. The session table
  is created automatically on first boot (`createTableIfMissing: true`) — no manual
  migration needed.
- The `JwtAuthGuard` covers all REST routes. Session endpoints are guarded
  separately — `@Public()` is set on session routes because they use `req.session`
  directly, not the JWT guard's `req.user`.
- Any new OAuth provider (e.g., Twitter, Apple) follows the same pattern: add a Passport
  strategy, register two REST endpoints, and call `authService.oauthLogin()` in the
  callback — the JWT issuance path is shared.
- The 2FA pending scope must be checked in `JwtAuthGuard.canActivate()` via
  `@AllowPending2FA()`. Do not accept `scope: 'two_factor_pending'` tokens on any
  other endpoint.
