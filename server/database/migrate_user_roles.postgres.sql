BEGIN;

DO $$
DECLARE
  role_check RECORD;
BEGIN
  FOR role_check IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'users'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%role%'
  LOOP
    EXECUTE format('ALTER TABLE users DROP CONSTRAINT %I', role_check.conname);
  END LOOP;
END;
$$;

UPDATE users
SET role = 'SuperAdmin'
WHERE role = 'Administrator';

DELETE FROM user_sessions;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('SuperAdmin', 'Admin', 'Teacher', 'School Manager'));

COMMIT;
