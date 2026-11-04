# Database operations

## Engine and schema

The Express backend uses PostgreSQL through `pg`. Configure the server-only `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` connection parameters and enable verified TLS for cloud PostgreSQL. Supabase Storage is a separate service for private student-photo objects; photo bytes are never stored in PostgreSQL. The school-LAN backend can set `STORAGE_DRIVER=local` to save photos and a durable retry queue in `server/storage/student-photos`; in Hybrid Mode, local photos upload to Supabase and cloud photos referenced by either database download to the local folder. Configure the folder with `STUDENT_PHOTO_STORAGE_DIR` if needed and include it in protected backups.

The canonical schema for new databases is [`database/schema.postgres.sql`](./database/schema.postgres.sql). It creates the application tables, timestamp columns and defaults, update-timestamp triggers, and PostgreSQL session table. Optional fictional development data is in the PostgreSQL-compatible [`database/seed.sql`](./database/seed.sql). The old MySQL `schema.sql` and migration files in `database/` are retained only for legacy installations and must not be run against Supabase PostgreSQL.

The application tables are:

| Area | Tables |
|---|---|
| Identity/audit | `users`, `user_sessions`, `activity_logs` |
| Organization | `academic_years`, `terms`, `classes`, `subjects`, `teachers`, `teacher_assignments`, `class_schedules` |
| Student lifecycle and photo metadata | `students`, `student_enrollments`, `student_photos` |
| Attendance/results | `attendance_records`, `assessments`, `student_scores`, `grading_scales` |

Business tables use internal numeric primary keys and unique public UUIDs. Foreign keys preserve relationships, managed records use soft deletion, and timestamps are maintained by database defaults/triggers. Every application table has `created_at` and `updated_at`; legacy rows whose creation time was not recorded remain `NULL` rather than being assigned a fabricated historical date. New rows receive timestamp defaults, and updates refresh `updated_at`. The `user_sessions` table is managed by `connect-pg-simple`. Uploaded file bytes are stored in Supabase Storage, not PostgreSQL. `student_photos` stores photo metadata and a UUID reference to the owning student's public ID; existing student photo paths are copied by [`migrate_student_photos.postgres.sql`](./server/database/migrate_student_photos.postgres.sql). Metadata and stored objects are retained while Activity Logs reference the photo.

Student registration requires student name, Khmer name, gender, date of birth, place of birth, phone, guardian name and phone, enrollment date, and a current class. Email, address, and photo are optional. `migrate_student_required_fields.postgres.sql` adds `NOT NULL` constraints to the existing nullable required columns, but intentionally stops if existing rows contain missing values; review and complete those records before rerunning it. Existing students without a class can still be edited without changing their class.

Roles are `SuperAdmin`, `Admin`, `Teacher`, and `School Manager`. Apply [`migrate_user_roles.postgres.sql`](./server/database/migrate_user_roles.postgres.sql) to map existing `Administrator` accounts to `SuperAdmin`, update the database constraint, and clear current sessions so users receive their migrated role on next login. SuperAdmin has full access, including user and role management; Admin retains general administrative access but cannot view or manage user accounts, roles, password resets, or teacher login-account generation. Historical activity snapshots are not rewritten. Apply [`migrate_display_name_casing.postgres.sql`](./server/database/migrate_display_name_casing.postgres.sql) to title-case existing person, class, subject, term, assessment, and photo display names. API validation applies the same casing to new or edited display names while preserving usernames and record codes. The migration does not rewrite identifiers, usernames, codes, email addresses, or passwords.

School Managers can view, create, edit, soft-delete, and restore students, teachers, classes, subjects, and class schedules; manage teacher assignments; record and correct attendance; and view/print school reports. They can restore school records from Trash but cannot permanently delete them or manage system settings, sync, or administrator accounts. This application currently uses one school dataset per installation and does not provide per-school tenant scoping.

If `migrate_student_required_fields.postgres.sql` reports incomplete students, it returns their public ID, code, name, and missing-field list and leaves those columns nullable. Correct the real values, then rerun the migration to apply `NOT NULL`; it does not fabricate placeholder personal data.

