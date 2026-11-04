CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_users_username_trgm
  ON users USING GIN (username gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_users_full_name_trgm
  ON users USING GIN (full_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_teachers_code_trgm
  ON teachers USING GIN (teacher_code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_teachers_full_name_trgm
  ON teachers USING GIN (full_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_classes_name_trgm
  ON classes USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_students_code_trgm
  ON students USING GIN (student_code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_students_english_name_trgm
  ON students USING GIN (english_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_students_khmer_name_trgm
  ON students USING GIN (khmer_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_subject_code_trgm
  ON subjects USING GIN (code gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_subject_name_trgm
  ON subjects USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_class_schedules_room_trgm
  ON class_schedules USING GIN (room gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_assessments_title_trgm
  ON assessments USING GIN (title gin_trgm_ops);
