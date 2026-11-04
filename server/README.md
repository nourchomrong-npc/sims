# SIMS backend

Express API for the Student Information Management System. It uses PostgreSQL, in-memory rate limits, and private Supabase Storage for student photos.

## Requirements

- Node.js 20 or newer
- npm
- PostgreSQL (Supabase PostgreSQL is the documented deployment target)
- Supabase Storage private bucket for student photos

## Configure

Create `server/.env` from the example:

```powershell
Copy-Item .env.example .env
```

Set the PostgreSQL connection variables (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`), keep `DB_SSL=true`, and configure a random `SESSION_SECRET` of at least 32 characters. Set `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SUPABASE_STORAGE_BUCKET` for the private photo bucket.

Rate limits use the default in-memory store; no Redis service is required.

Never commit `.env` or expose database, session, or Supabase secret values to the frontend.

## Initialize a new database

Apply `database/schema.postgres.sql` to the intended empty PostgreSQL database using the provider's SQL editor. Optionally apply `database/seed.sql` for fictional development data. For an existing PostgreSQL database, back it up and apply `database/migrate_record_timestamps.postgres.sql` using the provider's SQL editor to ensure all tables have timestamp defaults and update triggers. Existing rows without recorded timestamps remain blank. Apply `database/migrate_trash.postgres.sql` before deploying the Trash feature; it creates the separate `trash_records` table, adds deletion timestamps, and backfills existing hidden rows. Review and back up existing databases before applying any other migration.

Files named `schema.sql` and `migrate_*.sql` without the `.postgres` suffix are retained for legacy MySQL installations; do not run them against PostgreSQL.

## Install, test, and run

```powershell
npm ci
npm test
npm run dev
```

The API listens on port 5000 by default. Check `http://localhost:5000/api/health`. Create a development administrator only after database setup and connectivity are verified:

```powershell
npm run setup-admin
```

The setup utility is disabled in production and will not reset an existing account.

## GitHub Actions

The backend CI workflow runs `npm ci` and `npm test` on Node.js 20 and 22 for pushes and pull requests. It does not need production credentials or a live database.

## Deployment and operations

Deploy this repository as the API service with `npm ci` and `npm start`. Configure the frontend's exact HTTPS origin in `CLIENT_URLS`. Keep PostgreSQL TLS verification enabled and verify the database and Storage settings in staging before production.
