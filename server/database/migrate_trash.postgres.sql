ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE students ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE subjects ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE class_schedules ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;
ALTER TABLE assessments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP;

CREATE TABLE IF NOT EXISTS trash_records (
  entity_type VARCHAR(40) NOT NULL,
  record_public_id UUID NOT NULL,
  deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deleted_by BIGINT,
  PRIMARY KEY (entity_type, record_public_id)
);
CREATE INDEX IF NOT EXISTS idx_trash_records_deleted_at
  ON trash_records (deleted_at DESC);

UPDATE users SET deleted_at = CURRENT_TIMESTAMP WHERE is_deleted = 1 AND deleted_at IS NULL;
UPDATE teachers SET deleted_at = CURRENT_TIMESTAMP WHERE is_deleted = 1 AND deleted_at IS NULL;
UPDATE classes SET deleted_at = CURRENT_TIMESTAMP WHERE is_deleted = 1 AND deleted_at IS NULL;
UPDATE students SET deleted_at = CURRENT_TIMESTAMP WHERE is_deleted = 1 AND deleted_at IS NULL;
UPDATE subjects SET deleted_at = CURRENT_TIMESTAMP WHERE is_deleted = 1 AND deleted_at IS NULL;
UPDATE class_schedules SET deleted_at = CURRENT_TIMESTAMP WHERE is_deleted = 1 AND deleted_at IS NULL;
UPDATE assessments SET deleted_at = CURRENT_TIMESTAMP WHERE is_deleted = 1 AND deleted_at IS NULL;

INSERT INTO trash_records (entity_type, record_public_id, deleted_at)
SELECT 'students', public_id, COALESCE(deleted_at, CURRENT_TIMESTAMP) FROM students WHERE is_deleted = 1
ON CONFLICT (entity_type, record_public_id) DO NOTHING;
INSERT INTO trash_records (entity_type, record_public_id, deleted_at)
SELECT 'teachers', public_id, COALESCE(deleted_at, CURRENT_TIMESTAMP) FROM teachers WHERE is_deleted = 1
ON CONFLICT (entity_type, record_public_id) DO NOTHING;
INSERT INTO trash_records (entity_type, record_public_id, deleted_at)
SELECT 'classes', public_id, COALESCE(deleted_at, CURRENT_TIMESTAMP) FROM classes WHERE is_deleted = 1
ON CONFLICT (entity_type, record_public_id) DO NOTHING;
INSERT INTO trash_records (entity_type, record_public_id, deleted_at)
SELECT 'subjects', public_id, COALESCE(deleted_at, CURRENT_TIMESTAMP) FROM subjects WHERE is_deleted = 1
ON CONFLICT (entity_type, record_public_id) DO NOTHING;
INSERT INTO trash_records (entity_type, record_public_id, deleted_at)
SELECT 'users', public_id, COALESCE(deleted_at, CURRENT_TIMESTAMP) FROM users WHERE is_deleted = 1
ON CONFLICT (entity_type, record_public_id) DO NOTHING;
INSERT INTO trash_records (entity_type, record_public_id, deleted_at)
SELECT 'assessments', public_id, COALESCE(deleted_at, CURRENT_TIMESTAMP) FROM assessments WHERE is_deleted = 1
ON CONFLICT (entity_type, record_public_id) DO NOTHING;
INSERT INTO trash_records (entity_type, record_public_id, deleted_at)
SELECT 'class-schedules', public_id, COALESCE(deleted_at, CURRENT_TIMESTAMP) FROM class_schedules WHERE is_deleted = 1
ON CONFLICT (entity_type, record_public_id) DO NOTHING;
