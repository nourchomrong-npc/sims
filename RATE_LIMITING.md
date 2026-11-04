# Rate limiting

The API uses `express-rate-limit` with standard `RateLimit` response headers and `Retry-After`. It uses the default in-memory store, so no Redis service is required. The API does not cache dashboard or metadata responses; reads go directly to PostgreSQL.

| Category | Default | Key |
|---|---:|---|
| General API | 120 requests per 15 minutes | Authenticated internal user ID, otherwise trusted request IP |
| Login | 10 requests per 15 minutes per account/IP pair | Trusted request IP plus a one-way hash of the normalized username |
| Sensitive authenticated actions (password change, account credential generation) | 10 requests per 15 minutes | Authenticated internal user ID |
| Student photo upload/create/edit | 10 requests per 15 minutes | Authenticated internal user ID, otherwise trusted request IP |
| Dashboard, reports, decision support | 30 requests per minute | Authenticated internal user ID, otherwise trusted request IP |
| Liveness/readiness | Excluded from the general request quota | Render health monitoring |

These are starting defaults based on the app's interactive school-staff usage, not a substitute for tuning against measured production traffic. Authenticated users receive their own general quota to avoid shared-network contention; login attempts are separated by target account while still bound to the trusted source IP. The username is hashed before it becomes part of the rate-limit key. `Retry-After` is returned in seconds with a JSON `RATE_LIMITED` error. The frontend converts this response into a wait-and-retry message.

## Configuration

All limits are positive integer environment variables:

- `RATE_LIMIT_GENERAL_WINDOW_MS`, `RATE_LIMIT_GENERAL_MAX`
- `RATE_LIMIT_LOGIN_WINDOW_MS`, `RATE_LIMIT_LOGIN_MAX`
- `RATE_LIMIT_UPLOAD_WINDOW_MS`, `RATE_LIMIT_UPLOAD_MAX`
- `RATE_LIMIT_AUTH_WINDOW_MS`, `RATE_LIMIT_AUTH_MAX`
- `RATE_LIMIT_EXPENSIVE_WINDOW_MS`, `RATE_LIMIT_EXPENSIVE_MAX`

Render's ingress is the trusted single proxy hop in production (`trust proxy = 1`). Client-supplied forwarding headers are not used as a custom rate-limit key. Keep the API reachable only through Render ingress; if another proxy is added, re-evaluate the trusted-hop count.

No persistent event table is needed. The API emits a structured, low-detail log event when a limit is exceeded; it omits client IP, account name, request body, and credentials. In-memory counters expire with their configured windows.

## Verification

`server/test/rateLimit.test.js` checks in-limit behavior, 429/Retry-After/standard headers, expiry, and two API instances sharing a store.
