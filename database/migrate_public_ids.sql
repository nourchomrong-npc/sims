-- LEGACY MYSQL ONLY: Do not run this migration against Supabase PostgreSQL.
USE sims_db;

DROP PROCEDURE IF EXISTS add_public_ids;
DELIMITER //
CREATE PROCEDURE add_public_ids(IN table_name_value VARCHAR(64))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = table_name_value AND column_name = 'public_id'
  ) THEN
    SET @statement = CONCAT('ALTER TABLE `', table_name_value, '` ADD COLUMN public_id CHAR(36) NULL');
    PREPARE migration_statement FROM @statement;
    EXECUTE migration_statement;
    DEALLOCATE PREPARE migration_statement;
  END IF;

  SET @statement = CONCAT(
    'UPDATE `', table_name_value, '` SET public_id = UUID() WHERE public_id IS NULL'
  );
  PREPARE migration_statement FROM @statement;
  EXECUTE migration_statement;
  DEALLOCATE PREPARE migration_statement;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = table_name_value AND index_name = CONCAT('uq_', table_name_value, '_public_id')
  ) THEN
    SET @statement = CONCAT(
      'ALTER TABLE `', table_name_value, '` ADD UNIQUE KEY `uq_', table_name_value, '_public_id` (public_id)'
    );
    PREPARE migration_statement FROM @statement;
    EXECUTE migration_statement;
    DEALLOCATE PREPARE migration_statement;
  END IF;

  SET @statement = CONCAT(
    'ALTER TABLE `', table_name_value, '` MODIFY COLUMN public_id CHAR(36) NOT NULL DEFAULT (UUID())'
  );
  PREPARE migration_statement FROM @statement;
  EXECUTE migration_statement;
  DEALLOCATE PREPARE migration_statement;
END//
DELIMITER ;

CALL add_public_ids('users');
CALL add_public_ids('academic_years');
CALL add_public_ids('teachers');
CALL add_public_ids('classes');
CALL add_public_ids('students');
CALL add_public_ids('terms');
CALL add_public_ids('student_enrollments');
CALL add_public_ids('subjects');
CALL add_public_ids('teacher_assignments');
CALL add_public_ids('attendance_records');
CALL add_public_ids('assessments');
CALL add_public_ids('student_scores');
CALL add_public_ids('grading_scales');
CALL add_public_ids('activity_logs');

DROP PROCEDURE add_public_ids;

DROP PROCEDURE IF EXISTS add_is_deleted;
DELIMITER //
CREATE PROCEDURE add_is_deleted(IN table_name_value VARCHAR(64))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = table_name_value AND column_name = 'is_deleted'
  ) THEN
    SET @statement = CONCAT(
      'ALTER TABLE `', table_name_value, '` ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT 0'
    );
    PREPARE migration_statement FROM @statement;
    EXECUTE migration_statement;
    DEALLOCATE PREPARE migration_statement;
  END IF;
END//
DELIMITER ;

CALL add_is_deleted('users');
CALL add_is_deleted('teachers');
CALL add_is_deleted('classes');
CALL add_is_deleted('students');
CALL add_is_deleted('subjects');
CALL add_is_deleted('assessments');

DROP PROCEDURE add_is_deleted;

DROP PROCEDURE IF EXISTS add_teacher_user_link;
DELIMITER //
CREATE PROCEDURE add_teacher_user_link()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'users' AND column_name = 'teacher_id'
  ) THEN
    ALTER TABLE users ADD COLUMN teacher_id BIGINT UNSIGNED NULL AFTER role;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'uq_users_teacher_id'
  ) THEN
    ALTER TABLE users ADD UNIQUE KEY uq_users_teacher_id (teacher_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'users' AND constraint_name = 'fk_users_teacher'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL;
  END IF;
END//
DELIMITER ;

CALL add_teacher_user_link();
DROP PROCEDURE add_teacher_user_link;

DROP PROCEDURE IF EXISTS add_attendance_subject;
DELIMITER //
CREATE PROCEDURE add_attendance_subject()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'attendance_records' AND column_name = 'subject_id'
  ) THEN
    ALTER TABLE attendance_records ADD COLUMN subject_id BIGINT UNSIGNED NULL AFTER class_id;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'attendance_records' AND column_name = 'attendance_subject_scope'
  ) THEN
    ALTER TABLE attendance_records
      ADD COLUMN attendance_subject_scope BIGINT UNSIGNED
      GENERATED ALWAYS AS (COALESCE(subject_id, 0)) STORED;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'attendance_records'
      AND index_name = 'uq_attendance_student_class_date'
  ) THEN
    ALTER TABLE attendance_records DROP INDEX uq_attendance_student_class_date;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'attendance_records'
      AND index_name = 'uq_attendance_student_class_subject_date'
  ) THEN
    ALTER TABLE attendance_records
      ADD UNIQUE KEY uq_attendance_student_class_subject_date
      (student_id, class_id, attendance_subject_scope, attendance_date);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'attendance_records'
      AND constraint_name = 'fk_attendance_subject'
  ) THEN
    ALTER TABLE attendance_records
      ADD CONSTRAINT fk_attendance_subject FOREIGN KEY (subject_id) REFERENCES subjects(id);
  END IF;
END//
DELIMITER ;

CALL add_attendance_subject();
DROP PROCEDURE add_attendance_subject;
