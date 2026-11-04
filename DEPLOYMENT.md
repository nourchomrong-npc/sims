# Deployment

## Local development

Requirements: Node.js 20+, npm, and a Supabase project with PostgreSQL and Storage. Configure `server/.env` from `server/.env.example`; use the separate `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` connection parameters, `DB_SSL=true`, valid Supabase Storage credentials, and a strong `SESSION_SECRET`. The frontend template's API URL is local.

```powershell
Set-Location D:\studydocs\projectsystem_production\server
npm.cmd ci
npm.cmd test
npm.cmd run dev
```

In another terminal:

```powershell
Set-Location D:\studydocs\projectsystem_production\client
npm.cmd ci
npm.cmd run dev
```

Initialize the empty Supabase database using `database/schema.postgres.sql` as documented in README; optionally run the PostgreSQL-compatible `database/seed.sql` for fictional development data. Then run `npm.cmd run setup-admin` from `server`. The admin setup utility is not a production bootstrap or password reset command.

## School-LAN local backend

The cloud application deployment remains unchanged. For a school that needs local database operation, deploy this existing Node/Express backend on a trusted school-LAN host; it is the only component that connects to both PostgreSQL databases and runs synchronization. Do not deploy sync routes or workers to the cloud application. Ensure client devices can reach the local backend and that the backend can reach the configured PostgreSQL services.

Set `DB_MODE=LOCAL` and configure `LOCAL_DB_HOST`, `LOCAL_DB_PORT`, `LOCAL_DB_NAME`, `LOCAL_DB_USER`, and `LOCAL_DB_PASSWORD` for independent local operation. For direct cloud-only operation use `DB_MODE=CLOUD` and the existing `DB_*` values (or `CLOUD_DB_*`). For Hybrid Mode, use `DB_MODE=HYBRID` and configure both `LOCAL_DB_*` and `CLOUD_DB_*` with distinct PostgreSQL databases. Cloud connections require verified TLS; set `CLOUD_DB_SSL_CA` only when a CA file must be supplied. Keep all credentials on the backend host.

On a cloud-only deployment, explicitly set `DB_MODE=CLOUD` and restart the backend after changing it. This configured cloud mode takes precedence over a previously persisted Hybrid selection, and the database/photo synchronization panel is hidden in the UI. To run a school-LAN hybrid backend, set `DB_MODE=HYBRID` there and configure both distinct database connections.

Set `SYNC_ENABLED=true`, `SYNC_AUTO_ENABLED=true`, `SYNC_INTERVAL=15000`, and `SYNC_BATCH_SIZE=100` as needed. `SYNC_AUTO_ENABLED` is the initial preference; after initialization, automatic sync can be paused or resumed in the administrator dashboard and the preference persists in the local sync state. Manual sync remains available while auto sync is paused; choose Local to Cloud, Cloud to Local, or Both Ways. Automatic sync always runs both directions. `SYNC_ENABLED=false` disables both automatic and manual sync. Use the dashboard's Test connection controls to check the local backend's local/cloud database connectivity.

Back up both databases, ensure their application schemas and required migrations are compatible, and apply `server/database/migrate_sync.postgres.sql` to both before selecting Hybrid Mode. This migration queues initial snapshots; inspect connection/migration status in the authenticated administrator Settings panel. The local backend is the sole sync worker, and the cloud application/database remains independently usable. Mode changes do not copy or delete application rows. A Hybrid Mode outage is retried in the local backend; concurrent edits require administrator conflict resolution.

To serve the UI from the school-LAN backend, build the client with `VITE_API_URL=/api`, set `SERVE_CLIENT=true`, and configure `CLIENT_URLS` to the exact browser origin. Use HTTPS for non-local networks and secure the host, firewall, database credentials, and backups. Photo bytes are not part of PostgreSQL synchronization. To accept photo uploads while offline, set `STORAGE_DRIVER=local` on this backend and configure the Supabase Storage credentials; Hybrid Mode sync uploads local photos and downloads cloud photos referenced by synchronized photo metadata, with retryable upload/download/delete tasks. The default photo folder is `server/storage/student-photos` and contains the durable queue, so include it in protected backups and do not serve it as static content.

## Production environment variables

Set secrets only in Render's server-side environment variables:

| Variable | Requirement |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | Supplied by Render |
| `SESSION_SECRET` | Random, at least 32 characters |
| `CLIENT_URLS` | Exact comma-separated HTTPS Netlify origin(s), no wildcard or trailing path |
| `SESSION_COOKIE_SAME_SITE` | Explicitly set `none` for cross-site hosts or `lax` for same-site hosts; production cookies are secure |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Supabase PostgreSQL connection parameters; server-side only |
| `DB_SSL` | `true`; PostgreSQL TLS certificate verification remains enabled |
| `DB_SSL_CA` | Optional path to the trusted CA certificate PEM when the runtime does not trust the Supabase certificate chain |
| `STORAGE_DRIVER` | `supabase` for cloud deployment; set to `local` only on the school-LAN backend |
| `STUDENT_PHOTO_STORAGE_DIR` | Optional local photo folder; defaults to `server/storage/student-photos` |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | Server-side Supabase project URL and secret key |
| `SUPABASE_STORAGE_BUCKET` | Existing private Storage bucket (defaults to `student-photos`) |
| `DB_CONNECTION_LIMIT`, `DB_CONNECT_TIMEOUT_MS`, `DB_IDLE_TIMEOUT_MS` | Tune to provider connection limits (defaults 10/10000/30000ms) |

Rate-limit settings and development placeholders are listed in `server/.env.example`. The `VITE_*` variables are public browser configuration only; never place database, session, or Supabase secret keys there.

## Supabase PostgreSQL

1. In Supabase, create or select the project and open **Project Settings → Database** to get the connection parameters and a connection option reachable from Render.
2. Set the PostgreSQL parameters server-side in Render (or in `server/.env` for local development):

   ```env
   DB_HOST=db.<project-ref>.supabase.co
   DB_PORT=5432
   DB_NAME=postgres
   DB_USER=postgres
   DB_PASSWORD=<database-password>
   DB_SSL=true
   ```

3. Keep `DB_SSL=true` so the Express backend verifies the database TLS certificate. If Node reports `SELF_SIGNED_CERT_IN_CHAIN`, download the database CA certificate from Supabase **Project Settings → Database → SSL Configuration**, save the PEM file under `server` (for example `server/certs/supabase-ca.crt`), then set `DB_SSL_CA=certs/supabase-ca.crt` in `server/.env`. The backend loads that CA and keeps certificate verification enabled. Never disable verification or put the database password or Supabase Storage secret key in frontend variables.
4. For this fresh-database setup, run `database/schema.postgres.sql` once in the Supabase SQL Editor against the intended empty database. `database/seed.sql` is optional and contains only fictional development records. Do not apply the legacy MySQL `schema.sql` or MySQL migrations. No Aiven records are copied, and the Aiven database is not changed.
5. Test `/api/ready`, login, and representative CRUD workflows in staging. No live Supabase credentials are available in this repository, so connectivity must be confirmed in your deployment.

## Render API

Create a Render Web Service from the GitHub repository and set its **Root Directory** to `server`. Use the lockfile-based install command `npm ci` and start command `npm start`. The API binds to `0.0.0.0:$PORT`, supports SIGTERM graceful shutdown, and exposes:

- `GET /api/live` — process liveness (does not query the database).
- `GET /api/ready` — readiness; checks PostgreSQL availability.
- `GET /api/health` — backwards-compatible readiness check.

Configure the Render health check to `/api/ready`. Attach a custom HTTPS domain if desired. Set `CLIENT_URLS=https://schoolinfoportal.netlify.app` and verify session-cookie behavior from the deployed frontend. Configure the database and Supabase Storage variables before deployment; the cloud deployment should use `STORAGE_DRIVER=supabase` and verified database TLS. Set `SESSION_COOKIE_SAME_SITE=lax` for the same-origin Netlify proxy and keep the production cookie secure; the app trusts Render's single proxy hop.

Schema upgrades remain explicit operator steps, not a startup command. Review and test each SQL migration on a restored staging copy before production. For saved empty periods in the editable class timetable, apply `database/migrate_class_schedule_time_slots.postgres.sql`; it creates and seeds periods from existing active schedules.

## Netlify frontend

The root `netlify.toml` sets base directory `client`, runs `npm run build`, publishes `dist`, proxies `/api/*` to the Render API, and rewrites other SPA paths to `index.html`. Connect the GitHub repository in Netlify and set:

- `VITE_API_URL=/api`

Trigger a production build and verify the resulting login, refresh/deep links, session cookie, image retrieval, and `/api/ready` endpoint. The build intentionally fails if `VITE_API_URL` is not set. The browser now talks to its own Netlify origin, avoiding reliance on third-party-cookie support; keep `CLIENT_URLS` set to the exact frontend origin for the proxied requests.

## Supabase Storage for student photos

Supabase PostgreSQL stores relational data and sessions; Supabase Storage stores photo objects. The backend uses `pg` for PostgreSQL and `@supabase/supabase-js` for Storage.

1. In the Supabase project dashboard, create a **private** Storage bucket named `student-photos` (or set another bucket name). The bucket must exist before uploads; the application does not create buckets.
2. Copy the project URL and create a server-side secret key in Supabase. Configure these values only in Render's **server-side** variables or the local `server/.env`:

   ```env
   STORAGE_DRIVER=supabase
   SUPABASE_URL=https://<project-ref>.supabase.co
   SUPABASE_SECRET_KEY=<server-side-secret-key>
   SUPABASE_STORAGE_BUCKET=student-photos
   ```

   Never use the anon/publishable key or expose the secret key in Netlify or any `VITE_*` setting. The secret key has broad access to the project; restrict it to backend operations and rotate it if exposed. Supabase configuration is required for cloud storage and for the school-LAN photo queue to synchronize.
3. Verify upload, authorized photo retrieval, and deletion against the private bucket in staging. Objects remain private and are served through the API only after its existing sign-in and student-scope checks. Uploads accept JPEG or WebP up to 1 MiB. Existing local photo files are not migrated automatically.

For the school-LAN backend, set `STORAGE_DRIVER=local` while retaining the Supabase settings above. The backend writes uploads to `STUDENT_PHOTO_STORAGE_DIR` (default `server/storage/student-photos`) and records pending upload/download/delete work in its `.sync-queue` subfolder. In Hybrid Mode, automatic synchronization retries queued work in both directions; the Settings panel shows pending and failed photo upload/download counts. Photos referenced by either synchronized database are downloaded to the local folder. Back up the entire local photo folder, including `.sync-queue`, and protect it as sensitive student data.

Objects are stored in the configured private bucket, are not made public, and are served through the API only after its existing sign-in and student-scope checks. Establish bucket backup/versioning and retention policy separately from PostgreSQL backups; deletion/replacement of a student photo deletes its object after queued synchronization. Existing local photo files are not migrated automatically.

## Files and backups

## Backups

Use Supabase's supported PostgreSQL backup/restore options and retain encrypted offsite copies under the organization's retention policy. Back up the Storage photo bucket separately using Supabase's export/backup approach or a separately tested S3-compatible copy process. Test restoration of both services together; a database restore without matching photos leaves broken photo references.

## Logs and troubleshooting

Render stdout contains structured JSON request IDs, status, duration, and low-detail error events; it does not contain request bodies or raw errors. Use the `X-Request-ID` response header when correlating a client report with Render logs. Monitor readiness failures, HTTP 5xx/429 rates, database connection saturation, and object-store failures.

- `503`/failed readiness: verify the Supabase PostgreSQL connection parameters, database permissions/TLS, and Render egress.
- Browser CORS or missing session: verify the root Netlify `/api/*` proxy, `VITE_API_URL=/api`, `CLIENT_URLS`, HTTPS, and `SESSION_COOKIE_SAME_SITE`.
- `429`: check `Retry-After` and tune documented per-category limits using observed traffic.
- Photo errors: check that the Supabase bucket exists and is private, then verify `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SUPABASE_STORAGE_BUCKET`.
- Production startup refusal: verify `NODE_ENV`, PostgreSQL `DB_*` parameters, `DB_SSL`, Supabase Storage variables, and session secret are configured.

## Validation before release

```powershell
Set-Location D:\studydocs\projectsystem_production\server
npm.cmd ci
npm.cmd test
npm.cmd audit --omit=dev

Set-Location D:\studydocs\projectsystem_production\client
npm.cmd ci
$env:VITE_API_URL = '/api'
npm.cmd run build
```

Live provider verification, production migrations, and production deployment require explicit credentials/approval and are not performed by these local checks.
