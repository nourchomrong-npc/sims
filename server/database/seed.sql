-- PostgreSQL development seed; apply after schema.postgres.sql.
INSERT INTO academic_years (name, start_date, end_date, is_current) VALUES
('2026-2027', '2026-09-01', '2027-08-31', 1)
ON CONFLICT (name) DO NOTHING;

INSERT INTO terms (academic_year_id, name, start_date, end_date)
SELECT academic_years.id, 'Term 1', '2026-09-01', '2027-01-15' FROM academic_years WHERE name = '2026-2027'
ON CONFLICT (academic_year_id, name) DO NOTHING;
INSERT INTO terms (academic_year_id, name, start_date, end_date)
SELECT academic_years.id, 'Term 2', '2027-01-16', '2027-05-31' FROM academic_years WHERE name = '2026-2027'
ON CONFLICT (academic_year_id, name) DO NOTHING;
INSERT INTO terms (academic_year_id, name, start_date, end_date)
SELECT academic_years.id, 'Term 3', '2027-06-01', '2027-08-31' FROM academic_years WHERE name = '2026-2027'
ON CONFLICT (academic_year_id, name) DO NOTHING;

INSERT INTO teachers (teacher_code, full_name, email, phone, hire_date, employment_status) VALUES
('TCH-001','Sokha Chan','sokha.chan@example.test','012-555-0101','2020-08-15','Active'),
('TCH-002','Dara Vann','dara.vann@example.test','012-555-0102','2019-06-10','Active'),
('TCH-003','Maly Kim','maly.kim@example.test','012-555-0103','2021-01-20','Active'),
('TCH-004','Pisey Sam','pisey.sam@example.test','012-555-0104','2018-09-01','Active'),
('TCH-005','Vicheka Lim','vicheka.lim@example.test','012-555-0105','2022-02-01','Active')
ON CONFLICT (teacher_code) DO NOTHING;

INSERT INTO classes (name, grade_level, academic_year_id, capacity, homeroom_teacher_id)
SELECT 'Grade 7A','Grade 7',ay.id,35,t.id FROM academic_years ay JOIN teachers t ON t.teacher_code='TCH-001' WHERE ay.name='2026-2027'
ON CONFLICT (academic_year_id, name) DO NOTHING;
INSERT INTO classes (name, grade_level, academic_year_id, capacity, homeroom_teacher_id)
SELECT 'Grade 7B','Grade 7',ay.id,35,t.id FROM academic_years ay JOIN teachers t ON t.teacher_code='TCH-002' WHERE ay.name='2026-2027'
ON CONFLICT (academic_year_id, name) DO NOTHING;
INSERT INTO classes (name, grade_level, academic_year_id, capacity, homeroom_teacher_id)
SELECT 'Grade 8A','Grade 8',ay.id,35,t.id FROM academic_years ay JOIN teachers t ON t.teacher_code='TCH-003' WHERE ay.name='2026-2027'
ON CONFLICT (academic_year_id, name) DO NOTHING;
INSERT INTO classes (name, grade_level, academic_year_id, capacity, homeroom_teacher_id)
SELECT 'Grade 8B','Grade 8',ay.id,35,t.id FROM academic_years ay JOIN teachers t ON t.teacher_code='TCH-004' WHERE ay.name='2026-2027'
ON CONFLICT (academic_year_id, name) DO NOTHING;

INSERT INTO subjects (code, name, description) VALUES
('ENG','English','English language and communication'),
('MATH','Mathematics','Mathematical concepts and problem solving'),
('SCI','Science','General science'),
('KH','Khmer','Khmer language and literature'),
('HIST','History','Cambodian and world history'),
('ICT','ICT','Information and communication technology')
ON CONFLICT (code) DO NOTHING;

