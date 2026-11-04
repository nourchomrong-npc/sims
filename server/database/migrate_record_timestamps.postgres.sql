BEGIN;

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name TEXT;
  timestamp_tables TEXT[] := ARRAY[
    'users',
    'user_sessions',
    'trash_records',
    'academic_years',
    'teachers',
    'classes',
    'students',
    'student_photos',
    'terms',
    'student_enrollments',
    'subjects',
    'teacher_assignments',
    'class_schedules',
    'class_schedule_time_slots',
    'attendance_records',
    'assessments',
    'student_scores',
    'grading_scales',
    'activity_logs'
  ];
BEGIN
  FOREACH table_name IN ARRAY timestamp_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ', table_name);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ', table_name);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP', table_name);
    EXECUTE format('ALTER TABLE public.%I ALTER COLUMN updated_at SET DEFAULT CURRENT_TIMESTAMP', table_name);
    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON public.%I (created_at DESC)', 'idx_' || table_name || '_created_at', table_name);
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', table_name || '_set_updated_at', table_name);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION set_updated_at()',
      table_name || '_set_updated_at',
      table_name
    );
  END LOOP;
END;
$$;

COMMIT;
