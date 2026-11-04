-- LEGACY MYSQL ONLY: Do not run this migration against Supabase PostgreSQL.
USE sims_db;

DROP PROCEDURE IF EXISTS add_list_query_indexes;
DELIMITER //
CREATE PROCEDURE add_list_query_indexes()
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'teacher_assignments'
      AND index_name = 'idx_teacher_assignment_class_teacher_active') THEN
      ALTER TABLE teacher_assignments ADD KEY idx_teacher_assignment_class_teacher_active (class_id, teacher_id, active);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'teachers'
      AND index_name = 'idx_teachers_name') THEN
      ALTER TABLE teachers ADD KEY idx_teachers_name (full_name);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'classes'
      AND index_name = 'idx_classes_grade_name') THEN
      ALTER TABLE classes ADD KEY idx_classes_grade_name (grade_level, name);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.statistics
    WHERE table_schema = DATABASE() AND table_name = 'users'
      AND index_name = 'idx_users_name') THEN
      ALTER TABLE users ADD KEY idx_users_name (full_name);
  END IF;
END//
DELIMITER ;

CALL add_list_query_indexes();
DROP PROCEDURE add_list_query_indexes;
