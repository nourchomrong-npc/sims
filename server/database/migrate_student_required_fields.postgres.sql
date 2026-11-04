BEGIN;

DO $$
DECLARE
  incomplete_count BIGINT;
BEGIN
  SELECT COUNT(*) INTO incomplete_count
  FROM students
  WHERE khmer_name IS NULL
     OR date_of_birth IS NULL
     OR place_of_birth IS NULL
     OR phone IS NULL
     OR guardian_name IS NULL
     OR guardian_phone IS NULL;

  IF incomplete_count > 0 THEN
    RAISE NOTICE
      'Student required-field constraints were not applied: % existing records need review. See the report returned below, complete the records, then rerun this migration.',
      incomplete_count;
  ELSE
    ALTER TABLE students
      ALTER COLUMN khmer_name SET NOT NULL,
      ALTER COLUMN date_of_birth SET NOT NULL,
      ALTER COLUMN place_of_birth SET NOT NULL,
      ALTER COLUMN phone SET NOT NULL,
      ALTER COLUMN guardian_name SET NOT NULL,
      ALTER COLUMN guardian_phone SET NOT NULL;
    RAISE NOTICE 'Student required-field constraints applied successfully.';
  END IF;
END
$$;

SELECT
  public_id,
  student_code,
  english_name,
  array_remove(ARRAY[
    CASE WHEN khmer_name IS NULL THEN 'khmer_name' END,
    CASE WHEN date_of_birth IS NULL THEN 'date_of_birth' END,
    CASE WHEN place_of_birth IS NULL THEN 'place_of_birth' END,
    CASE WHEN phone IS NULL THEN 'phone' END,
    CASE WHEN guardian_name IS NULL THEN 'guardian_name' END,
    CASE WHEN guardian_phone IS NULL THEN 'guardian_phone' END
  ], NULL) AS missing_required_fields
FROM students
WHERE khmer_name IS NULL
   OR date_of_birth IS NULL
   OR place_of_birth IS NULL
   OR phone IS NULL
   OR guardian_name IS NULL
   OR guardian_phone IS NULL
ORDER BY student_code, public_id;

COMMIT;