`activity_logs.details` stores immutable actor and affected-user identity snapshots, full record snapshots for creation/removal and audited updates, field-level before/after changes, and request metadata as JSONB. Internal numeric user IDs remain only in the stored audit snapshot where needed for referential history; API responses remove those IDs and expose public UUIDs instead. Passwords, hashes, tokens, and secret fields are excluded. Existing activity rows are retained; rows created before snapshots were recorded show identity as unavailable when it cannot be verified. No audit migration is required because the existing JSONB column supports these additional details.

## Indexes and query patterns

The PostgreSQL schema defines public-ID and business-uniqueness constraints plus indexes for the primary list and relationship lookups. It also enables `pg_trgm` and adds GIN trigram indexes for the fields used in the application's substring searches:

- Identity and audit: user-name/role/active indexes; activity by creation time, user/time, and entity.
- Organization: academic-year/name uniqueness; class year/name uniqueness and grade indexes; teacher code/email uniqueness and status/name indexes; term year/name uniqueness; subject code/name indexes; timetable class/day/start and teacher/day/start indexes.
- Enrollment and assignment: unique student/class/year and teacher/subject/class/year constraints; current-enrollment and teacher-assignment lookup indexes.
- Attendance and outcomes: attendance date/class, student/date, and schedule indexes; unique student/class/schedule/date; assessment class/date and date indexes; unique assessment/student scores and student lookup; grading year/percentage range index.

These search indexes target `LIKE '%term%'` queries that ordinary B-tree indexes cannot accelerate. GIN trigram indexes cover user names, teacher codes/names, class names, student codes/names, subject codes/names, schedule rooms, and assessment titles. They consume additional storage and add write overhead; PostgreSQL may not use trigram indexes for very short search terms. For an existing PostgreSQL database, apply [`database/migrate_performance_indexes.postgres.sql`](./database/migrate_performance_indexes.postgres.sql) after taking a backup. Capture representative `EXPLAIN (ANALYZE, BUFFERS)` plans and monitor index size, query latency, and write impact. No live database or representative production data was available to measure query plans or claim a speedup.

Dashboard and metadata requests query PostgreSQL directly; the API does not use a Redis response cache. Rate limits use process-local in-memory counters and do not require Redis.

## Fresh setup and schema changes

The migration choice for the current Aiven-to-Supabase move is **fresh database**. Apply `database/schema.postgres.sql` to the intended empty Supabase database using the Supabase SQL Editor, then optionally apply `database/seed.sql` for fictional development records. Do not copy Aiven rows or run the legacy MySQL `schema.sql` or migration files. The Aiven database is not modified. For an existing PostgreSQL installation, back up the database and apply [`migrate_record_timestamps.postgres.sql`](./server/database/migrate_record_timestamps.postgres.sql) before deploying; schema changes do not run automatically at startup. It adds missing timestamp columns/defaults, update triggers, and indexes idempotently. New records are timestamped after the migration; existing rows without recorded dates stay `NULL`, since their original timestamps cannot be recovered. Review all production migrations against a backup/staging database.

Schema changes are explicit operator actions; they do not run automatically during application startup. Review and test future PostgreSQL DDL on a staging database and take a backup before applying it to production. `CREATE TABLE IF NOT EXISTS` does not repair an existing partial or incompatible schema; inspect the target before rerunning schema setup.

## Local-backend synchronization

The existing cloud application remains unchanged. Synchronization is performed only by the school-LAN local backend, which connects directly to local and cloud PostgreSQL using server-side credentials. `DB_MODE=LOCAL` and `DB_MODE=CLOUD` select one active database without synchronization; `DB_MODE=HYBRID` uses local PostgreSQL for application requests and synchronizes both ways. Lowercase `local_only`, `cloud_only`, and `hybrid` aliases are also accepted. `LOCAL_DB_*` and `CLOUD_DB_*` configure distinct database connections. Cloud TLS certificate verification cannot be disabled; configure `CLOUD_DB_SSL_CA` if the system trust store does not contain the issuing CA.

