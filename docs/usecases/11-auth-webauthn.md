# Auth — Passkey / WebAuthn

Base URL: `http://localhost:3000`

**Note:** unlike the other flows in this folder, the `/verify` steps below cannot be
exercised with plain `curl` — `navigator.credentials.create()` / `.get()` require a real
browser (or a virtual authenticator via Chrome DevTools / Playwright). The `/options`
endpoints can be curled directly since they just return JSON challenges.

## Use case

Phishing-resistant, passwordless login using device biometrics or a security key.
Single-credential per user in this implementation (re-registering replaces the existing
passkey) — multi-device support was deferred as a deliberate scope decision.

---

## 1. Registration options (JWT-protected)

**POST** `/api/v1/auth/webauthn/register/options`

```bash
TOKEN="<paste accessToken here>"
curl -s -X POST http://localhost:3000/api/v1/auth/webauthn/register/options \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expect:** `200` with a `PublicKeyCredentialCreationOptionsJSON` object (`challenge`,
`rp`, `user`, `pubKeyCredParams`, etc). Pass this directly into
`@simplewebauthn/browser`'s `startRegistration()` in the frontend.

**Verify:** challenge is also cached server-side (`webauthn:register:<userId>`, 5 min TTL).

---

## 2. Registration verify (JWT-protected, browser-driven)

**POST** `/api/v1/auth/webauthn/register/verify`

```js
// Frontend pseudocode
const options = await fetch('/api/v1/auth/webauthn/register/options', { headers }).then(r => r.json());
const attestation = await startRegistration(options); // @simplewebauthn/browser
await fetch('/api/v1/auth/webauthn/register/verify', {
  method: 'POST',
  headers,
  body: JSON.stringify({ response: attestation }),
});
```

**Expect:** `200 { message: "Passkey registered." }`. Credential is upserted — registering
again replaces the previous passkey for this user.

**Negative:** verify with a stale/replayed attestation (challenge no longer cached) → `401`.

---

## 3. Login options (public, no JWT)

**POST** `/api/v1/auth/webauthn/login/options`

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/webauthn/login/options \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com"}' | jq
```

**Expect:** `200` with `PublicKeyCredentialRequestOptionsJSON`. If the email has no
registered passkey, `allowCredentials` is empty — same response shape either way, so the
endpoint doesn't reveal whether the account exists or has a passkey (no enumeration, same
policy as `/auth/login`).

---

## 4. Login verify (public, browser-driven)

**POST** `/api/v1/auth/webauthn/login/verify`

```js
// Frontend pseudocode
const options = await fetch('/api/v1/auth/webauthn/login/options', {
  method: 'POST', body: JSON.stringify({ email }),
}).then(r => r.json());
const assertion = await startAuthentication(options); // @simplewebauthn/browser
const auth = await fetch('/api/v1/auth/webauthn/login/verify', {
  method: 'POST',
  body: JSON.stringify({ email, response: assertion }),
}).then(r => r.json());
```

**Expect:** `200` with the same `AuthOutput` shape as JWT login
(`{ accessToken, accessTokenExpiresAt, user }`) — full token pair issued, refresh token set
as HttpOnly cookie. No password involved.

**Negative cases:**
- No passkey registered for the email → `401`
- Challenge expired (>5 min) or already used → `401`
- Replayed assertion (counter not greater than stored counter) → `401` (handled by
  `@simplewebauthn/server`'s internal counter check)

---

## 5. Delete the current user's passkey (JWT-protected)

**DELETE** `/api/v1/auth/webauthn/credential`

```bash
curl -s -X DELETE http://localhost:3000/api/v1/auth/webauthn/credential \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expect:** `204 No Content`. **Negative:** no passkey registered → `404`.

---

## 6. Passkey-only signup (public, no JWT, no existing account)

Separate flow from registration above — creates a brand-new account with **no password**,
the passkey is the only credential. See ADR-021.

**POST** `/api/v1/auth/webauthn/signup/options`

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/webauthn/signup/options \
  -H "Content-Type: application/json" \
  -d '{"email":"newuser@example.com","displayName":"New User"}' | jq
```

**Expect:** `200` with `PublicKeyCredentialCreationOptionsJSON`.
**Negative:** email already registered → `409`.

**POST** `/api/v1/auth/webauthn/signup/verify`

```js
// Frontend pseudocode
const options = await fetch('/api/v1/auth/webauthn/signup/options', {
  method: 'POST', body: JSON.stringify({ email, displayName }),
}).then(r => r.json());
const attestation = await startRegistration(options); // @simplewebauthn/browser
const auth = await fetch('/api/v1/auth/webauthn/signup/verify', {
  method: 'POST',
  body: JSON.stringify({ email, response: attestation }),
}).then(r => r.json());
```

**Expect:** `200` with full `AuthOutput` — account created and logged in, same response
shape as any other login. New user has `password: null`, `hasPassword: false`.

**Negative cases:**
- Email already registered (checked again at verify time, race-safe) → `409`
- Challenge expired or invalid attestation → `401`

No User row is created if the ceremony is abandoned before `/verify` succeeds — pending
signup state lives only in cache (5 min TTL).
