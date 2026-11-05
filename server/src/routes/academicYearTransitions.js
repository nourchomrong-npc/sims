import { apiRoutes } from './apiRoutes.js';

const promotionStatuses = ['Promoted', 'Conditional Promotion', 'Retained/Repeat', 'Graduated', 'Transferred', 'Pending'];
const subjectOutcomes = ['Pass', 'Fail', 'Incomplete', 'Not Assessed'];

export function registerAcademicYearTransitionRoutes(router, context) {
  const { z, pool, logActivity, publicIdFor, publicizeRows, resolvePublicId, idParam, parse, publicId, admin } = context;
  const transitionOptionsQuery = z.object({ source_year_id: publicId });
  const transitionInput = z.object({
    source_year_id: publicId.nullable().optional(),
    year: z.object({
      name: z.string().trim().min(1).max(30),
      start_date: z.string().date(),
      end_date: z.string().date()
    }).refine(value => value.end_date > value.start_date, {
      path: ['end_date'], message: 'Academic year end date must be after its start date'
    }),
    copy: z.object({
      classes: z.boolean().default(true),
      terms: z.boolean().default(true),
      grading_scales: z.boolean().default(true),
      teacher_assignments: z.boolean().default(true),
      class_schedules: z.boolean().default(true)
    }),
    classes: z.array(z.object({
      source_class_id: publicId,
      template_class_id: publicId.nullable().optional(),
      name: z.string().trim().min(1).max(80),
      grade_level: z.string().trim().min(1).max(50),
      capacity: z.coerce.number().int().min(1).max(500),
      homeroom_teacher_id: publicId.nullable().optional()
    })).max(300),
    terms: z.array(z.object({
      source_term_id: publicId.nullable().optional(),
      name: z.string().trim().min(1).max(80),
      start_date: z.string().date(),
      end_date: z.string().date()
    })).max(100),
    teacher_assignments: z.array(z.object({
      class_source_id: publicId,
      subject_id: publicId,
      teacher_id: publicId
    })).max(1000).default([]),
    schedules: z.array(z.object({
      class_source_id: publicId,
      subject_id: publicId,
      teacher_id: publicId,
      day_of_week: z.coerce.number().int().min(1).max(7),
      start_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
      end_time: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
      room: z.string().trim().max(80).nullable().optional()
    })).max(2000),
    promotions: z.array(z.object({
      student_id: publicId,
      promotion_status: z.enum(promotionStatuses),
      homeroom_class_source_id: publicId.nullable().optional(),
      class_enrollments: z.array(publicId).max(100).default([])
    })).max(3000),
    subject_outcomes: z.array(z.object({
      student_id: publicId,
      class_source_id: publicId,
      subject_id: publicId,
      outcome: z.enum(subjectOutcomes)
    })).max(6000),
    activate_year: z.boolean().default(false)
  }).superRefine((value, validation) => {
    if (new Set(value.promotions.map(row => row.student_id)).size !== value.promotions.length) {
      validation.addIssue({ code: 'custom', path: ['promotions'], message: 'A student can only be included once in a transition.' });
    }
    if (new Set(value.classes.map(row => row.source_class_id)).size !== value.classes.length) {
      validation.addIssue({ code: 'custom', path: ['classes'], message: 'Each class can only be included once.' });
    }
    const templateClassIds = value.classes.map(row => row.template_class_id).filter(Boolean);
    if (new Set(templateClassIds).size !== templateClassIds.length) {
      validation.addIssue({ code: 'custom', path: ['classes'], message: 'A template class can only be copied once.' });
    }
    if (new Set(value.classes.map(row => row.name.toLowerCase())).size !== value.classes.length) {
      validation.addIssue({ code: 'custom', path: ['classes'], message: 'Class names must be unique for the new year.' });
    }
    if (new Set(value.terms.map(row => row.name.toLowerCase())).size !== value.terms.length) {
      validation.addIssue({ code: 'custom', path: ['terms'], message: 'Term names must be unique.' });
    }
    const assignmentKeys = value.teacher_assignments.map(row =>
      `${row.class_source_id}:${row.subject_id}:${row.teacher_id}`);
    if (new Set(assignmentKeys).size !== assignmentKeys.length) {
      validation.addIssue({ code: 'custom', path: ['teacher_assignments'], message: 'Teacher assignments cannot be duplicated.' });
    }
    for (const schedule of value.schedules) {
      if (schedule.end_time <= schedule.start_time) {
        validation.addIssue({ code: 'custom', path: ['schedules'], message: 'Schedule end times must be after their start times.' });
      }
      if (!assignmentKeys.includes(`${schedule.class_source_id}:${schedule.subject_id}:${schedule.teacher_id}`)) {
        validation.addIssue({ code: 'custom', path: ['schedules'], message: 'Each schedule must match a teacher assignment.' });
      }
    }
    for (let first = 0; first < value.schedules.length; first += 1) {
      for (let second = first + 1; second < value.schedules.length; second += 1) {
        const one = value.schedules[first];
        const two = value.schedules[second];
        const overlaps = one.day_of_week === two.day_of_week &&
          one.start_time < two.end_time && one.end_time > two.start_time;
        if (overlaps && (one.class_source_id === two.class_source_id ||
            one.teacher_id === two.teacher_id ||
            (one.room && one.room.toLowerCase() === two.room?.toLowerCase()))) {
          validation.addIssue({ code: 'custom', path: ['schedules'], message: 'Teacher, class, and classroom schedules cannot overlap.' });
          break;
        }
      }
    }
    for (const term of value.terms) {
      if (term.end_date < term.start_date || term.start_date < value.year.start_date || term.end_date > value.year.end_date) {
        validation.addIssue({ code: 'custom', path: ['terms'], message: `Term ${term.name} must fit inside the new academic year.` });
      }
    }
    for (const student of value.promotions) {
      const needsEnrollment = ['Promoted', 'Conditional Promotion', 'Retained/Repeat'].includes(student.promotion_status);
      if (needsEnrollment && !student.homeroom_class_source_id) {
        validation.addIssue({ code: 'custom', path: ['promotions'], message: `Choose a homeroom for each ${student.promotion_status.toLowerCase()} student.` });
      }
      if (!needsEnrollment && (student.homeroom_class_source_id || student.class_enrollments.length)) {
        validation.addIssue({ code: 'custom', path: ['promotions'], message: `${student.promotion_status} students cannot receive new enrollments.` });
      }
      if (new Set(student.class_enrollments).size !== student.class_enrollments.length) {
        validation.addIssue({ code: 'custom', path: ['promotions'], message: 'A student cannot be enrolled in the same class twice.' });
      }
    }
  });

  router.get(apiRoutes.academicYears.transitionOptions, admin, async (req, res) => {
    const filters = parse(transitionOptionsQuery, req.query);
    const sourceYearId = await resolvePublicId(pool, 'academic_years', filters.source_year_id, 404);
    const [[sourceYear]] = await pool.execute(
      'SELECT id, public_id, name, start_date, end_date FROM academic_years WHERE id = ?',
      [sourceYearId]
    );
    if (!sourceYear) return res.status(404).json({ error: 'Source academic year not found' });
    const [classesResult, gradeLevelsResult, termsResult, scalesResult, studentsResult, enrollmentsResult,
      subjectsResult, teachersResult, assignmentsResult, schedulesResult, conflictResult] = await Promise.all([
      pool.execute(`
        SELECT c.id, c.public_id, c.name, c.grade_level, c.capacity, c.homeroom_teacher_id,
          teacher.full_name AS homeroom_teacher
        FROM classes c LEFT JOIN teachers teacher ON teacher.id = c.homeroom_teacher_id
        WHERE c.academic_year_id = ? AND c.active = 1 AND c.is_deleted = 0
        ORDER BY c.grade_level, c.name
      `, [sourceYearId]),
      pool.execute(`
        SELECT name AS grade_level
        FROM grades
        WHERE active = 1 AND is_deleted = 0
        ORDER BY sort_order, name
      `),
      pool.execute('SELECT id, public_id, name, start_date, end_date FROM terms WHERE academic_year_id = ? ORDER BY start_date', [sourceYearId]),
      pool.execute(`
        SELECT id, public_id, label, minimum_percentage, maximum_percentage, description
        FROM grading_scales WHERE academic_year_id = ? ORDER BY minimum_percentage
      `, [sourceYearId]),
      pool.execute(`
        SELECT s.id, s.public_id, s.student_code, s.english_name, s.khmer_name,
          e.id AS enrollment_id, e.public_id AS enrollment_public_id,
          c.id AS class_id, c.public_id AS class_public_id, c.name AS class_name, c.grade_level
        FROM student_enrollments e JOIN students s ON s.id = e.student_id
        JOIN classes c ON c.id = e.class_id
        WHERE e.academic_year_id = ? AND e.enrollment_type = 'Homeroom' AND e.current = 1
          AND s.status = 'Active' AND s.is_deleted = 0
        ORDER BY c.grade_level, c.name, s.english_name
      `, [sourceYearId]),
      pool.execute(`
        SELECT enrollment.id, enrollment.public_id, enrollment.student_id, enrollment.class_id,
          enrollment.subject_id, enrollment.enrollment_date, student.public_id AS student_public_id,
          class_record.public_id AS class_public_id, subject.public_id AS subject_public_id,
          student.student_code, student.english_name, class_record.name AS class_name,
          class_record.grade_level, subject.name AS subject_name
        FROM student_enrollments enrollment
        JOIN students student ON student.id = enrollment.student_id
        JOIN classes class_record ON class_record.id = enrollment.class_id
        JOIN subjects subject ON subject.id = enrollment.subject_id
        WHERE enrollment.academic_year_id = ? AND enrollment.enrollment_type = 'Subject'
          AND enrollment.current = 1 AND student.is_deleted = 0
        ORDER BY student.english_name, class_record.grade_level, subject.name
      `, [sourceYearId]),
      pool.execute('SELECT id, public_id, code, name FROM subjects WHERE active = 1 AND is_deleted = 0 ORDER BY name'),
      pool.execute(`
        SELECT id, public_id, teacher_code, full_name FROM teachers
        WHERE employment_status = 'Active' AND is_deleted = 0 ORDER BY full_name
      `),
      pool.execute(`
        SELECT assignment.id, assignment.public_id, assignment.teacher_id, assignment.subject_id,
          assignment.class_id, teacher.public_id AS teacher_public_id, subject.public_id AS subject_public_id,
          class_record.public_id AS class_public_id, teacher.full_name AS teacher_name,
          subject.name AS subject_name, class_record.name AS class_name, class_record.grade_level
        FROM teacher_assignments assignment
        JOIN teachers teacher ON teacher.id = assignment.teacher_id
        JOIN subjects subject ON subject.id = assignment.subject_id
        JOIN classes class_record ON class_record.id = assignment.class_id
        WHERE assignment.academic_year_id = ? AND assignment.active = 1
          AND teacher.employment_status = 'Active' AND teacher.is_deleted = 0
        ORDER BY class_record.grade_level, class_record.name, subject.name, teacher.full_name
      `, [sourceYearId]),
      pool.execute(`
        SELECT schedule.id, schedule.public_id, schedule.class_id, schedule.subject_id,
          schedule.teacher_id, schedule.day_of_week, schedule.start_time, schedule.end_time, schedule.room,
          class_record.public_id AS class_public_id, subject.public_id AS subject_public_id,
          teacher.public_id AS teacher_public_id, class_record.name AS class_name,
          class_record.grade_level, subject.name AS subject_name, teacher.full_name AS teacher_name
        FROM class_schedules schedule
        JOIN classes class_record ON class_record.id = schedule.class_id
        JOIN subjects subject ON subject.id = schedule.subject_id
        JOIN teachers teacher ON teacher.id = schedule.teacher_id
        WHERE class_record.academic_year_id = ? AND schedule.active = 1 AND schedule.is_deleted = 0
          AND teacher.employment_status = 'Active' AND teacher.is_deleted = 0
        ORDER BY schedule.day_of_week, schedule.start_time
      `, [sourceYearId]),
      pool.execute(`
        SELECT first_schedule.id AS first_id, second_schedule.id AS second_id,
          first_class.name AS first_class, second_class.name AS second_class,
          first_teacher.full_name AS first_teacher, second_teacher.full_name AS second_teacher,
          first_schedule.room AS first_room, second_schedule.room AS second_room
        FROM class_schedules first_schedule
        JOIN class_schedules second_schedule ON second_schedule.id > first_schedule.id
          AND second_schedule.day_of_week = first_schedule.day_of_week
          AND second_schedule.start_time < first_schedule.end_time
          AND second_schedule.end_time > first_schedule.start_time
          AND (second_schedule.class_id = first_schedule.class_id
            OR second_schedule.teacher_id = first_schedule.teacher_id
            OR (first_schedule.room IS NOT NULL AND second_schedule.room = first_schedule.room))
        JOIN classes first_class ON first_class.id = first_schedule.class_id
        JOIN classes second_class ON second_class.id = second_schedule.class_id
        JOIN teachers first_teacher ON first_teacher.id = first_schedule.teacher_id
        JOIN teachers second_teacher ON second_teacher.id = second_schedule.teacher_id
        WHERE first_class.academic_year_id = ? AND second_class.academic_year_id = ?
          AND first_schedule.active = 1 AND second_schedule.active = 1
          AND first_schedule.is_deleted = 0 AND second_schedule.is_deleted = 0
        LIMIT 100
      `, [sourceYearId, sourceYearId])
    ]);
    const [classes] = classesResult;
    const [gradeLevels] = gradeLevelsResult;
    const [terms] = termsResult;
    const [gradingScales] = scalesResult;
    const [students] = studentsResult;
    const [enrollments] = enrollmentsResult;
    const [subjects] = subjectsResult;
    const [teachers] = teachersResult;
    const [teacherAssignments] = assignmentsResult;
    const [schedules] = schedulesResult;
    const [scheduleConflicts] = conflictResult;

    res.json({
      source_year: (await publicizeRows(pool, 'academic_years', [sourceYear]))[0],
      classes: await publicizeRows(pool, 'classes', classes, { homeroom_teacher_id: 'teachers' }),
      grade_levels: gradeLevels.map(row => row.grade_level),
      terms: await publicizeRows(pool, 'terms', terms),
      grading_scales: await publicizeRows(pool, 'grading_scales', gradingScales),
      students: await publicizeRows(pool, 'students', students, {
        enrollment_id: 'student_enrollments', class_id: 'classes'
      }),
      subject_enrollments: enrollments.map(row => ({
        ...row,
        student_id: row.student_public_id,
        class_id: row.class_public_id,
        subject_id: row.subject_public_id,
        enrollment_id: row.public_id
      })),
      subjects: await publicizeRows(pool, 'subjects', subjects),
      teachers: await publicizeRows(pool, 'teachers', teachers),
      teacher_assignments: teacherAssignments.map(row => ({
        ...row,
        id: row.public_id,
        teacher_id: row.teacher_public_id,
        subject_id: row.subject_public_id,
        class_id: row.class_public_id
      })),
      schedules: schedules.map(row => ({
        ...row,
        id: row.public_id,
        class_id: row.class_public_id,
        subject_id: row.subject_public_id,
        teacher_id: row.teacher_public_id
      })),
      schedule_conflicts: scheduleConflicts
    });
  });

  router.post(apiRoutes.academicYears.transition, admin, async (req, res) => {
    const data = parse(transitionInput, req.body);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      let sourceYearId = null;
      let sourceYear = null;
      if (data.source_year_id) {
        sourceYearId = await resolvePublicId(connection, 'academic_years', data.source_year_id, 400);
        [[sourceYear]] = await connection.execute(
          'SELECT id, start_date, end_date FROM academic_years WHERE id = ? FOR UPDATE',
          [sourceYearId]
        );
        if (!sourceYear) throw Object.assign(new Error('Source academic year not found'), { status: 400 });
      }

      const [newYearResult] = await connection.execute(`
        INSERT INTO academic_years (name, start_date, end_date, is_current, status)
        VALUES (?, ?, ?, 0, 'Upcoming')
      `, [data.year.name, data.year.start_date, data.year.end_date]);
      const newYearId = newYearResult.insertId;
      const [transitionResult] = await connection.execute(`
        INSERT INTO academic_year_transitions (source_year_id, target_year_id, created_by)
        VALUES (?, ?, ?)
      `, [sourceYearId, newYearId, req.session.user.internalId]);
      const transitionId = transitionResult.insertId;
      const classMap = new Map();
      const requestedTemplateClassIds = data.classes.map(row =>
        row.template_class_id === undefined
          ? (data.copy.classes ? row.source_class_id : null)
          : row.template_class_id
      ).filter(Boolean);
      let sourceClasses = [];
      if (data.copy.classes && sourceYearId) {
        [sourceClasses] = await connection.execute(`
          SELECT id, public_id FROM classes
          WHERE academic_year_id = ? AND active = 1 AND is_deleted = 0
        `, [sourceYearId]);
        const requestedTemplateIds = new Set(requestedTemplateClassIds);
        if (sourceClasses.length !== requestedTemplateIds.size ||
            sourceClasses.some(row => !requestedTemplateIds.has(row.public_id))) {
          throw Object.assign(new Error('Class template changed. Reload the wizard and review class selections.'), { status: 409 });
        }
      } else if (requestedTemplateClassIds.length) {
        throw Object.assign(new Error('Copied classes require an active template year.'), { status: 400 });
      }

      const classRowsByPublicId = new Map(sourceClasses.map(row => [row.public_id, row]));
      for (const classConfig of data.classes) {
        const templateClassId = classConfig.template_class_id === undefined
          ? (data.copy.classes ? classConfig.source_class_id : null)
          : classConfig.template_class_id;
        if (templateClassId && !classRowsByPublicId.has(templateClassId)) {
          throw Object.assign(new Error('A selected source class is no longer available'), { status: 409 });
        }
        if (!data.copy.classes && templateClassId) {
          throw Object.assign(new Error('Template classes were supplied while class copying is disabled.'), { status: 400 });
        }
        const [[grade]] = await connection.execute(
          'SELECT id FROM grades WHERE name = ? AND active = 1 AND is_deleted = 0',
          [classConfig.grade_level]
        );
        if (!grade) throw Object.assign(new Error(`Grade level "${classConfig.grade_level}" is no longer available.`), { status: 400 });
        const teacherId = classConfig.homeroom_teacher_id
          ? await resolvePublicId(connection, 'teachers', classConfig.homeroom_teacher_id, 400)
          : null;
        if (teacherId) {
          const [[teacher]] = await connection.execute(
            "SELECT id FROM teachers WHERE id = ? AND employment_status = 'Active' AND is_deleted = 0",
            [teacherId]
          );
          if (!teacher) throw Object.assign(new Error('Choose an active homeroom teacher'), { status: 400 });
        }
        const [classResult] = await connection.execute(`
          INSERT INTO classes (name, grade_level, academic_year_id, capacity, homeroom_teacher_id, active)
          VALUES (?, ?, ?, ?, ?, 1)
        `, [classConfig.name, classConfig.grade_level, newYearId, classConfig.capacity, teacherId]);
        classMap.set(classConfig.source_class_id, classResult.insertId);
      }

      if (data.copy.terms && sourceYearId) {
        const [sourceTerms] = await connection.execute(`
          SELECT id, public_id FROM terms WHERE academic_year_id = ?
        `, [sourceYearId]);
        if (sourceTerms.length !== data.terms.length ||
            sourceTerms.some(term => !data.terms.some(config => config.source_term_id === term.public_id))) {
          throw Object.assign(new Error('Term template changed. Reload the wizard and review term dates.'), { status: 409 });
        }
      } else if (data.terms.length && data.copy.terms) {
        throw Object.assign(new Error('Terms require a selected template year.'), { status: 400 });
      }
      for (const term of (data.copy.terms ? data.terms : [])) {
        await connection.execute(`
          INSERT INTO terms (academic_year_id, name, start_date, end_date) VALUES (?, ?, ?, ?)
        `, [newYearId, term.name, term.start_date, term.end_date]);
      }

      if (data.copy.grading_scales && sourceYearId) {
        await connection.execute(`
          INSERT INTO grading_scales (academic_year_id, label, minimum_percentage, maximum_percentage, description)
          SELECT ?, label, minimum_percentage, maximum_percentage, description
          FROM grading_scales WHERE academic_year_id = ?
        `, [newYearId, sourceYearId]);
      }

      if ((data.teacher_assignments.length && !data.copy.teacher_assignments) ||
          (data.schedules.length && !data.copy.class_schedules)) {
        throw Object.assign(new Error('Assignments and schedules require their corresponding setup option.'), { status: 400 });
      }
      const assignmentKeys = new Set();
      const assignmentSubjectsByClass = new Map();
      let copiedAssignments = 0;
      for (const assignment of data.teacher_assignments) {
        const classId = classMap.get(assignment.class_source_id);
        if (!classId) throw Object.assign(new Error('Teacher assignments must use classes configured for the new year.'), { status: 400 });
        const teacherId = await resolvePublicId(connection, 'teachers', assignment.teacher_id, 400);
        const subjectId = await resolvePublicId(connection, 'subjects', assignment.subject_id, 400);
        const [[validAssignment]] = await connection.execute(`
          SELECT 1 FROM teachers teacher CROSS JOIN subjects subject
          WHERE teacher.id = ? AND teacher.employment_status = 'Active' AND teacher.is_deleted = 0
            AND subject.id = ? AND subject.active = 1 AND subject.is_deleted = 0
        `, [teacherId, subjectId]);
        if (!validAssignment) throw Object.assign(new Error('Choose an active teacher and subject for each assignment.'), { status: 400 });
        await connection.execute(`
          INSERT INTO teacher_assignments (teacher_id, subject_id, class_id, academic_year_id, active)
          VALUES (?, ?, ?, ?, 0)
        `, [teacherId, subjectId, classId, newYearId]);
        assignmentKeys.add(`${assignment.class_source_id}:${assignment.subject_id}:${assignment.teacher_id}`);
        if (!assignmentSubjectsByClass.has(assignment.class_source_id)) {
          assignmentSubjectsByClass.set(assignment.class_source_id, new Set());
        }
        assignmentSubjectsByClass.get(assignment.class_source_id).add(subjectId);
        copiedAssignments += 1;
      }
      let copiedSchedules = 0;
      for (const schedule of data.schedules) {
        const classId = classMap.get(schedule.class_source_id);
        const teacherId = await resolvePublicId(connection, 'teachers', schedule.teacher_id, 400);
        const subjectId = await resolvePublicId(connection, 'subjects', schedule.subject_id, 400);
        if (!assignmentKeys.has(`${schedule.class_source_id}:${schedule.subject_id}:${schedule.teacher_id}`)) {
          throw Object.assign(new Error('Each schedule must match a draft teacher assignment.'), { status: 400 });
        }
        await connection.execute(`
          INSERT INTO class_schedules
            (class_id, subject_id, teacher_id, day_of_week, start_time, end_time, room, active)
          VALUES (?, ?, ?, ?, ?, ?, ?, 0)
        `, [classId, subjectId, teacherId, schedule.day_of_week,
          schedule.start_time, schedule.end_time, schedule.room || null]);
        copiedSchedules += 1;
      }

      const selectedStudentIds = [...new Set(data.promotions.map(row => row.student_id))];
      const studentIds = selectedStudentIds.length
        ? await Promise.all(selectedStudentIds.map(id => resolvePublicId(connection, 'students', id, 400)))
        : [];
      const sourceEnrollmentByStudent = new Map();
      if (sourceYearId && studentIds.length) {
        const [sourceEnrollments] = await connection.execute(`
          SELECT id, student_id, class_id FROM student_enrollments
          WHERE academic_year_id = ? AND enrollment_type = 'Homeroom' AND current = 1
            AND student_id IN (${studentIds.map(() => '?').join(', ')})
          FOR UPDATE
        `, [sourceYearId, ...studentIds]);
        for (const enrollment of sourceEnrollments) sourceEnrollmentByStudent.set(String(enrollment.student_id), enrollment);
        if (sourceEnrollments.length !== studentIds.length) {
          throw Object.assign(new Error('Every promoted student must have an active homeroom enrollment in the template year.'), { status: 400 });
        }
      } else if (data.promotions.length) {
        throw Object.assign(new Error('Choose a template year before promoting students.'), { status: 400 });
      }
      const [studentRows] = studentIds.length
        ? await connection.execute(`SELECT id, status FROM students WHERE id IN (${studentIds.map(() => '?').join(', ')}) FOR UPDATE`, studentIds)
        : [[]];
      if (studentRows.some(student => student.status !== 'Active')) {
        throw Object.assign(new Error('Only active students may receive new enrollments.'), { status: 400 });
      }
      const capacities = new Map();
      for (const item of data.promotions) {
        if (item.homeroom_class_source_id && !classMap.has(item.homeroom_class_source_id)) {
          throw Object.assign(new Error('A homeroom must use a class configured for the new year.'), { status: 400 });
        }
        for (const classSourceId of item.class_enrollments) {
          if (!classMap.has(classSourceId)) {
            throw Object.assign(new Error('Class enrollments must use classes configured for the new year.'), { status: 400 });
          }
          if (!assignmentSubjectsByClass.get(classSourceId)?.size) {
            throw Object.assign(new Error('Assign at least one subject and teacher to each selected class before enrolling students.'), { status: 400 });
          }
        }
      }

      const targetClassIds = [...new Set([...classMap.values()])];
      const [targetClasses] = targetClassIds.length
        ? await connection.execute(`SELECT id, capacity FROM classes WHERE id IN (${targetClassIds.map(() => '?').join(', ')})`, targetClassIds)
        : [[]];
      const studentSetByClass = new Map(targetClasses.map(row => [String(row.id), new Set()]));
      const newHomeroomIds = new Map();
      const targetYearDate = data.year.start_date;
      for (let index = 0; index < data.promotions.length; index += 1) {
        const promotion = data.promotions[index];
        const studentId = studentIds[index];
        const sourceEnrollment = sourceEnrollmentByStudent.get(String(studentId));
        let newEnrollmentId = null;
        if (promotion.homeroom_class_source_id) {
          const classId = classMap.get(promotion.homeroom_class_source_id);
          studentSetByClass.get(String(classId)).add(String(studentId));
          const [result] = await connection.execute(`
            INSERT INTO student_enrollments
              (student_id, class_id, academic_year_id, enrollment_date, current, enrollment_type, promotion_status)
              VALUES (?, ?, ?, ?, 1, 'Homeroom', ?)
            `, [studentId, classId, newYearId, targetYearDate, promotion.promotion_status]);
          newEnrollmentId = result.insertId;
          newHomeroomIds.set(String(studentId), newEnrollmentId);
        }
        const [transitionStudent] =         await connection.execute(`
          INSERT INTO academic_year_transition_students
            (transition_id, student_id, source_enrollment_id, new_enrollment_id, promotion_status)
          VALUES (?, ?, ?, ?, ?)
        `, [transitionId, studentId, sourceEnrollment?.id || null, newEnrollmentId, promotion.promotion_status]);

        const enrolledClassIds = new Set([
          ...promotion.class_enrollments,
          ...(promotion.homeroom_class_source_id ? [promotion.homeroom_class_source_id] : [])
        ]);
        for (const classSourceId of enrolledClassIds) {
          const classId = classMap.get(classSourceId);
          studentSetByClass.get(String(classId)).add(String(studentId));
          for (const subjectId of assignmentSubjectsByClass.get(classSourceId) || []) {
            await connection.execute(`
              INSERT INTO student_enrollments
                (student_id, class_id, subject_id, academic_year_id, enrollment_date, current, enrollment_type)
              VALUES (?, ?, ?, ?, ?, 1, 'Subject')
            `, [studentId, classId, subjectId, newYearId, targetYearDate]);
          }
        }
        if (!transitionStudent.insertId) throw new Error('Unable to record the student promotion decision');
      }

      for (const targetClass of targetClasses) {
        const classCount = studentSetByClass.get(String(targetClass.id))?.size || 0;
        if (classCount > targetClass.capacity) {
          throw Object.assign(new Error(`A copied class exceeds its capacity (${classCount}/${targetClass.capacity}).`), { status: 409 });
        }
      }

      if (data.subject_outcomes.length) {
        if (!sourceYearId) throw Object.assign(new Error('Subject outcomes require a selected template year.'), { status: 400 });
        for (const item of data.subject_outcomes) {
          const studentId = await resolvePublicId(connection, 'students', item.student_id, 400);
          const classId = await resolvePublicId(connection, 'classes', item.class_source_id, 400);
          const subjectId = await resolvePublicId(connection, 'subjects', item.subject_id, 400);
          const [[enrollment]] = await connection.execute(`
            SELECT enrollment.id FROM student_enrollments enrollment
            WHERE enrollment.student_id = ? AND enrollment.class_id = ? AND enrollment.subject_id = ?
              AND enrollment.academic_year_id = ? AND enrollment.enrollment_type = 'Subject'
          `, [studentId, classId, subjectId, sourceYearId]);
          if (!enrollment) throw Object.assign(new Error('Subject outcome does not match a historical subject enrollment.'), { status: 400 });
          await connection.execute(`
            INSERT INTO student_subject_outcomes (transition_id, student_enrollment_id, outcome, recorded_by)
            VALUES (?, ?, ?, ?)
          `, [transitionId, enrollment.id, item.outcome, req.session.user.internalId]);
        }
      }

      const [studentScheduleConflicts] = await connection.execute(`
        SELECT DISTINCT student.student_code, student.english_name
        FROM student_enrollments first_enrollment
        JOIN student_enrollments second_enrollment ON second_enrollment.student_id = first_enrollment.student_id
          AND second_enrollment.id > first_enrollment.id AND second_enrollment.academic_year_id = first_enrollment.academic_year_id
        JOIN class_schedules first_schedule ON first_schedule.class_id = first_enrollment.class_id
          AND first_schedule.subject_id = first_enrollment.subject_id AND first_schedule.active IN (0, 1)
          AND first_schedule.is_deleted = 0
        JOIN class_schedules second_schedule ON second_schedule.class_id = second_enrollment.class_id
          AND second_schedule.subject_id = second_enrollment.subject_id
          AND second_schedule.day_of_week = first_schedule.day_of_week
          AND second_schedule.start_time < first_schedule.end_time
          AND second_schedule.end_time > first_schedule.start_time
          AND second_schedule.active IN (0, 1) AND second_schedule.is_deleted = 0
        JOIN students student ON student.id = first_enrollment.student_id
        WHERE first_enrollment.academic_year_id = ? AND first_enrollment.enrollment_type = 'Subject'
          AND second_enrollment.enrollment_type = 'Subject'
        LIMIT 25
      `, [newYearId]);
      if (studentScheduleConflicts.length) {
        const names = studentScheduleConflicts.map(row => `${row.english_name} (${row.student_code})`).join(', ');
        throw Object.assign(new Error(`Student timetable conflicts must be resolved before completing the transition: ${names}.`), { status: 409 });
      }

      await connection.execute(`
        UPDATE academic_year_transitions SET details = ? WHERE id = ?
      `, [JSON.stringify({
        students: data.promotions.length,
        classes: classMap.size,
        terms: data.copy.terms ? data.terms.length : 0,
        teacher_assignments: copiedAssignments,
        schedules: copiedSchedules
      }), transitionId]);
      const [[newYear]] = await connection.execute('SELECT id, name FROM academic_years WHERE id = ?', [newYearId]);
      await logActivity(connection, req.session.user.internalId, 'completed_transition', 'academic_year', newYearId, {
        source_year_id: data.source_year_id || null,
        name: newYear.name,
        promotions: data.promotions.length,
        classes: classMap.size,
        teacher_assignments: copiedAssignments,
        schedules: copiedSchedules
      });
      if (data.activate_year) {
        await connection.execute(`
          UPDATE academic_years
          SET is_current = 0, status = 'Closed'
          WHERE is_current = 1 AND id <> ?
        `, [newYearId]);
        await connection.execute(`
          UPDATE academic_years SET is_current = 1, status = 'Current' WHERE id = ?
        `, [newYearId]);
      }
      const yearPublicId = await publicIdFor(connection, 'academic_years', newYearId);
      const transitionPublicId = await publicIdFor(connection, 'academic_year_transitions', transitionId);
      await connection.commit();
      res.status(201).json({
        success: true,
        id: yearPublicId,
        transition_id: transitionPublicId,
        status: data.activate_year ? 'Current' : 'Upcoming',
        counts: {
          students: data.promotions.length, classes: classMap.size,
          terms: data.copy.terms ? data.terms.length : 0,
          teacher_assignments: copiedAssignments, schedules: copiedSchedules
        }
      });
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY' || error.code === '23505') {
        return res.status(409).json({ error: 'This academic year or transition already exists. Refresh the year list and try again.' });
      }
      throw error;
    } finally {
      connection.release();
    }
  });
}