`SYNC_ENABLED` is the backend-wide gate for manual and automatic synchronization. `SYNC_AUTO_ENABLED` seeds the initial automatic-sync preference, and `SYNC_INTERVAL` controls the worker interval in milliseconds. Administrators can change the persisted automatic-sync preference from the local admin dashboard; manual sync remains available while automatic sync is paused. Per-database connection tests run from the local backend and return no credentials.

The default test suite skips the live two-database integration test. To run it, prepare two disposable loopback PostgreSQL databases whose names end in `_sync_test`, apply the application schema and sync migration to each, then set the `SYNC_TEST_LOCAL_DB_*` and `SYNC_TEST_CLOUD_DB_*` connection variables plus `SYNC_TEST_ALLOW_PLAINTEXT_LOOPBACK=true` in the test process and run `node --test test/sync.integration.test.js` from `server`. The guard rejects non-loopback hosts and database names without the suffix; never point these variables at application or production databases. The test covers direct SQL change capture, bidirectional updates/deletes, duplicate replay, ID/FK translation, conflict resolution, and retry after simulated connection loss.

Back up both databases, confirm their application schemas/migrations are compatible, and apply [`migrate_sync.postgres.sql`](./server/database/migrate_sync.postgres.sql) to each database before enabling Hybrid Mode. The migration adds triggers and sync metadata, preserves business IDs and foreign keys, and queues existing rows for an initial snapshot. It also adds a stable UUID reference for class time slots; apply the existing class-time-slot migration first. Sync tables contain event snapshots (including user password hashes in the restricted database outbox), so protect database access and backups accordingly. Administrative sync endpoints require an authenticated Admin or SuperAdmin session; database credentials are never sent to the browser.

Changes are staged in database-local outboxes and applied idempotently using event IDs and inbox records. Retried failures use exponential backoff; incompatible concurrent edits are retained as unresolved conflicts for administrator resolution. Local-only or cloud-only operation pauses database synchronization but does not erase pending changes or copy records as part of a mode switch. The migration excludes PostgreSQL sessions; each application backend manages its own sessions. Photo metadata is tracked in PostgreSQL, while photo bytes use a separate local filesystem queue when `STORAGE_DRIVER=local`; Hybrid Mode uploads local photos, downloads cloud photos referenced in either database, and propagates locally queued deletions with retry backoff. Back up the local photo folder along with the databases.

To undo the sync schema, stop the local backend's worker, back up both databases, then apply [`migrate_sync_down.postgres.sql`](./server/database/migrate_sync_down.postgres.sql) to both. The down migration removes sync metadata and the derived time-slot UUID, not application records; do not use it to reverse business changes that have already synchronized.

## Pooling

The PostgreSQL pool defaults to 10 connections, a 10-second connection timeout, and a 30-second idle timeout. Set `DB_CONNECTION_LIMIT`, `DB_CONNECT_TIMEOUT_MS`, and `DB_IDLE_TIMEOUT_MS` to fit the Supabase plan and combined Render instance count. The session store shares this pool. Keep the aggregate connection count below the provider limit.

## Backup and restore

Use the Supabase-supported backup/restore features for production. For a manual logical backup with PostgreSQL client tools:

```powershell
pg_dump --host="$env:DB_HOST" --port="$env:DB_PORT" --username="$env:DB_USER" --dbname="$env:DB_NAME" --format=custom --file=sims-db-backup.dump
```

Restore only into a deliberately selected target database after verifying the backup:

```powershell
pg_restore --host="$env:DB_HOST" --port="$env:DB_PORT" --username="$env:DB_USER" --dbname="$env:DB_NAME" --no-owner sims-db-backup.dump
```

Back up Supabase Storage objects separately; restoring PostgreSQL without the matching photo bucket can leave broken photo references. Test database and Storage restoration together in staging. No live restore has been performed.