INSERT INTO students (student_code, english_name, khmer_name, gender, date_of_birth, place_of_birth, address, phone, email, guardian_name, guardian_phone, enrollment_date, status) VALUES
('STU-2026-001','Sokunthea Sok','សុខុនធា សុខ','Female','2013-02-14','Phnom Penh','Chamkar Mon, Phnom Penh','012-600-0001',NULL,'Sok Sok','012-700-0001','2026-09-01','Active'),
('STU-2026-002','Vannak Chea','វណ្ណៈ ជា','Male','2013-04-22','Kandal','Takhmao, Kandal','012-600-0002',NULL,'Chea Vann','012-700-0002','2026-09-01','Active'),
('STU-2026-003','Sreypov Noun','ស្រីពៅ នួន','Female','2013-06-05','Phnom Penh','Tuol Kork, Phnom Penh','012-600-0003',NULL,'Noun Srey','012-700-0003','2026-09-01','Active'),
('STU-2026-004','Borey Heng','បុរី ហេង','Male','2013-08-19','Takeo','Dangkao, Phnom Penh','012-600-0004',NULL,'Heng Bora','012-700-0004','2026-09-01','Active'),
('STU-2026-005','Chanmony Keo','ចន្ទមុនី កែវ','Female','2013-10-11','Kampong Cham','Sen Sok, Phnom Penh','012-600-0005',NULL,'Keo Chan','012-700-0005','2026-09-01','Active'),
('STU-2026-006','Rithy Mao','រិទ្ធី ម៉ៅ','Male','2013-12-03','Phnom Penh','Meanchey, Phnom Penh','012-600-0006',NULL,'Mao Rith','012-700-0006','2026-09-01','Active'),
('STU-2026-007','Sophea Touch','សុភា ទូច','Female','2013-03-27','Prey Veng','Chbar Ampov, Phnom Penh','012-600-0007',NULL,'Touch Sop','012-700-0007','2026-09-01','Active'),
('STU-2026-008','Davin Phan','ដាវីន ផាន់','Male','2013-05-16','Kandal','Russey Keo, Phnom Penh','012-600-0008',NULL,'Phan Dav','012-700-0008','2026-09-01','Active'),
('STU-2026-009','Kunthea Ly','គន្ធា លី','Female','2013-07-09','Phnom Penh','Por Sen Chey, Phnom Penh','012-600-0009',NULL,'Ly Kun','012-700-0009','2026-09-01','Active'),
('STU-2026-010','Piseth Ouk','ពិសិដ្ឋ អ៊ុក','Male','2013-09-24','Kampot','Doun Penh, Phnom Penh','012-600-0010',NULL,'Ouk Pis','012-700-0010','2026-09-01','Active'),
('STU-2026-011','Rachana Em','រចនា អែម','Female','2013-11-30','Kampong Speu','Chroy Changvar, Phnom Penh','012-600-0011',NULL,'Em Rach','012-700-0011','2026-09-01','Active'),
('STU-2026-012','Sovannary Yim','សុវណ្ណារី យឹម','Female','2013-01-17','Phnom Penh','Boeung Keng Kang, Phnom Penh','012-600-0012',NULL,'Yim Sov','012-700-0012','2026-09-01','Active'),
('STU-2026-013','Dara Chhim','ដារ៉ា ឈឹម','Male','2013-02-28','Kandal','Ta Khmau, Kandal','012-600-0013',NULL,'Chhim Dar','012-700-0013','2026-09-01','Active'),
('STU-2026-014','Sopheap Ros','សុភាព រស់','Female','2013-04-06','Phnom Penh','Sen Sok, Phnom Penh','012-600-0014',NULL,'Ros Sop','012-700-0014','2026-09-01','Active'),
('STU-2026-015','Vireak Sar','វិរៈ សារ','Male','2013-06-21','Svay Rieng','Mean Chey, Phnom Penh','012-600-0015',NULL,'Sar Vir','012-700-0015','2026-09-01','Active'),
('STU-2026-016','Bopha Koy','បុប្ផា គយ','Female','2013-08-13','Phnom Penh','Toul Kork, Phnom Penh','012-600-0016',NULL,'Koy Bop','012-700-0016','2026-09-01','Active'),
('STU-2026-017','Ratha Sean','រដ្ឋា ស៊ាន','Male','2013-10-02','Kampong Thom','Chbar Ampov, Phnom Penh','012-600-0017',NULL,'Sean Rat','012-700-0017','2026-09-01','Active'),
('STU-2026-018','Monyka Chou','មុនីកា ជូ','Female','2013-12-15','Phnom Penh','Dangkao, Phnom Penh','012-600-0018',NULL,'Chou Mon','012-700-0018','2026-09-01','Active'),
('STU-2026-019','Ravy Sok','រវី សុខ','Male','2013-03-11','Kandal','Chroy Changvar, Phnom Penh','012-600-0019',NULL,'Sok Rav','012-700-0019','2026-09-01','Active'),
('STU-2026-020','Nita Cheam','នីតា ជាម','Female','2013-05-29','Phnom Penh','Russey Keo, Phnom Penh','012-600-0020',NULL,'Cheam Nit','012-700-0020','2026-09-01','Active'),
('STU-2026-021','Sokleap Nhem','សុខលាភ ញឹម','Male','2012-07-18','Takeo','Chamkar Mon, Phnom Penh','012-600-0021',NULL,'Nhem Sok','012-700-0021','2026-09-01','Active'),
('STU-2026-022','Khemera Huot','ខេមរា ហួត','Female','2012-09-04','Phnom Penh','Por Sen Chey, Phnom Penh','012-600-0022',NULL,'Huot Khe','012-700-0022','2026-09-01','Active'),
('STU-2026-023','Sotheary Vong','សុធារី វង្ស','Female','2012-11-25','Kandal','Meanchey, Phnom Penh','012-600-0023',NULL,'Vong Sot','012-700-0023','2026-09-01','Active'),
('STU-2026-024','Visal Kong','វិសាល គង់','Male','2012-01-08','Phnom Penh','Doun Penh, Phnom Penh','012-600-0024',NULL,'Kong Vis','012-700-0024','2026-09-01','Active'),
('STU-2026-025','Sreymom Tep','ស្រីមុំ ទេព','Female','2012-03-20','Kampong Cham','Boeung Keng Kang, Phnom Penh','012-600-0025',NULL,'Tep Sre','012-700-0025','2026-09-01','Active'),
('STU-2026-026','Makara Pich','មករា ពេជ្រ','Male','2012-05-12','Phnom Penh','Sen Sok, Phnom Penh','012-600-0026',NULL,'Pich Mak','012-700-0026','2026-09-01','Active'),
('STU-2026-027','Sophalin Chann','សុផលិន ចាន់','Female','2012-07-30','Prey Veng','Toul Kork, Phnom Penh','012-600-0027',NULL,'Chann Sop','012-700-0027','2026-09-01','Active'),
('STU-2026-028','Dany Khun','ដានី ឃុន','Male','2012-09-16','Phnom Penh','Chbar Ampov, Phnom Penh','012-600-0028',NULL,'Khun Dan','012-700-0028','2026-09-01','Active'),
('STU-2026-029','Pichary Chea','ពិចារី ជា','Female','2012-11-07','Kampot','Dangkao, Phnom Penh','012-600-0029',NULL,'Chea Pic','012-700-0029','2026-09-01','Active'),
('STU-2026-030','Sovichea Sim','សុវិជ្ជា ស៊ីម','Male','2012-12-22','Phnom Penh','Russey Keo, Phnom Penh','012-600-0030',NULL,'Sim Sov','012-700-0030','2026-09-01','Active')
ON CONFLICT (student_code) DO NOTHING;

