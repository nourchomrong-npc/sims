CREATE TABLE IF NOT EXISTS class_schedule_time_slots (
  class_id BIGINT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (class_id, start_time),
  CHECK (end_time > start_time)
);

INSERT INTO class_schedule_time_slots (class_id, start_time, end_time)
SELECT class_id, start_time, MAX(end_time)
FROM class_schedules
WHERE active = 1 AND is_deleted = 0
GROUP BY class_id, start_time
ON CONFLICT (class_id, start_time) DO NOTHING;
