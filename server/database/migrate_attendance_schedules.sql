-- LEGACY MYSQL ONLY: Do not run this migration against Supabase PostgreSQL.
USE sims_db;

DROP PROCEDURE IF EXISTS migrate_attendance_schedules;
DELIMITER //
CREATE PROCEDURE migrate_attendance_schedules()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'attendance_records' AND column_name = 'schedule_id'
  ) THEN
    ALTER TABLE attendance_records ADD COLUMN schedule_id BIGINT UNSIGNED NULL AFTER subject_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.referential_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'attendance_records'
      AND constraint_name = 'fk_attendance_schedule' AND delete_rule = 'SET NULL'
  ) THEN
    ALTER TABLE attendance_records DROP FOREIGN KEY fk_attendance_schedule;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'attendance_records'
      AND constraint_name = 'fk_attendance_schedule'
  ) THEN
    ALTER TABLE attendance_records
      ADD CONSTRAINT fk_attendance_schedule
      FOREIGN KEY (schedule_id) REFERENCES class_schedules(id) ON DELETE RESTRICT;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'attendance_records'
      AND index_name = 'uq_attendance_student_class_subject_date'
  ) THEN
    ALTER TABLE attendance_records DROP INDEX uq_attendance_student_class_subject_date;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'attendance_records'
      AND column_name = 'attendance_subject_scope'
  ) THEN
    ALTER TABLE attendance_records DROP COLUMN attendance_subject_scope;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'attendance_records'
      AND column_name = 'attendance_schedule_scope'
  ) THEN
    ALTER TABLE attendance_records
      ADD COLUMN attendance_schedule_scope BIGINT UNSIGNED
        GENERATED ALWAYS AS (COALESCE(schedule_id, subject_id, 0)) STORED;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'attendance_records'
      AND index_name = 'uq_attendance_student_class_schedule_date'
  ) THEN
    ALTER TABLE attendance_records
      ADD UNIQUE KEY uq_attendance_student_class_schedule_date
        (student_id, class_id, attendance_schedule_scope, attendance_date);
  END IF;
END//
DELIMITER ;

CALL migrate_attendance_schedules();
DROP PROCEDURE migrate_attendance_schedules;