INSERT INTO student_enrollments (student_id, class_id, academic_year_id, enrollment_date, current)
SELECT s.id, c.id, ay.id, s.enrollment_date, 1 FROM students s
JOIN academic_years ay ON ay.name='2026-2027'
JOIN classes c ON c.name = CASE
  WHEN CAST(SUBSTRING(s.student_code, 10) AS INTEGER) BETWEEN 1 AND 8 THEN 'Grade 7A'
  WHEN CAST(SUBSTRING(s.student_code, 10) AS INTEGER) BETWEEN 9 AND 16 THEN 'Grade 7B'
  WHEN CAST(SUBSTRING(s.student_code, 10) AS INTEGER) BETWEEN 17 AND 23 THEN 'Grade 8A'
  ELSE 'Grade 8B' END
WHERE s.student_code LIKE 'STU-2026-%'
ON CONFLICT (student_id, class_id, academic_year_id) DO NOTHING;

INSERT INTO subjects (code, name, description) SELECT 'ART','Arts','Creative arts' WHERE NOT EXISTS (SELECT 1 FROM subjects WHERE code='ART');
INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, academic_year_id)
SELECT t.id, s.id, c.id, ay.id FROM teachers t
JOIN subjects s ON s.code = CASE MOD(t.id, 6)
  WHEN 0 THEN 'ENG' WHEN 1 THEN 'MATH' WHEN 2 THEN 'SCI'
  WHEN 3 THEN 'KH' WHEN 4 THEN 'HIST' ELSE 'ICT' END
