# Auth — JWT Flow

Base URL: `http://localhost:3000`  
All cookies are HttpOnly — use `-c cookies.txt -b cookies.txt` with curl to persist them.

---

## Postman Setup (do once)

1. Create a Collection named **nest-nexus**.
2. Add two **Collection Variables**: `baseUrl` = `http://localhost:3000`, `accessToken` = *(empty)*.
3. In the Collection **Tests** tab, paste this shared capture script:
   ```javascript
   const data = pm.response.json();
   if (data?.accessToken) pm.collectionVariables.set('accessToken', data.accessToken);
   ```
   This runs after every request in the collection and auto-saves the token whenever a login/register response arrives.
4. Postman's **cookie jar** captures `Set-Cookie: refresh_token` automatically — no extra config needed. Verify in **Cookies** (top-right of any response).
5. For all authenticated requests: **Authorization** tab → Type **Bearer Token** → `{{accessToken}}`.

---

## 1. Register a new account

**POST** `/api/v1/auth/register`  
Rate limited: 5 per 10 min.

```bash
curl -s -c cookies.txt -X POST http://localhost:3000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"StrongPass1!","displayName":"Alice"}' | jq
```

**Expect:**
- `201` with `{ accessToken, accessTokenExpiresAt, user: { id, email, displayName, roles, ... } }`
- `Set-Cookie: refresh_token=...; HttpOnly; Path=/api/v1/auth`

**Verify:**
- `user.roles` includes `"user"`
- `user.password` is NOT in the response
- Cookie is HttpOnly (visible in response headers, not JS-accessible)

**Postman:**
- Method: **POST** → `{{baseUrl}}/api/v1/auth/register`
- **Body** tab → **raw** → **JSON**:
  ```json
  {"email":"alice@example.com","password":"StrongPass1!","displayName":"Alice"}
  ```
- Send. Check **Cookies** tab — `refresh_token` should appear as HttpOnly.
- The shared collection test script saves `accessToken` automatically.

---

## 2. Login

**POST** `/api/v1/auth/login`  
Rate limited: 5 per 10 min.

```bash
curl -s -c cookies.txt -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"StrongPass1!"}' | jq
```

**Expect:** Same shape as register response.

**Postman:**
- Method: **POST** → `{{baseUrl}}/api/v1/auth/login`
- **Body** tab → **raw** → **JSON**: `{"email":"alice@example.com","password":"StrongPass1!"}`
- `accessToken` saved automatically by the collection test script.

**Negative cases:**

```bash
# Wrong password — should get 401, same response time (constant-time comparison)
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@example.com","password":"wrong"}' | jq

# Non-existent email — should get 401 (same message, no email enumeration)
curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"nobody@example.com","password":"anything"}' | jq
```

**Verify:**
- Both negative cases return identical `401 "Invalid email or password."` — no email enumeration
- Response time for wrong-password and non-existent-email should be similar (bcrypt dummy hash runs)

---

## 3. Get current user (JWT protected)

**GET** `/api/v1/auth/me`

```bash
TOKEN="<paste accessToken here>"
curl -s http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expect:** `200` with JWT payload `{ sub, email, roles, iat, exp }`

**Postman:**
- Method: **GET** → `{{baseUrl}}/api/v1/auth/me`
- **Authorization** tab → **Bearer Token** → `{{accessToken}}`
- No body needed.

**Negative:**
```bash
# No token → 401
curl -s http://localhost:3000/api/v1/auth/me | jq

# Expired/tampered token → 401
curl -s http://localhost:3000/api/v1/auth/me \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.bad.sig" | jq
```

---

## 4. Refresh access token

**POST** `/api/v1/auth/refresh`  
Reads the `refresh_token` cookie automatically.

```bash
# Use -b cookies.txt to send the stored refresh_token cookie
curl -s -c cookies.txt -b cookies.txt -X POST \
  http://localhost:3000/api/v1/auth/refresh | jq
