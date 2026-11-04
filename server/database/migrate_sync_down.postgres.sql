BEGIN;

DO $$
DECLARE
  tracked_table TEXT;
  tracked_tables TEXT[] := ARRAY[
    'users', 'trash_records', 'academic_years', 'teachers', 'classes', 'students',
    'student_photos', 'terms', 'student_enrollments', 'subjects', 'teacher_assignments',
    'class_schedules', 'class_schedule_time_slots', 'attendance_records', 'assessments',
    'student_scores', 'grading_scales', 'activity_logs'
  ];
BEGIN
  FOREACH tracked_table IN ARRAY tracked_tables LOOP
    IF to_regclass(format('public.%I', tracked_table)) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', tracked_table || '_sync_change', tracked_table);
    END IF;
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS capture_sync_change();
DROP FUNCTION IF EXISTS sync_record_key(TEXT, JSONB);
DROP FUNCTION IF EXISTS sync_row_as_json(JSONB, TEXT);
DROP TRIGGER IF EXISTS class_schedule_time_slots_set_public_id ON class_schedule_time_slots;
DROP FUNCTION IF EXISTS set_class_schedule_public_id();
DROP TABLE IF EXISTS sync_history;
DROP TABLE IF EXISTS sync_conflicts;
DROP TABLE IF EXISTS sync_cursors;
DROP TABLE IF EXISTS sync_inbox;
DROP TABLE IF EXISTS sync_id_map;
DROP TABLE IF EXISTS sync_outbox;
DROP TABLE IF EXISTS sync_state;
ALTER TABLE class_schedule_time_slots DROP CONSTRAINT IF EXISTS fk_schedule_time_slot_class_public;
ALTER TABLE class_schedule_time_slots DROP COLUMN IF EXISTS class_public_id;

COMMIT;
