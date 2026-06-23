# Auth — OAuth2 (Google & GitHub)

OAuth flows require a browser — curl cannot follow the consent screen redirects.  
Use a browser or Postman's built-in browser for these tests.

**Postman Setup for OAuth:**
Postman cannot automate OAuth consent screens directly. Two options:

- **Option A — Postman browser (recommended):** Open any request → **Authorization** tab → Type **OAuth 2.0** → **Get New Access Token**. Fill in the provider URLs, client ID/secret, and callback URL. Postman opens its built-in browser for the consent screen. However, this project issues JWTs via redirect — use Option B to capture them.
- **Option B — Copy token from redirect:** Complete the OAuth flow in your regular browser. After the consent screen, the browser lands on `{CLIENT_ORIGIN}/oauth/success#token=<accessToken>`. Copy the token from the URL fragment, then paste it into the `accessToken` collection variable manually (**Collection** → **Variables** → set `accessToken`). All subsequent Postman requests will use it.

**Prerequisites:** Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET` in `.env`. Callback URLs registered in each provider's dashboard.

---

## 1. Google OAuth — new account (first login)

**Browser:** Navigate to `http://localhost:3000/api/v1/auth/google`

**Flow:**
1. Server redirects to Google consent screen
2. Authenticate with a Google account that has NO existing nest-nexus account
3. Google redirects to `/api/v1/auth/google/callback`
4. Server creates account, issues JWT, redirects to `{CLIENT_ORIGIN}/oauth/success#token=<accessToken>`

**Verify:**
- URL fragment contains `token=<accessToken>` (NOT a query param — security: fragments aren't sent to servers)
- `refresh_token` cookie is set (HttpOnly)
- Calling `GET /api/v1/auth/me` with the token returns `200`
- New user row exists in DB with `hasPassword: false`

---

## 2. Google OAuth — existing email (account linking)

**Precondition:** Register `bob@gmail.com` via email/password first.

**Browser:** Navigate to `http://localhost:3000/api/v1/auth/google`

**Flow:**
1. Authenticate with the Google account whose email matches `bob@gmail.com`
2. Server finds existing user by email, links the OAuth provider (`OauthProvider` row created)
3. Issues JWT for the existing account

**Verify:**
- Same user `id` as the password-registered account
- User can now log in via EITHER password or Google OAuth
- `OauthProvider` table has a row for `userId = bob's id`, `provider = google`

---

## 3. Google OAuth — returning user (already linked)

**Precondition:** Scenario 1 or 2 already completed.

**Browser:** Navigate to `http://localhost:3000/api/v1/auth/google` again.

**Verify:**
- No new user created, no new `OauthProvider` row
- Issues a fresh JWT for the same account
- `lastLoginAt` updated

---

## 4. GitHub OAuth — new account

**Browser:** Navigate to `http://localhost:3000/api/v1/auth/github`

Same flow and verification as scenario 1, using GitHub credentials.

---

## 5. OAuth + 2FA

**Precondition:** User has 2FA enabled on their account (see [03-auth-2fa.md](03-auth-2fa.md)).

**Browser:** Initiate OAuth login for that user's email.

**Expect:**
- Callback does NOT redirect to `/oauth/success`
- Instead returns a `scope: two_factor_pending` JWT (short-lived, 5 min)
- Frontend must call `POST /api/v1/auth/2fa/verify` with the pending token + TOTP code

**Verify:**
- Calling any other endpoint with the pending token returns `403 Forbidden`
- Only `POST /api/v1/auth/2fa/verify` accepts the pending token

---

## 6. OAuth with no email from provider

Some GitHub accounts hide their email.

**Flow:** GitHub callback with `profile.email = null`

**Expect:**
- New account created with synthetic email `<providerId>@github.oauth`
- User can log in again via GitHub (matched by `providerId`, not email)

**Verify in DB:**
```sql
SELECT email, "hasPassword" FROM "User" WHERE email LIKE '%@github.oauth';
```