JOIN classes c ON c.academic_year_id = (SELECT id FROM academic_years WHERE name='2026-2027')
JOIN academic_years ay ON ay.id = c.academic_year_id
ON CONFLICT (teacher_id, subject_id, class_id, academic_year_id) DO NOTHING;

INSERT INTO class_schedules (class_id, subject_id, teacher_id, day_of_week, start_time, end_time, room)
SELECT ranked_assignments.class_id, ranked_assignments.subject_id, ranked_assignments.teacher_id,
  weekdays.day_of_week, periods.start_time, periods.end_time,
  CONCAT('Room ', ranked_classes.class_rank, '-', periods.period_number)
FROM (
  SELECT c.id, ROW_NUMBER() OVER (ORDER BY c.grade_level, c.name) AS class_rank
  FROM classes c
  JOIN academic_years ay ON ay.id = c.academic_year_id
  WHERE ay.name = '2026-2027' AND c.active = 1 AND c.is_deleted = 0
) ranked_classes
JOIN (
  SELECT ta.class_id, ta.subject_id, ta.teacher_id,
    ROW_NUMBER() OVER (PARTITION BY ta.class_id ORDER BY t.teacher_code) AS teacher_rank
  FROM teacher_assignments ta
  JOIN teachers t ON t.id = ta.teacher_id AND t.employment_status = 'Active' AND t.is_deleted = 0
  JOIN classes c ON c.id = ta.class_id AND c.active = 1 AND c.is_deleted = 0
  JOIN academic_years ay ON ay.id = c.academic_year_id
  WHERE ay.name = '2026-2027' AND ta.active = 1
) ranked_assignments ON ranked_assignments.class_id = ranked_classes.id
CROSS JOIN (
  SELECT 1 AS day_of_week UNION ALL SELECT 2 UNION ALL SELECT 3 UNION ALL SELECT 4 UNION ALL SELECT 5
) weekdays
CROSS JOIN (
  SELECT 1 AS period_number, TIME '08:00:00' AS start_time, TIME '08:50:00' AS end_time
  UNION ALL SELECT 2, '09:00:00', '09:50:00'
  UNION ALL SELECT 3, '10:00:00', '10:50:00'
  UNION ALL SELECT 4, '11:00:00', '11:50:00'
  UNION ALL SELECT 5, '13:00:00', '13:50:00'
) periods
WHERE periods.period_number = MOD(ranked_assignments.teacher_rank + ranked_classes.class_rank - 2, 5) + 1
  AND NOT EXISTS (
    SELECT 1 FROM class_schedules existing
    WHERE existing.class_id = ranked_assignments.class_id
      AND existing.subject_id = ranked_assignments.subject_id
      AND existing.teacher_id = ranked_assignments.teacher_id
      AND existing.day_of_week = weekdays.day_of_week
  );

