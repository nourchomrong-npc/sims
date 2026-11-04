BEGIN;

CREATE TABLE IF NOT EXISTS student_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR(150) NOT NULL,
  url VARCHAR(2048) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  owner_id UUID REFERENCES students(public_id) ON DELETE SET NULL,
  CONSTRAINT uq_student_photos_url UNIQUE (url)
);

CREATE INDEX IF NOT EXISTS idx_student_photos_owner_created
  ON student_photos (owner_id, created_at DESC);

INSERT INTO student_photos (title, url, owner_id)
SELECT 'Student profile photo', photo_url, public_id
FROM students
WHERE photo_url IS NOT NULL AND btrim(photo_url) <> ''
ON CONFLICT (url) DO NOTHING;

COMMIT;
