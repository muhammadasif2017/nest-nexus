# Auth — Magic Link Login

Magic links deliver a one-time login URL via email. Email sending is stubbed
(logged to console) — extract the token from server logs for testing.

---

## 1. Send magic link

**POST** `/api/v1/auth/magic-link/send`  
Rate limited: 3 per 10 min. Always returns 200 (no email enumeration).

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/magic-link/send \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com"}' | jq
```

**Expect:** `200 { message: "If an account exists, a magic link has been sent." }`

**Verify:**
- Check server logs for the magic link URL:
  ```
  [STUB] Magic link email → alice@example.com, expires in 15m
  ```
- The actual token is in the BullMQ job payload — check Bull Board at `http://localhost:3000/api/queues` (dev only)
- DB: `magicLinkTokenHash` and `magicLinkExpiresAt` set on the user row

**Non-existent email (security test):**
```bash
curl -s -X POST http://localhost:3000/api/v1/auth/magic-link/send \
  -H "Content-Type: application/json" \
  -d '{"email":"nobody@example.com"}' | jq
```

**Expect:** Same `200` response — cannot determine if email exists.

**Postman:**
- Method: **POST** → `{{baseUrl}}/api/v1/auth/magic-link/send`
- **Body** tab → **raw** → **JSON**: `{"email":"alice@example.com"}`
- No auth header needed.
- After sending, check the **server console** for the magic link URL, or open Bull Board at `http://localhost:3000/api/queues` to inspect the job payload and extract the token.

---

## 2. Verify magic link — success

Extract `token` from the link in server logs or Bull Board, then:

**GET** `/api/v1/auth/magic-link/verify?token=<token>`

```bash
TOKEN_VALUE="<32-char hex token from logs>"
curl -s -c cookies.txt \
  "http://localhost:3000/api/v1/auth/magic-link/verify?token=$TOKEN_VALUE" | jq
```

**Expect:**
- `200` with `{ accessToken, accessTokenExpiresAt, user }`
- `Set-Cookie: refresh_token=...; HttpOnly`

**Verify:**
- DB: `magicLinkTokenHash` and `magicLinkExpiresAt` are now `NULL` (cleared on use)

**Postman:**
- Method: **GET** → `{{baseUrl}}/api/v1/auth/magic-link/verify`
- **Params** tab → add query param: Key `token`, Value `<hex token from logs>`
- No auth header. Response returns `accessToken` — the collection test script saves it automatically.

---

## 3. Verify magic link — single-use enforcement

Use the same token a second time:

```bash
curl -s "http://localhost:3000/api/v1/auth/magic-link/verify?token=$TOKEN_VALUE" | jq
```

**Expect:** `401 "Invalid or expired magic link."`

---

## 4. Verify magic link — expired token

1. Send a magic link
2. Wait 15 minutes (or set `magicLinkExpiresAt` to a past date directly in DB for testing)
3. Try to verify

```bash
# Fast-forward expiry in DB:
psql $DATABASE_URL -c "
  UPDATE \"User\" SET \"magicLinkExpiresAt\" = NOW() - INTERVAL '1 minute'
  WHERE email = 'alice@example.com';
"

curl -s "http://localhost:3000/api/v1/auth/magic-link/verify?token=$TOKEN_VALUE" | jq
```

**Expect:** `401 "Invalid or expired magic link."`

---

## 5. Send replaces previous token

1. Send magic link (token A stored)
2. Send again (token B stored, token A overwritten)
3. Try token A → `401`
4. Try token B → `200`

```bash
# Send twice
curl -s -X POST http://localhost:3000/api/v1/auth/magic-link/send \
  -H "Content-Type: application/json" -d '{"email":"alice@example.com"}'
# note token A from logs

curl -s -X POST http://localhost:3000/api/v1/auth/magic-link/send \
  -H "Content-Type: application/json" -d '{"email":"alice@example.com"}'
# note token B from logs

# Token A should fail (overwritten)
curl -s "http://localhost:3000/api/v1/auth/magic-link/verify?token=TOKEN_A" | jq
# Expect 401
```

---

## 6. Magic link + 2FA

If the user has 2FA enabled, magic link verification issues a `two_factor_pending` token.

**Verify:**
```bash
# Verify the magic link
curl -s "http://localhost:3000/api/v1/auth/magic-link/verify?token=$TOKEN_VALUE" | jq
# Expect: { accessToken: "...", isTwoFactorPending: true }

# Must call /auth/2fa/verify next (see 03-auth-2fa.md scenario 3)
```
