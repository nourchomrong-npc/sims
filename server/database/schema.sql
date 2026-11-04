-- LEGACY MYSQL ONLY: Supabase PostgreSQL uses schema.postgres.sql instead.
CREATE DATABASE IF NOT EXISTS sims_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE sims_db;

CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL DEFAULT (UUID()),
  username VARCHAR(80) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  role ENUM('Administrator','Teacher','School Manager') NOT NULL,
  teacher_id BIGINT UNSIGNED NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT 1,
  is_deleted BOOLEAN NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_public_id (public_id),
  UNIQUE KEY uq_users_username (username),
  UNIQUE KEY uq_users_teacher_id (teacher_id),
  KEY idx_users_role_active (role, active),
  KEY idx_users_name (full_name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sessions (
  session_id VARCHAR(128) COLLATE utf8mb4_bin NOT NULL,
  expires INT(11) UNSIGNED NOT NULL,
  data MEDIUMTEXT COLLATE utf8mb4_bin,
  PRIMARY KEY (session_id),
  KEY idx_sessions_expires (expires)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS academic_years (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL DEFAULT (UUID()),
  name VARCHAR(30) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_academic_years_public_id (public_id),
  UNIQUE KEY uq_academic_year_name (name),
  CHECK (end_date > start_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS teachers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL DEFAULT (UUID()),
  teacher_code VARCHAR(30) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(254) NULL,
  phone VARCHAR(30) NULL,
  hire_date DATE NULL,
  employment_status ENUM('Active','On Leave','Inactive') NOT NULL DEFAULT 'Active',
  is_deleted BOOLEAN NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_teachers_public_id (public_id),
  UNIQUE KEY uq_teachers_code (teacher_code),
  UNIQUE KEY uq_teachers_email (email),
  KEY idx_teachers_status (employment_status),
  KEY idx_teachers_name (full_name)
) ENGINE=InnoDB;

DROP PROCEDURE IF EXISTS add_users_teacher_fk;
DELIMITER //
CREATE PROCEDURE add_users_teacher_fk()
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_schema = DATABASE() AND table_name = 'users'
      AND constraint_name = 'fk_users_teacher'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT fk_users_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id) ON DELETE SET NULL;
  END IF;
END//
DELIMITER ;

CALL add_users_teacher_fk();
DROP PROCEDURE add_users_teacher_fk;

CREATE TABLE IF NOT EXISTS classes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL DEFAULT (UUID()),
  name VARCHAR(80) NOT NULL,
  grade_level VARCHAR(50) NOT NULL,
  academic_year_id BIGINT UNSIGNED NOT NULL,
  capacity SMALLINT UNSIGNED NOT NULL DEFAULT 40,
  homeroom_teacher_id BIGINT UNSIGNED NULL,
  active BOOLEAN NOT NULL DEFAULT 1,
  is_deleted BOOLEAN NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_classes_public_id (public_id),
  UNIQUE KEY uq_classes_year_name (academic_year_id, name),
  KEY idx_classes_grade (grade_level),
  KEY idx_classes_grade_name (grade_level, name),
  CONSTRAINT fk_classes_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CONSTRAINT fk_classes_homeroom FOREIGN KEY (homeroom_teacher_id) REFERENCES teachers(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS students (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL DEFAULT (UUID()),
  student_code VARCHAR(30) NOT NULL,
  english_name VARCHAR(150) NOT NULL,
  khmer_name VARCHAR(150) NULL,
  gender ENUM('Female','Male','Other') NOT NULL,
  date_of_birth DATE NULL,
  place_of_birth VARCHAR(255) NULL,
  address VARCHAR(500) NULL,
  phone VARCHAR(30) NULL,
  email VARCHAR(254) NULL,
  guardian_name VARCHAR(150) NULL,
  guardian_phone VARCHAR(30) NULL,
  enrollment_date DATE NOT NULL,
  status ENUM('Active','Archived','Graduated','Withdrawn') NOT NULL DEFAULT 'Active',
  is_deleted BOOLEAN NOT NULL DEFAULT 0,
  photo_url VARCHAR(2048) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_students_public_id (public_id),
  UNIQUE KEY uq_students_code (student_code),
  KEY idx_students_name (english_name),
  KEY idx_students_status (status),
  KEY idx_students_enrollment (enrollment_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS terms (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL DEFAULT (UUID()),
  academic_year_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_terms_public_id (public_id),
  UNIQUE KEY uq_terms_year_name (academic_year_id, name),
  CONSTRAINT fk_terms_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CHECK (end_date >= start_date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS student_enrollments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL DEFAULT (UUID()),
  student_id BIGINT UNSIGNED NOT NULL,
  class_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NOT NULL,
  enrollment_date DATE NOT NULL,
  exit_date DATE NULL,
  current BOOLEAN NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_student_enrollments_public_id (public_id),
  UNIQUE KEY uq_student_class_year (student_id, class_id, academic_year_id),
  KEY idx_student_enrollment_date (enrollment_date),
  KEY idx_enrollment_class_current (class_id, current),
  KEY idx_enrollment_student_current (student_id, current),
  CONSTRAINT fk_enrollment_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_enrollment_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_enrollment_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS subjects (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL DEFAULT (UUID()),
  code VARCHAR(30) NOT NULL,
  name VARCHAR(120) NOT NULL,
  description VARCHAR(500) NULL,
  active BOOLEAN NOT NULL DEFAULT 1,
  is_deleted BOOLEAN NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  UNIQUE KEY uq_subjects_public_id (public_id),
  UNIQUE KEY uq_subject_code (code),
  KEY idx_subject_name (name)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS teacher_assignments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL DEFAULT (UUID()),
  teacher_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  class_id BIGINT UNSIGNED NOT NULL,
  academic_year_id BIGINT UNSIGNED NOT NULL,
  active BOOLEAN NOT NULL DEFAULT 1,
  PRIMARY KEY (id),
  UNIQUE KEY uq_teacher_assignments_public_id (public_id),
  UNIQUE KEY uq_teacher_assignment (teacher_id, subject_id, class_id, academic_year_id),
  KEY idx_teacher_assignment_class_teacher_active (class_id, teacher_id, active),
  CONSTRAINT fk_assignment_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id),
  CONSTRAINT fk_assignment_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_assignment_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_assignment_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS class_schedules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL DEFAULT (UUID()),
  class_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  teacher_id BIGINT UNSIGNED NOT NULL,
  day_of_week TINYINT UNSIGNED NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  room VARCHAR(80) NULL,
  active BOOLEAN NOT NULL DEFAULT 1,
  is_deleted BOOLEAN NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_class_schedules_public_id (public_id),
  KEY idx_class_schedules_class_day_time (class_id, day_of_week, start_time),
  KEY idx_class_schedules_teacher_day_time (teacher_id, day_of_week, start_time),
  CONSTRAINT fk_schedule_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_schedule_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_schedule_teacher FOREIGN KEY (teacher_id) REFERENCES teachers(id),
  CHECK (day_of_week BETWEEN 1 AND 7),
  CHECK (end_time > start_time)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS attendance_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL DEFAULT (UUID()),
  student_id BIGINT UNSIGNED NOT NULL,
  class_id BIGINT UNSIGNED NOT NULL,
  subject_id BIGINT UNSIGNED NULL,
  schedule_id BIGINT UNSIGNED NULL,
  attendance_date DATE NOT NULL,
  status ENUM('Present','Absent','Late','Excused') NOT NULL,
  note VARCHAR(255) NULL,
  recorded_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  attendance_schedule_scope BIGINT UNSIGNED GENERATED ALWAYS AS (COALESCE(schedule_id, subject_id, 0)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_attendance_records_public_id (public_id),
  UNIQUE KEY uq_attendance_student_class_schedule_date (student_id, class_id, attendance_schedule_scope, attendance_date),
  KEY idx_attendance_date_class (attendance_date, class_id),
  KEY idx_attendance_student_date (student_id, attendance_date),
  KEY idx_attendance_schedule (schedule_id),
  CONSTRAINT fk_attendance_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_attendance_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_attendance_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_attendance_schedule FOREIGN KEY (schedule_id) REFERENCES class_schedules(id) ON DELETE RESTRICT,
  CONSTRAINT fk_attendance_user FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS assessments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL DEFAULT (UUID()),
  title VARCHAR(150) NOT NULL,
  subject_id BIGINT UNSIGNED NOT NULL,
  class_id BIGINT UNSIGNED NOT NULL,
  term_id BIGINT UNSIGNED NOT NULL,
  assessment_date DATE NOT NULL,
  maximum_score DECIMAL(8,2) UNSIGNED NOT NULL,
  created_by BIGINT UNSIGNED NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_assessments_public_id (public_id),
  KEY idx_assessment_class_date (class_id, assessment_date),
  KEY idx_assessment_date (assessment_date),
  CONSTRAINT fk_assessment_subject FOREIGN KEY (subject_id) REFERENCES subjects(id),
  CONSTRAINT fk_assessment_class FOREIGN KEY (class_id) REFERENCES classes(id),
  CONSTRAINT fk_assessment_term FOREIGN KEY (term_id) REFERENCES terms(id),
  CONSTRAINT fk_assessment_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS student_scores (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL DEFAULT (UUID()),
  assessment_id BIGINT UNSIGNED NOT NULL,
  student_id BIGINT UNSIGNED NOT NULL,
  score DECIMAL(8,2) UNSIGNED NOT NULL,
  comment VARCHAR(255) NULL,
  entered_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_student_scores_public_id (public_id),
  UNIQUE KEY uq_student_assessment (assessment_id, student_id),
  KEY idx_scores_student (student_id),
  CONSTRAINT fk_score_assessment FOREIGN KEY (assessment_id) REFERENCES assessments(id),
  CONSTRAINT fk_score_student FOREIGN KEY (student_id) REFERENCES students(id),
  CONSTRAINT fk_score_user FOREIGN KEY (entered_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS grading_scales (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL DEFAULT (UUID()),
  academic_year_id BIGINT UNSIGNED NOT NULL,
  label VARCHAR(20) NOT NULL,
  minimum_percentage DECIMAL(5,2) UNSIGNED NOT NULL,
  maximum_percentage DECIMAL(5,2) UNSIGNED NOT NULL,
  description VARCHAR(100) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_grading_scales_public_id (public_id),
  UNIQUE KEY uq_grading_label_year (academic_year_id, label),
  KEY idx_grading_range (academic_year_id, minimum_percentage, maximum_percentage),
  CONSTRAINT fk_grading_year FOREIGN KEY (academic_year_id) REFERENCES academic_years(id),
  CHECK (maximum_percentage >= minimum_percentage),
  CHECK (maximum_percentage <= 100)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS activity_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id CHAR(36) NOT NULL DEFAULT (UUID()),
  user_id BIGINT UNSIGNED NULL,
  action VARCHAR(80) NOT NULL,
  entity VARCHAR(80) NOT NULL,
  entity_id BIGINT UNSIGNED NULL,
  details JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_activity_logs_public_id (public_id),
  KEY idx_activity_created (created_at),
  KEY idx_activity_user (user_id, created_at),
  KEY idx_activity_entity (entity, entity_id),
  CONSTRAINT fk_activity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB;
