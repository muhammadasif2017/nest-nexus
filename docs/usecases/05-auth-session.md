# Auth — Session-Based Login + CSRF

Session auth stores state server-side in PostgreSQL. CSRF protection uses the
double-submit cookie pattern on all `/auth/session/*` routes.

Implementation lives in `src/modules/session-auth/` (`SessionAuthModule`), a
separate module from JWT auth — see ADR-014. Routes and URLs are unchanged from
before the split.

**Note:** if 2FA is enabled, session login does NOT complete — it returns
`401 TWO_FACTOR_REQUIRED` and tells the client to use the JWT flow instead
(session auth has no 2FA-pending state of its own).

---

## 1. Session login

**POST** `/api/v1/auth/session/login`

```bash
curl -s -c cookies.txt -b cookies.txt \
  -X POST http://localhost:3000/api/v1/auth/session/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"StrongPass1!"}' | jq
```

**Expect:**
- `200 { message: "Logged in successfully.", user: { id, email, ... } }`
- Two cookies set:
  - `connect.sid=...` — session ID (HttpOnly)
  - `XSRF-TOKEN=...` — CSRF token (NOT HttpOnly, readable by JS)

**Verify in DB:**
```sql
SELECT * FROM session ORDER BY expire DESC LIMIT 5;
-- Should show a new row with sess JSON containing userId
```

**Postman:**
- Method: **POST** → `{{baseUrl}}/api/v1/auth/session/login`
- **Body** tab → **raw** → **JSON**: `{"email":"alice@example.com","password":"StrongPass1!"}`
- No Authorization header.
- After sending, Postman's cookie jar captures both `connect.sid` (HttpOnly) and `XSRF-TOKEN` automatically. Click **Cookies** (top-right) to confirm.
- In the **Tests** tab for this request, capture the CSRF token for use in subsequent requests:
  ```javascript
  const csrf = pm.cookies.get('XSRF-TOKEN');
  if (csrf) pm.collectionVars.set('csrfToken', csrf);
  ```

---

## 2. CSRF — obtain token then call protected route

The `XSRF-TOKEN` cookie value must be sent as `X-CSRF-Token` header on mutating requests.

```bash
# Extract XSRF-TOKEN value from cookies.txt
CSRF=$(grep XSRF-TOKEN cookies.txt | awk '{print $7}')

# Use it in the header on a session-protected mutation
curl -s -c cookies.txt -b cookies.txt \
  -X POST http://localhost:3000/api/v1/auth/session/logout \
  -H "X-CSRF-Token: $CSRF" | jq
```

**Negative — missing CSRF token:**
```bash
curl -s -c cookies.txt -b cookies.txt \
  -X POST http://localhost:3000/api/v1/auth/session/logout | jq
# Expect 403 "invalid csrf token"
```

**Negative — wrong CSRF token:**
```bash
curl -s -c cookies.txt -b cookies.txt \
  -X POST http://localhost:3000/api/v1/auth/session/logout \
  -H "X-CSRF-Token: wrong-token" | jq
# Expect 403
```

**Postman (CSRF-protected request):**
- Method: **POST** → `{{baseUrl}}/api/v1/auth/session/logout`
- **Headers** tab → add: `X-CSRF-Token` = `{{csrfToken}}` (set by the login Tests script above)
- No Authorization header — session cookie is sent automatically.
- **Negative test:** remove the `X-CSRF-Token` header or set it to `wrong` → expect `403`.

---

## 3. Session logout

**POST** `/api/v1/auth/session/logout`

```bash
CSRF=$(grep XSRF-TOKEN cookies.txt | awk '{print $7}')
curl -s -c cookies.txt -b cookies.txt \
  -X POST http://localhost:3000/api/v1/auth/session/logout \
  -H "X-CSRF-Token: $CSRF" | jq
```

**Expect:** `204 No Content` (empty body)

**Postman:** Same as the CSRF-protected request above — **POST** with `X-CSRF-Token: {{csrfToken}}`.

**Verify:**
- `connect.sid` cookie cleared
- Session row deleted from DB:
```sql
SELECT COUNT(*) FROM session;
-- Should decrease by 1
```

**Negative — logout without an active session:**
```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  -X POST http://localhost:3000/api/v1/auth/session/logout
# Expect 401 "No active session."
```
This route is protected by `SessionGuard` — calling it with no valid session cookie
must be rejected. (Prior to ADR-014 this guard existed but was never wired, so this
call incorrectly returned 204 regardless of auth state — now fixed.)

---

## 4. Session persistence across server restart

PostgreSQL-backed sessions survive a server restart (unlike in-memory sessions).

```bash
# 1. Login and note session cookie
curl -s -c cookies.txt -b cookies.txt \
  -X POST http://localhost:3000/api/v1/auth/session/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"StrongPass1!"}'

# 2. Restart the server (Ctrl+C, then npm run start:dev)

# 3. Call a session-protected endpoint — cookie should still work
CSRF=$(grep XSRF-TOKEN cookies.txt | awk '{print $7}')
curl -s -c cookies.txt -b cookies.txt \
  -X POST http://localhost:3000/api/v1/auth/session/logout \
  -H "X-CSRF-Token: $CSRF" | jq
# Expect 200, not 401
```

---

## 5. Session fixation — ID regenerated on login

A new session ID is issued after successful login, preventing session fixation attacks.

```bash
# 1. Note the Set-Cookie header BEFORE login (if any pre-auth session existed)
# 2. Login
curl -v -c cookies.txt -X POST http://localhost:3000/api/v1/auth/session/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"StrongPass1!"}' 2>&1 | grep "Set-Cookie"
```

**Verify:**
- The `connect.sid` value in the response differs from any pre-login session ID

---

## 6. Session + 2FA (blocked)

```bash
# Login as a user with 2FA enabled
curl -s -X POST http://localhost:3000/api/v1/auth/session/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice2fa@example.com","password":"StrongPass1!"}' | jq
# Expect 401: { statusCode: 401, errorCode: "TWO_FACTOR_REQUIRED",
#   message: "Two-factor authentication required. Use the JWT flow to complete 2FA." }
```
