-- LEGACY MYSQL ONLY: Do not run this migration against Supabase PostgreSQL.
USE sims_db;

DROP PROCEDURE IF EXISTS migrate_dashboard_indexes;
DELIMITER //
CREATE PROCEDURE migrate_dashboard_indexes()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'student_enrollments'
      AND index_name = 'idx_student_enrollment_date'
  ) THEN
    ALTER TABLE student_enrollments
      ADD KEY idx_student_enrollment_date (enrollment_date);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'assessments'
      AND index_name = 'idx_assessment_date'
  ) THEN
    ALTER TABLE assessments
      ADD KEY idx_assessment_date (assessment_date);
  END IF;
END//
DELIMITER ;

CALL migrate_dashboard_indexes();
DROP PROCEDURE migrate_dashboard_indexes;
