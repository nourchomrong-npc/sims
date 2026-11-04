# Project audit

> Historical snapshot: this audit predates the move to Supabase PostgreSQL. MySQL/Aiven-specific findings and validation notes below describe the earlier architecture; see `DATABASE.md` and `DEPLOYMENT.md` for the current PostgreSQL setup. The PostgreSQL database has not been live-connected or initialized from this workspace.

## Architecture inspected

- Browser: React 18/Vite SPA with pages for students, teachers, classes, subjects, users, schedules, activity, dashboard, reports, and academic workflows.
- API: Express 5, Zod, bcrypt, role middleware, MySQL pool and MySQL-backed sessions.
- Database: MySQL schema with UUID public IDs, foreign keys, uniqueness constraints, soft deletion, and query-oriented indexes.
- Files: student JPEG uploads were local to the API filesystem before the changes in this audit; the S3-compatible adapter is documented for Supabase Storage.
- Tests: Node's built-in test runner covers validation, public IDs, record codes, student photos, and dashboard helpers.

## Prioritized findings and actions

| Priority | Finding | Action/status |
|---|---|---|
| Critical for multi-instance deployment | No shared request counter; local memory would be inconsistent across Railway replicas. | Added Redis-compatible rate limits; production startup requires Redis. Endpoint defaults/policies are in `RATE_LIMITING.md`. |
| Critical for Railway file persistence | Student photos were saved on an ephemeral local filesystem. | Added S3-compatible private object storage; production rejects local storage. Deployment guidance now targets Supabase Storage; bucket and credentials still need to be configured and verified. |
| High | Database settings had no TLS/URL support, fixed pool settings, or production TLS guard. | Added `DATABASE_URL`, validated TLS, configurable pool/timeout values; production requires `DB_SSL=true`. |
| High | Production assumed one CORS origin and did not set Railway proxy trust. | Added exact-origin HTTPS allowlist with production checks, one-hop production proxy trust, secure configurable cookies, and readiness/liveness routes. |
| High | Production frontend could fall back to `localhost`. | Production Vite build now requires `VITE_API_URL`; Netlify SPA config added. API client now handles non-JSON failures and 429 responses. |
| High | Server errors used raw `console.error(error)`, which could expose query/provider details. | Added request IDs, structured status/duration logs, and sanitized error logs/responses. |
| Medium | Shutdown did not close the session store and process did not bind explicitly to Railway's interface. | Server binds `0.0.0.0:$PORT`, configures HTTP timeouts, and closes session/Redis/MySQL resources on SIGINT/SIGTERM. |
| Medium | API limits some lists to 500 records; several endpoints use server-side pagination, but list coverage is not uniform. | Documented as a follow-up; inspect usage and add pagination where actual data volumes justify API/UI shape changes. |
| Medium | Initial frontend bundle exceeded Vite's 500 kB chunk warning threshold. | Split charting and React dependencies into vendor chunks; verify optimized output with the production build. |
| Medium | No live schema/query-plan validation is possible from repository files alone. | Documented known indexes and query patterns; no speculative indexes added. Run `EXPLAIN` and monitor slow queries against a staging Aiven database. |
| Medium | Deployment providers/services are not described by repository configuration. | Added deployment/runbook documents and explicit credential/service prerequisites. No cloud deployment or service has been claimed. |

## Security and behavior observations

- SQL query values are passed as parameters; dynamic table names used by public-ID utilities are constrained by allowlists.
- Protected API routes use role middleware, teacher-scoped queries are present in relevant academic operations, and student photos are authorization-checked before delivery.
- Login returns a generic invalid-credentials response and performs a bcrypt comparison for unknown usernames to reduce timing-based account enumeration.
- JSON uploads are bounded and JPEG signatures/size checked; production objects stay private and are read through the API.
- There are no registration, password-reset, OTP, or email endpoints in the current API. No controls are claimed for absent flows.
- CORS and `SameSite` cookie behavior must be validated against final custom domains and browser privacy restrictions.
- The database scripts are operator-run. No production database was accessed, migrated, or modified.

## Validation and remaining work

Validation completed after clean lockfile installs:

- `server`: `npm ci`, `npm test` (29/29 passing), `npm audit` (0 vulnerabilities), and `node --check` over all backend source files.
- `client`: `npm ci`, `npm run build` (success, split chunks below Vite's 500 kB warning threshold), and `npm audit` (0 vulnerabilities).
- API smoke check: liveness returned 200, disallowed CORS origin returned 403, request ID header was present, and resources shut down cleanly.
- No lint or type-check script is configured in the existing package manifests.

Unit tests use a shared-store test double; actual Redis, Aiven TLS, S3 compatibility, database-backed readiness, and cloud health checks require staging credentials and have not been verified. npm reports the installed Recharts 2.x branch is deprecated; the dependency has no reported vulnerability, and a major-version migration should be separately tested against the existing charts.

Before production, provision the services, apply schema/migrations against a backed-up staging database, verify restore procedures, confirm bucket lifecycle/retention, tune rate limits from measured traffic, and test the complete login/session/photo workflows on deployed HTTPS domains.
