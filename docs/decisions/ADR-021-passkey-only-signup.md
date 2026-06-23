# ADR-021: Passkey-Only Account Signup (No Password)

## Status
Accepted

## Date
2026-06-22

## Context
ADR-020 added WebAuthn for *existing* users — `register/options` is JWT-protected, so a
passkey could only be attached to an account that already exists (created via
email/password or OAuth). Real-world apps (GitHub, Google, Apple ID) increasingly let a
user create a brand-new account with a passkey as the *only* credential, no password
ever set. The gap was real: this app had no way to do that.

The core difficulty: WebAuthn's registration ceremony needs a `userID` and a place to
verify against, but there's no User row yet — register/verify normally trusts an
authenticated JWT to say "attach this credential to user X." Signup has no JWT and no
user row at the start of the ceremony.

## Decision
Add a **second, fully separate** flow — `signupOptions()` / `signupVerify()` in
`WebauthnService`, `POST /auth/webauthn/signup/options` / `signup/verify` in
`WebauthnController` — rather than modifying `registerOptions()`/`registerVerify()`.
Explicit constraint from the requester: do not change the existing
register/login/delete implementations at all. This was the right call independent of
that constraint too: register (attach to existing user) and signup (create new user) are
different enough in pre-conditions (JWT vs. none) and post-conditions (update credential
vs. create user + credential) that branching one function on "do we have a user yet?"
would be messier than two small functions.

**Pending signup state**: no User row is created at `/signup/options` time. Instead, the
challenge *and* the `displayName` the user typed are cached together as JSON
(`webauthn:signup:<email>`, 5-min TTL, same `CACHE_MANAGER` used by every other WebAuthn
challenge). The user row is only created in `/signup/verify`, after the registration
response is cryptographically verified — so an abandoned/failed ceremony never leaves an
orphan, password-less, credential-less user in the database.

**Double existence check**: email-uniqueness is checked at both `/signup/options` (fail
fast) and `/signup/verify` (defend against a second signup racing in between the two
calls — the ceremony is a two-step round trip, so this window is real, not theoretical).
Both raise `ConflictException`, matching `AuthService.register()`'s existing behavior —
unlike WebAuthn *login*, signup is expected to reveal "email taken" (that's normal signup
UX, not an auth bypass surface).

**New user fields**: `password: null`, `hasPassword: false` — identical to how
`AuthService.oauthLogin()` already creates passwordless OAuth users. No new convention
invented; reused the existing "this account has no password" representation.

**`EventEmitter2` added to `WebauthnService`**: previously this service didn't need it
(every other method either reads or updates an existing user, no creation event to
emit). Signup creates a user, so it must emit `user.created` — same as
`AuthService.register()` — or `CacheInvalidationService`'s `users:all` cache goes stale
after a passkey-only signup. Adding the constructor param is additive (new optional
capability for the class), not a change to any existing method's behavior.

## Alternatives Considered

### Branch registerOptions()/registerVerify() on whether a JWT is present
- Pros: one set of endpoints instead of two
- Cons: the requester explicitly asked not to touch the existing implementation; even
  ignoring that, the pre/post-conditions diverge enough (no-user vs. has-user,
  create-user vs. update-credential) that the branch would need most of the logic
  duplicated anyway inside an if/else
- Rejected: two small, single-purpose functions are clearer than one function with two
  modes

### Create the User row at /signup/options time, before verification
- Pros: simpler — `signupVerify` would just be `registerVerify` plus an update instead
  of a create
- Cons: every abandoned signup attempt (user closes the tab, authenticator fails, never
  calls /verify) leaves a permanent password-less, credential-less, unusable User row
- Rejected: defer user creation until the credential is actually verified — same
  "only commit on success" principle as the existing `register()` flow, which also only
  creates the user after validating the request, not before

### Store pending signup state in a DB table instead of cache
- Pros: consistent with `RefreshToken`/magic-link DB-backed approach
- Cons: same reasoning as ADR-020 — this is write-once, read-once, 5-minute-TTL data;
  no value in durability or queryability
- Rejected: matches the existing cache-based challenge pattern already established for
  register/login

## Consequences
- Two new public endpoints: `POST /auth/webauthn/signup/options`,
  `POST /auth/webauthn/signup/verify` — both `@Public()`.
- `WebauthnService` constructor gained an `EventEmitter2` parameter; all existing call
  sites (tests, `AuthModule` DI) needed updating to pass it, but no existing method's
  *behavior* changed — verified by the full pre-existing test suite passing unchanged.
- A user created via passkey-only signup has no recovery path if they lose the
  authenticator and never registered a second method — same limitation real-world
  passkey-only flows have; out of scope here (no email-based account recovery flow
  exists in this app for password-based accounts that lose 2FA either).
