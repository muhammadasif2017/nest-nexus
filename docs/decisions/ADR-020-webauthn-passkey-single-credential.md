# ADR-020: WebAuthn/Passkey Login — Single Credential, Cache-Backed Challenges

## Status
Accepted

## Date
2026-06-22

## Context
The app had password+JWT, session, OAuth, 2FA/TOTP, and magic links — all phishable to
some degree (password can be entered on a fake site; TOTP codes can be relayed in
real-time; magic links can be intercepted via email compromise). WebAuthn/passkeys are
the one mechanism in the common-auth-mechanism set that's phishing-resistant by
construction (the browser binds the credential to the actual origin, not whatever the
user is told the origin is).

Two design questions needed answers before implementation:
1. How many credentials per user — one, or many (multi-device)?
2. Where do the registration/login challenges live during the handshake — DB or cache?

## Decision

**Library**: `@simplewebauthn/server` — the standard, actively maintained Node WebAuthn
library; no real alternative considered seriously (it's the de facto choice).

**Single credential per user** (`WebauthnCredential.userId` is `@unique`, not just
indexed). Re-registering replaces the existing credential via `upsert`. This was a
scope decision, not a security one: multi-device support (laptop + phone + security key
simultaneously) is real-world desirable but adds complexity (selecting among multiple
`allowCredentials` at login, a "manage your passkeys" UI) that has no concrete consumer
yet in this app. The schema is still a separate table (not embedded in `User`), so
relaxing `userId` to non-unique later is a one-line migration, not a redesign.

**Challenge storage: Redis cache (via the existing `CACHE_MANAGER`), not a DB table.**
Challenges are single-use, 5-minute TTL, and never queried — they're write-once,
read-once-then-discard. Keying scheme:
- Registration: `webauthn:register:<userId>` (caller is already authenticated, JWT
  protected route)
- Login: `webauthn:login:<lowercased email>` (caller is anonymous pre-login, so keyed by
  the email they're attempting to authenticate as)

This mirrors how magic-link tokens use a DB column with a TTL check, but challenges have
no reason to survive a Redis restart or be queried later — a cache entry that silently
expires is the simpler, correct lifetime model. Same `Cache` interface (`cache.set` /
`.get` / `.del`) already used by `users.service.ts`.

**Login-options anti-enumeration**: `POST /auth/webauthn/login/options` always returns
a `200` with a generated challenge, regardless of whether the email has an account or a
registered passkey — `allowCredentials` is just empty in that case. This matches the
existing policy on `POST /auth/login` (identical 401 for wrong-password vs.
non-existent-email) and on magic-link send (always 200) — don't reveal account existence
through a different code path than the rest of the app already established.

**Token issuance on success**: `WebauthnController.loginVerify()` calls
`AuthService.issueTokens(userId)` — the same JWT issuance path used by
`MagicLinkController.verify()` and `TwoFactorController.verify()`. WebAuthn login is
just another way to reach "I am this userId," not a separate session model.

## Alternatives Considered

### Multi-credential from day one
- Pros: real-world correct (users have multiple devices)
- Cons: no consumer/UI need yet; adds `allowCredentials` selection logic and a
  credential-management endpoint with no current caller
- Rejected: premature — ship single-credential, the schema doesn't block adding it later

### Store challenges in a DB table (like magic-link tokens)
- Pros: consistent with the magic-link precedent; survives a Redis restart
- Cons: challenges are write-once-read-once with a 5-min TTL — no need for durability,
  and a DB round-trip + cleanup job for something this short-lived is unnecessary weight
- Rejected: cache is the better-fitting lifetime model; this codebase already has a
  cache abstraction in active use

### Key registration challenges by session/cookie instead of userId/email
- Pros: avoids any risk of one user's request reading another's cached challenge if key
  construction were ever wrong
- Cons: adds a session dependency to a JWT-only controller; userId (post-auth) and email
  (pre-auth) are already unique enough per-request identifiers, no session needed
- Rejected: unnecessary coupling

## Consequences
- New `WebauthnCredential` table (migration `20260622121756_add_webauthn_credential`),
  `userId @unique` enforces the single-credential decision at the schema level.
- New config: `WEBAUTHN_RP_ID` (default `localhost`), `WEBAUTHN_RP_NAME` (default
  `nest-nexus`) — not added to the Zod schema in `config.validation.ts`, consistent with
  how `GOOGLE_CLIENT_ID`/`GITHUB_CLIENT_ID` are also optional, default-having env vars
  that don't gate startup.
- `expectedOrigin` reuses `app.clientOrigin` (the frontend's origin) — the same config
  value OAuth redirects already use, since WebAuthn ceremonies run in the browser
  against that origin, not the backend's.
- Relaxing to multi-credential later requires: dropping the `@unique` on
  `WebauthnCredential.userId`, building `allowCredentials` from all of a user's rows
  instead of one, and a credential-list/delete endpoint — no other architectural change.