INSERT INTO grading_scales (academic_year_id, label, minimum_percentage, maximum_percentage, description)
SELECT academic_years.id, 'A', 90, 100, 'Excellent' FROM academic_years WHERE name='2026-2027'
ON CONFLICT (academic_year_id, label) DO NOTHING;
INSERT INTO grading_scales (academic_year_id, label, minimum_percentage, maximum_percentage, description)
SELECT academic_years.id, 'B', 80, 89.99, 'Very good' FROM academic_years WHERE name='2026-2027'
ON CONFLICT (academic_year_id, label) DO NOTHING;
INSERT INTO grading_scales (academic_year_id, label, minimum_percentage, maximum_percentage, description)
SELECT academic_years.id, 'C', 70, 79.99, 'Good' FROM academic_years WHERE name='2026-2027'
ON CONFLICT (academic_year_id, label) DO NOTHING;
INSERT INTO grading_scales (academic_year_id, label, minimum_percentage, maximum_percentage, description)
SELECT academic_years.id, 'D', 60, 69.99, 'Satisfactory' FROM academic_years WHERE name='2026-2027'
ON CONFLICT (academic_year_id, label) DO NOTHING;
INSERT INTO grading_scales (academic_year_id, label, minimum_percentage, maximum_percentage, description)
SELECT academic_years.id, 'F', 0, 59.99, 'Needs improvement' FROM academic_years WHERE name='2026-2027'
ON CONFLICT (academic_year_id, label) DO NOTHING;

INSERT INTO attendance_records (student_id, class_id, subject_id, attendance_date, status, note)
SELECT DISTINCT s.id, e.class_id, ta.subject_id, CURRENT_DATE,
  CASE WHEN MOD(CAST(SUBSTRING(s.student_code, 10) AS INTEGER), 13) = 0 THEN 'Absent'
       WHEN MOD(CAST(SUBSTRING(s.student_code, 10) AS INTEGER), 11) = 0 THEN 'Late'
       ELSE 'Present' END, NULL
FROM students s JOIN student_enrollments e ON e.student_id=s.id AND e.current=1
JOIN teacher_assignments ta ON ta.class_id=e.class_id AND ta.academic_year_id=e.academic_year_id AND ta.active=1
ON CONFLICT (student_id, class_id, attendance_schedule_scope, attendance_date) DO NOTHING;
INSERT INTO attendance_records (student_id, class_id, subject_id, attendance_date, status, note)
SELECT DISTINCT s.id, e.class_id, ta.subject_id, CURRENT_DATE - INTERVAL '1 day',
  CASE WHEN MOD(CAST(SUBSTRING(s.student_code, 10) AS INTEGER), 10) = 0 THEN 'Excused'
       WHEN MOD(CAST(SUBSTRING(s.student_code, 10) AS INTEGER), 8) = 0 THEN 'Absent'
       ELSE 'Present' END, NULL
FROM students s JOIN student_enrollments e ON e.student_id=s.id AND e.current=1
JOIN teacher_assignments ta ON ta.class_id=e.class_id AND ta.academic_year_id=e.academic_year_id AND ta.active=1
ON CONFLICT (student_id, class_id, attendance_schedule_scope, attendance_date) DO NOTHING;

INSERT INTO assessments (title, subject_id, class_id, term_id, assessment_date, maximum_score)
SELECT 'Term 1 assessment', sub.id, c.id, term.id, CURRENT_DATE, 100
FROM subjects sub CROSS JOIN classes c
JOIN terms term ON term.academic_year_id=c.academic_year_id AND term.name='Term 1'
WHERE sub.code IN ('ENG','MATH','SCI') AND c.name IN ('Grade 7A','Grade 7B','Grade 8A','Grade 8B')
  AND NOT EXISTS (
    SELECT 1 FROM assessments existing
    WHERE existing.title='Term 1 assessment' AND existing.subject_id=sub.id
      AND existing.class_id=c.id AND existing.term_id=term.id
  );
INSERT INTO student_scores (assessment_id, student_id, score)
SELECT a.id, s.id, 55 + MOD(CAST(SUBSTRING(s.student_code, 10) AS INTEGER) * 7 + a.subject_id * 3, 46)
FROM assessments a JOIN student_enrollments e ON e.class_id=a.class_id AND e.current=1
JOIN students s ON s.id=e.student_id
WHERE a.title='Term 1 assessment'
ON CONFLICT (assessment_id, student_id) DO NOTHING;
