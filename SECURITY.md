# Security

## Controls in the application

- Passwords use bcrypt; authenticated sessions use a random server-only secret and a PostgreSQL-backed session store. Cookies are `HttpOnly`, `Secure` in production, and use configurable `SameSite`.
- API routes use role checks, Zod input validation, parameterized PostgreSQL queries, and public UUIDs rather than internal numeric identifiers.
- Helmet security headers, exact-origin credentialed CORS, bounded JSON requests, request IDs, and structured request/error logs are enabled.
- Production trusts exactly one proxy hop for Render. Forwarded headers are not manually parsed.
- Production requires HTTPS deployment, PostgreSQL TLS (`DB_SSL=true`), in-memory rate limiting, and private Supabase Storage for student photos. Student photos are private, size-limited JPEGs and remain behind authenticated/authorized API access.
- Internal errors return a generic message and request ID. Logs omit request bodies, passwords, session values, photo contents, and SQL error messages.

## Required deployment controls

1. Generate a unique `SESSION_SECRET` of at least 32 characters and keep the `DB_*` PostgreSQL credentials and Supabase Storage credentials in Render server variables. Never add them to `VITE_*` variables.
2. Set `CLIENT_URLS` to the exact HTTPS Netlify production origin (and exact staging origin only if needed). Production startup rejects HTTP, localhost, and path-based origins. Do not use `*` with credentials. Set `VITE_API_URL=/api` so the browser uses the Netlify same-origin proxy rather than the Render API hostname.
3. Configure `SESSION_COOKIE_SAME_SITE=lax` for the same-origin Netlify proxy and keep cookies secure over HTTPS. This avoids dependence on browser third-party-cookie support.
4. Configure Supabase PostgreSQL TLS with `DB_SSL=true`; the backend verifies the server certificate.
5. Keep the Supabase photo bucket private and protect/rotate its generated S3 credentials. Supabase S3 access keys are server-only, broad project storage credentials that bypass Storage RLS; never use them in the browser or a `VITE_*` variable. Use provider-side encryption, versioning, and backup policies where available.
6. Require administrator password changes, disable unused accounts, back up PostgreSQL and student photos, and test restoration before launch.
7. Review dependency advisories and run the test/build commands in `DEPLOYMENT.md` before release.

## Limitations

There is no password reset, OTP, email, or registration endpoint in the current API; therefore those flows are not claimed as implemented. Login and existing sensitive authenticated actions are rate-limited. There is no CSRF token flow; credentialed CORS rejects unallowlisted origins, cookies use `SameSite`, and API mutations use JSON. If non-browser clients, cross-site forms, or additional origins are introduced, add and test a CSRF defense before enabling them. Supabase, Render, and Netlify credentials/services were not available for live verification during this audit.
