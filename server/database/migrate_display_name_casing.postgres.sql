BEGIN;

UPDATE users
SET full_name = initcap(btrim(full_name))
WHERE full_name IS NOT NULL AND full_name IS DISTINCT FROM initcap(btrim(full_name));

UPDATE teachers
SET full_name = initcap(btrim(full_name))
WHERE full_name IS NOT NULL AND full_name IS DISTINCT FROM initcap(btrim(full_name));

UPDATE students
SET english_name = initcap(btrim(english_name)),
    khmer_name = initcap(btrim(khmer_name)),
    guardian_name = initcap(btrim(guardian_name))
WHERE (english_name IS NOT NULL AND english_name IS DISTINCT FROM initcap(btrim(english_name)))
   OR (khmer_name IS NOT NULL AND khmer_name IS DISTINCT FROM initcap(btrim(khmer_name)))
   OR (guardian_name IS NOT NULL AND guardian_name IS DISTINCT FROM initcap(btrim(guardian_name)));

UPDATE classes
SET name = initcap(btrim(name)),
    grade_level = initcap(btrim(grade_level))
WHERE (name IS NOT NULL AND name IS DISTINCT FROM initcap(btrim(name)))
   OR (grade_level IS NOT NULL AND grade_level IS DISTINCT FROM initcap(btrim(grade_level)));

UPDATE subjects
SET name = initcap(btrim(name))
WHERE name IS NOT NULL AND name IS DISTINCT FROM initcap(btrim(name));

UPDATE terms
SET name = initcap(btrim(name))
WHERE name IS NOT NULL AND name IS DISTINCT FROM initcap(btrim(name));

UPDATE assessments
SET title = initcap(btrim(title))
WHERE title IS NOT NULL AND title IS DISTINCT FROM initcap(btrim(title));

UPDATE student_photos
SET title = initcap(btrim(title))
WHERE title IS NOT NULL AND title IS DISTINCT FROM initcap(btrim(title));

COMMIT;
