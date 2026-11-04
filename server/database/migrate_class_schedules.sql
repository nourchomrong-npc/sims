-- LEGACY MYSQL ONLY: Do not run this migration against Supabase PostgreSQL.
USE sims_db;

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