```

**Expect:**
- `200` with new `{ accessToken, accessTokenExpiresAt }`
- New `Set-Cookie: refresh_token=...` (old token is now revoked)

**Postman:**
- Method: **POST** → `{{baseUrl}}/api/v1/auth/refresh`
- No Authorization header, no body — Postman sends the `refresh_token` cookie automatically.
- The collection test script updates `{{accessToken}}` with the new value.
- For the reuse test: open **Cookies** (top-right), copy the current `refresh_token` value before sending. After a successful refresh, manually restore the old value in the cookie jar and send again — expect `401`.

**Negative — token reuse (critical security test):**
```bash
# 1. Save the current refresh_token cookie value before refreshing
# 2. Call refresh once (succeeds, old token revoked)
# 3. Call refresh again with the OLD cookie — should trigger family revocation

# Step 1: note the cookie value in cookies.txt
cat cookies.txt

# Step 2: first refresh (succeeds)
curl -s -c cookies.txt -b cookies.txt -X POST \
  http://localhost:3000/api/v1/auth/refresh | jq

# Step 3: replay the OLD token (copy original cookie back to cookies.txt)
# → must return 401 "Refresh token has already been used. Please log in again."
```

**Verify:**
- After step 3, ALL sessions for this user are revoked (family revocation)
- Subsequent login is required

---

## 5. Logout

**POST** `/api/v1/auth/logout`

```bash
curl -s -c cookies.txt -b cookies.txt -X POST \
  http://localhost:3000/api/v1/auth/logout \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expect:** `200 { message: "Logged out successfully." }`

**Postman:**
- Method: **POST** → `{{baseUrl}}/api/v1/auth/logout`
- **Authorization** tab → **Bearer Token** → `{{accessToken}}`
- No body. Cookie sent automatically.

**Verify:**
- Refresh token cookie is cleared (`Set-Cookie: refresh_token=; Max-Age=0`)
- Calling `/api/v1/auth/refresh` after logout returns `401`
- Access token still works until its 15-min TTL expires (JWTs are stateless)

---

## 6. Rate limiting

```bash
# Hit login 6 times quickly — 6th should return 429
for i in {1..6}; do
  curl -s -o /dev/null -w "Attempt $i: %{http_code}\n" \
    -X POST http://localhost:3000/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"x@x.com","password":"wrong"}'
done
```

**Expect:** First 5 return `401`, 6th returns `429 Too Many Requests`.

**Postman:**
- Create a login request with wrong credentials.
- Use **Collection Runner**: select the request, set **Iterations** to `6`, **Delay** to `0`.
- Run — the 6th iteration should return `429`.

---

## 7. Device sessions

**GET** `/api/v1/auth/sessions`

```bash
curl -s http://localhost:3000/api/v1/auth/sessions \
  -H "Authorization: Bearer $TOKEN" \
  -b cookies.txt | jq
```

**Expect:** Array of active device sessions with `deviceId`, `deviceName`, `lastUsedAt`, `isCurrent`.
`isCurrent` is resolved from the `refresh_token` cookie — pass `-b cookies.txt` so
the device making the request can be identified; without it every entry has
`isCurrent: false`.

**Postman:**
- Method: **GET** → `{{baseUrl}}/api/v1/auth/sessions`
- **Authorization** tab → **Bearer Token** → `{{accessToken}}`
- Cookie jar sends `refresh_token` automatically (captured at login/register).
- Copy a `deviceId` from the response for the revoke step below.

**Revoke a specific device:**

```bash
DEVICE_ID="<deviceId from above>"
curl -s -X DELETE "http://localhost:3000/api/v1/auth/sessions/$DEVICE_ID" \
  -H "Authorization: Bearer $TOKEN" | jq
```

**Expect:** `204 No Content`. Revokes ALL refresh tokens for that `deviceId` —
that device is signed out, other devices unaffected.

**Postman (revoke):**
- Method: **DELETE** → `{{baseUrl}}/api/v1/auth/sessions/<deviceId>`
- Replace `<deviceId>` with the value from the sessions list.
- **Authorization** tab → **Bearer Token** → `{{accessToken}}`
