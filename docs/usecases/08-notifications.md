# Real-Time Notifications (SSE)

Server-Sent Events — the server pushes events to connected clients.
Requires a persistent HTTP connection; use `curl --no-buffer` or browser EventSource.

---

## 1. Connect to SSE stream

**GET** `/api/v1/notifications/stream`

```bash
curl -N --no-buffer http://localhost:3000/api/v1/notifications/stream \
  -H "Authorization: Bearer $TOKEN"
```

Keep this terminal open. Events appear as they are emitted.

**Expected initial output:**
```
: ping

data: {"type":"connected","userId":"<id>"}
```

**Verify:**
- Connection stays open (no immediate close)
- Ping `:` comment lines appear periodically (keep-alive)

**Postman:**
- Method: **GET** → `{{baseUrl}}/api/v1/notifications/stream`
- **Authorization** tab → **Bearer Token** → `{{accessToken}}`
- Send. Postman v10.13+ supports SSE natively — the **Response** body stays open and appends each event as it arrives (you'll see `: ping` keep-alives and `data:` lines).
- If Postman closes the connection immediately, check that the server is running and the token is valid.
- To stop the stream, click **Cancel** in Postman (the red ✕ next to the response).

---

## 2. Trigger user.updated event

In a second terminal, update your profile:

```bash
curl -s -X PATCH http://localhost:3000/api/v1/users/me \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"displayName":"SSE Test"}' | jq
```

**Expect in the SSE terminal:**
```
event: user:updated
data: {"userId":"<id>"}
```

**Postman:** Keep the SSE request open in one tab. In a second tab, send the `PATCH /users/me` request (see [06-users.md](06-users.md) scenario 4) — the SSE tab should show the `user:updated` event appear within ~1 second.

---

## 3. Trigger user.deactivated event (admin)

In a second terminal (as admin):

```bash
curl -s -X DELETE http://localhost:3000/api/v1/users/$USER_ID \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq
```

**Expect in the SSE terminal:**
```
event: user:deactivated
data: {"userId":"<id>"}
```

**Verify:** The SSE connection for the deactivated user is closed by the server.

---

## 4. Unauthenticated SSE connection

```bash
curl -N --no-buffer http://localhost:3000/api/v1/notifications/stream
# Expect immediate 401, connection closes
```

---

## 5. Multiple concurrent connections (same user)

Open two SSE connections with the same token in separate terminals.  
Trigger a profile update — both connections should receive the event.

```bash
# Terminal 1
curl -N --no-buffer http://localhost:3000/api/v1/notifications/stream \
  -H "Authorization: Bearer $TOKEN" &

# Terminal 2
curl -N --no-buffer http://localhost:3000/api/v1/notifications/stream \
  -H "Authorization: Bearer $TOKEN" &

# Trigger update
curl -s -X PATCH http://localhost:3000/api/v1/users/me \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"displayName":"Multi"}' | jq
```

**Expect:** Both terminals receive the `user:updated` event.

---

## 6. Browser EventSource (alternative to curl)

Open browser DevTools console and run:

```javascript
const es = new EventSource('http://localhost:3000/api/v1/notifications/stream', {
  // Note: EventSource doesn't support custom headers natively
  // Use a library like 'eventsource' or pass token via query param if supported
});
es.addEventListener('user:updated', (e) => console.log('Updated:', e.data));
es.addEventListener('user:deactivated', (e) => console.log('Deactivated:', e.data));
es.onerror = (e) => console.error('SSE error:', e);
```

> **Note:** Browser's native `EventSource` doesn't support `Authorization` header.
> For browser testing, use a fetch-based SSE library (e.g., `@microsoft/fetch-event-source`)
> or test via curl as shown above.
