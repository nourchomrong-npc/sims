import { apiRoutes } from './apiRoutes.js';
import { transactionalMutation } from '../utils/transactions.js';

export function registerSchoolSetupRoutes(router, context) {
  const { z, pool, activityRecordSnapshot, logActivity, publicIdFor, publicizeRows, resolvePublicId, academicYearInput, displayNameSchema, idParam, parse, publicId, admin, manager, academic, linkedTeacherId } = context;

  router.get(apiRoutes.meta, academic, async (req, res) => {
    const teacherId = await linkedTeacherId(req);
    const [[currentYearRows], [academicYearRows]] = await Promise.all([
      pool.execute('SELECT id, name, start_date, end_date, is_current, status FROM academic_years WHERE id = ? LIMIT 1', [req.academicYearId || 0]),
      pool.execute('SELECT id, name, start_date, end_date, is_current, status FROM academic_years ORDER BY start_date DESC')
    ]);
    const year = currentYearRows[0];
    const canSwitchAcademicYear = ['Admin', 'SuperAdmin'].includes(req.session.user.role);
    const [termsResult, dashboardTermsResult, classesResult, gradeLevelsResult, classSubjectsResult,
      teacherAssignmentsResult, teachersResult, subjectsResult, studentsResult] = await Promise.all([
      pool.execute('SELECT id, name, academic_year_id, start_date, end_date FROM terms WHERE academic_year_id = ? ORDER BY start_date', [year?.id || 0]),
      pool.execute('SELECT id, name, academic_year_id, start_date, end_date FROM terms WHERE academic_year_id = ? ORDER BY start_date DESC',
        [year?.id || 0]),
      pool.execute(`
      SELECT c.id, c.name, c.grade_level, c.capacity, c.academic_year_id, ay.name AS academic_year,
        c.homeroom_teacher_id, teacher.full_name AS homeroom_teacher,
        (SELECT COUNT(DISTINCT e.student_id) FROM student_enrollments e JOIN students s ON s.id = e.student_id
         WHERE e.class_id = c.id AND e.academic_year_id = c.academic_year_id AND e.current = 1
           AND s.status = 'Active' AND s.is_deleted = 0) AS student_count
      FROM classes c JOIN academic_years ay ON ay.id = c.academic_year_id
      LEFT JOIN teachers teacher ON teacher.id = c.homeroom_teacher_id AND teacher.is_deleted = 0
      WHERE c.active = 1 AND c.is_deleted = 0 AND c.academic_year_id = ?
        AND (? IS NULL OR EXISTS (SELECT 1 FROM teacher_assignments ta
          WHERE ta.teacher_id = ? AND ta.class_id = c.id AND ta.active = 1
            AND ta.academic_year_id = c.academic_year_id))
      ORDER BY c.grade_level, c.name
    `, [year?.id || 0, teacherId, teacherId]),
      pool.execute(`
    SELECT id, public_id, name, sort_order
    FROM grades
    WHERE active = 1 AND is_deleted = 0
    ORDER BY sort_order, name
    `),
    pool.execute(`
      SELECT DISTINCT c.public_id AS class_id, s.public_id AS subject_id FROM teacher_assignments ta
      JOIN classes c ON c.id = ta.class_id AND c.active = 1 AND c.is_deleted = 0
      JOIN subjects s ON s.id = ta.subject_id AND s.active = 1 AND s.is_deleted = 0
      JOIN teachers teacher ON teacher.id = ta.teacher_id
        AND teacher.employment_status = 'Active' AND teacher.is_deleted = 0
      WHERE ta.active = 1 AND ta.academic_year_id = ? AND (? IS NULL OR ta.teacher_id = ?)
      ORDER BY class_id, subject_id
    `, [year?.id || 0, teacherId, teacherId]),
      pool.execute(`
      SELECT ta.id, ta.teacher_id, ta.subject_id, ta.class_id, ta.academic_year_id,
        teacher.full_name AS teacher_name, subject.name AS subject_name, schedule_class.name AS class_name
      FROM teacher_assignments ta
      JOIN teachers teacher ON teacher.id = ta.teacher_id AND teacher.employment_status = 'Active' AND teacher.is_deleted = 0
      JOIN subjects subject ON subject.id = ta.subject_id AND subject.active = 1 AND subject.is_deleted = 0
      JOIN classes schedule_class ON schedule_class.id = ta.class_id AND schedule_class.active = 1 AND schedule_class.is_deleted = 0
      WHERE ta.active = 1 AND ta.academic_year_id = ? AND (? IS NULL OR ta.teacher_id = ?)
      ORDER BY schedule_class.grade_level, schedule_class.name, subject.name, teacher.full_name
    `, [year?.id || 0, teacherId, teacherId]),
      pool.execute(`
      SELECT teacher.id, teacher.teacher_code, teacher.full_name, teacher.email, teacher.phone, teacher.employment_status,
        (SELECT STRING_AGG(DISTINCT CONCAT(c.grade_level, ' ', c.name, ' · ', subject.name), ', '
          ORDER BY CONCAT(c.grade_level, ' ', c.name, ' · ', subject.name))
         FROM teacher_assignments ta
         JOIN classes c ON c.id = ta.class_id AND c.active = 1 AND c.is_deleted = 0
         JOIN subjects subject ON subject.id = ta.subject_id AND subject.active = 1 AND subject.is_deleted = 0
         WHERE ta.teacher_id = teacher.id AND ta.active = 1 AND ta.academic_year_id = ?) AS assignments
      FROM teachers teacher
      WHERE teacher.employment_status = 'Active' AND teacher.is_deleted = 0
        AND (? IS NULL OR teacher.id = ?) ORDER BY teacher.full_name
    `, [year?.id || 0, teacherId, teacherId]),
      pool.execute(`
      SELECT subject.id, subject.code, subject.name, subject.description, subject.active
      FROM subjects subject WHERE subject.active = 1 AND subject.is_deleted = 0
        AND (? IS NULL OR EXISTS (SELECT 1 FROM teacher_assignments ta
          WHERE ta.teacher_id = ? AND ta.subject_id = subject.id AND ta.active = 1))
      ORDER BY subject.name
    `, [teacherId, teacherId]),
      pool.execute(`
      SELECT s.id, s.student_code, s.english_name, e.class_id FROM students s
      JOIN student_enrollments e ON e.student_id = s.id AND e.current = 1
        AND e.academic_year_id = ? AND e.enrollment_type = 'Homeroom'
      WHERE s.status = 'Active' AND s.is_deleted = 0
        AND (? IS NULL OR EXISTS (SELECT 1 FROM teacher_assignments ta
          WHERE ta.teacher_id = ? AND ta.class_id = e.class_id AND ta.active = 1))
      ORDER BY s.english_name
    `, [year?.id || 0, teacherId, teacherId])
    ]);
    const terms = termsResult[0];
    const dashboardTerms = dashboardTermsResult[0];
    const classes = classesResult[0];
    const gradeLevels = gradeLevelsResult[0];
    const classSubjects = classSubjectsResult[0];
    const teacherAssignments = teacherAssignmentsResult[0];
    const teachers = teachersResult[0];
    const subjects = subjectsResult[0];
    const students = studentsResult[0];
    const [
      [publicYear], publicAcademicYears, publicTerms, publicDashboardTerms,
      publicClasses, publicGradeLevels, publicTeacherAssignments, publicTeachers, publicSubjects, publicStudents
    ] = await Promise.all([
      publicizeRows(pool, 'academic_years', year ? [year] : []),
      publicizeRows(pool, 'academic_years', academicYearRows),
      publicizeRows(pool, 'terms', terms, { academic_year_id: 'academic_years' }),
      publicizeRows(pool, 'terms', dashboardTerms, { academic_year_id: 'academic_years' }),
      publicizeRows(pool, 'classes', classes, {
        academic_year_id: 'academic_years',
        homeroom_teacher_id: 'teachers'
      }),
      publicizeRows(pool, 'grades', gradeLevels),
      publicizeRows(pool, 'teacher_assignments', teacherAssignments, {
        teacher_id: 'teachers',
        class_id: 'classes',
        subject_id: 'subjects',
        academic_year_id: 'academic_years'
      }),
      publicizeRows(pool, 'teachers', teachers),
      publicizeRows(pool, 'subjects', subjects),
      publicizeRows(pool, 'students', students, { class_id: 'classes' })
    ]);
    res.json({
      academicYear: publicYear || null,
      academicYears: canSwitchAcademicYear ? publicAcademicYears : (publicYear ? [publicYear] : []),
      terms: publicTerms,
      dashboardTerms: publicDashboardTerms,
      classes: publicClasses,
      gradeLevels: publicGradeLevels,
      classSubjects,
      teacherAssignments: publicTeacherAssignments,
      teachers: publicTeachers,
      subjects: publicSubjects,
      students: publicStudents
    });
  });
  router.get(apiRoutes.terms.collection, academic, async (req, res) => {
    const [rows] = await pool.execute(`
      SELECT t.*, ay.name AS academic_year
      FROM terms t JOIN academic_years ay ON ay.id = t.academic_year_id
      WHERE t.academic_year_id = ?
      ORDER BY t.start_date DESC
    `, [req.academicYearId || 0]);
    res.json(await publicizeRows(pool, 'terms', rows, { academic_year_id: 'academic_years' }));
  });
  router.post(apiRoutes.academicYears.collection, admin, async (req, res) => {
    const data = parse(academicYearInput, req.body);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      if (data.is_current) await connection.execute("UPDATE academic_years SET is_current = 0, status = 'Closed' WHERE is_current = 1");
      const [result] = await connection.execute(
        'INSERT INTO academic_years (name, start_date, end_date, is_current, status) VALUES (?, ?, ?, ?, ?)',
        [data.name, data.start_date, data.end_date, data.is_current,
          data.is_current ? 'Current' : data.status || (data.end_date < new Date().toISOString().slice(0, 10) ? 'Closed' : 'Upcoming')]
      );
      await logActivity(connection, req.session.user.internalId, 'created', 'academic_year', result.insertId, {
        name: data.name, start_date: data.start_date, end_date: data.end_date, is_current: data.is_current
      });
      const id = await publicIdFor(connection, 'academic_years', result.insertId);
      await connection.commit();
      res.status(201).json({ id });
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Academic year name already exists' });
      throw error;
    } finally {
      connection.release();
    }
  });
  router.patch(apiRoutes.academicYears.item, admin, async (req, res) => {
    const { id: publicYearId } = parse(idParam, req.params);
    const id = await resolvePublicId(pool, 'academic_years', publicYearId, 404);
    const data = parse(academicYearInput, req.body);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[year]] = await connection.execute('SELECT id, is_current FROM academic_years WHERE id = ? FOR UPDATE', [id]);
      if (!year) {
        await connection.rollback();
        return res.status(404).json({ error: 'Academic year not found' });
      }
      const recordBefore = await activityRecordSnapshot(connection, 'academic_year', id);
      if (year.is_current && !data.is_current) {
        const [[currentYear]] = await connection.execute(
          'SELECT id FROM academic_years WHERE is_current = 1 AND id <> ? LIMIT 1',
          [id]
        );
        if (!currentYear) {
          await connection.rollback();
          return res.status(409).json({ error: 'Set another academic year as current before unsetting this one.' });
        }
      }
      if (data.is_current) await connection.execute("UPDATE academic_years SET is_current = 0, status = 'Closed' WHERE is_current = 1 AND id <> ?", [id]);
      await connection.execute(
        'UPDATE academic_years SET name = ?, start_date = ?, end_date = ?, is_current = ?, status = ? WHERE id = ?',
        [data.name, data.start_date, data.end_date, data.is_current,
          data.is_current ? 'Current' : data.status || (data.end_date < new Date().toISOString().slice(0, 10) ? 'Closed' : 'Upcoming'), id]
      );
      await logActivity(connection, req.session.user.internalId, 'updated', 'academic_year', id, {
        name: data.name, start_date: data.start_date, end_date: data.end_date, is_current: data.is_current,
        record_before: recordBefore
      });
      await connection.commit();
      res.json({ success: true });
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Academic year name already exists' });
      throw error;
    } finally {
      connection.release();
    }
  });
  router.delete(apiRoutes.academicYears.item, admin, async (req, res) => {
    const { id: publicYearId } = parse(idParam, req.params);
    const id = await resolvePublicId(pool, 'academic_years', publicYearId, 404);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[year]] = await connection.execute('SELECT name, is_current FROM academic_years WHERE id = ? FOR UPDATE', [id]);
      if (!year) {
        await connection.rollback();
        return res.status(404).json({ error: 'Academic year not found' });
      }
      if (year.is_current) {
        await connection.rollback();
        return res.status(409).json({ error: 'The current academic year cannot be deleted. Set another year as current first.' });
      }
      const recordBefore = await activityRecordSnapshot(connection, 'academic_year', id);
      await connection.execute('DELETE FROM academic_years WHERE id = ?', [id]);
      await logActivity(connection, req.session.user.internalId, 'deleted', 'academic_year', id, { name: year.name, record_before: recordBefore });
      await connection.commit();
      res.json({ success: true });
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_ROW_IS_REFERENCED_2') {
        return res.status(409).json({ error: 'This academic year is used by classes, terms, enrollments, assignments, or grading scales and cannot be deleted.' });
      }
      throw error;
    } finally {
      connection.release();
    }
  });
  router.post(apiRoutes.terms.collection, manager, transactionalMutation(pool, async (req, res) => {
    const termInput = z.object({
      academic_year_id: publicId,
      name: displayNameSchema(80),
      start_date: z.string().date(),
      end_date: z.string().date()
    }).refine(value => value.end_date >= value.start_date, {
      path: ['end_date'], message: 'Term end date must be on or after the start date'
    });
    const data = parse(termInput, req.body);
    const publicAcademicYearId = data.academic_year_id;
    data.academic_year_id = await resolvePublicId(pool, 'academic_years', data.academic_year_id, 400);
    if (String(data.academic_year_id) !== String(req.academicYearId || 0)) {
      return res.status(400).json({ error: 'Select the academic year shown in the header' });
    }
    const [[year]] = await pool.execute('SELECT id FROM academic_years WHERE id = ?', [data.academic_year_id]);
    if (!year) return res.status(400).json({ error: 'Academic year not found' });
    try {
      const [result] = await pool.execute(`
        INSERT INTO terms (academic_year_id, name, start_date, end_date) VALUES (?, ?, ?, ?)
      `, [data.academic_year_id, data.name, data.start_date, data.end_date]);
      await logActivity(pool, req.session.user.internalId, 'created', 'term', result.insertId, {
        academic_year_id: publicAcademicYearId, name: data.name, start_date: data.start_date, end_date: data.end_date
      });
      res.status(201).json({ id: await publicIdFor(pool, 'terms', result.insertId) });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Term name already exists for this academic year' });
      throw error;
    }
  }));
  router.patch(apiRoutes.terms.item, manager, async (req, res) => {
    const { id: publicTermId } = parse(idParam, req.params);
    const id = await resolvePublicId(pool, 'terms', publicTermId, 404);
    const data = parse(z.object({
      academic_year_id: publicId,
      name: displayNameSchema(80),
      start_date: z.string().date(),
      end_date: z.string().date()
    }).refine(value => value.end_date >= value.start_date, {
      path: ['end_date'], message: 'Term end date must be on or after the start date'
    }), req.body);
    const publicAcademicYearId = data.academic_year_id;
    data.academic_year_id = await resolvePublicId(pool, 'academic_years', data.academic_year_id, 400);
    if (String(data.academic_year_id) !== String(req.academicYearId || 0)) {
      return res.status(400).json({ error: 'Select the academic year shown in the header' });
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[term]] = await connection.execute('SELECT id, academic_year_id FROM terms WHERE id = ? FOR UPDATE', [id]);
      if (term && String(term.academic_year_id) !== String(req.academicYearId || 0)) {
        await connection.rollback();
        return res.status(404).json({ error: 'Academic term not found in the selected academic year' });
      }
      if (!term) {
        await connection.rollback();
        return res.status(404).json({ error: 'Academic term not found' });
      }
      const recordBefore = await activityRecordSnapshot(connection, 'term', id);
      await connection.execute(`
        UPDATE terms SET academic_year_id = ?, name = ?, start_date = ?, end_date = ? WHERE id = ?
      `, [data.academic_year_id, data.name, data.start_date, data.end_date, id]);
      await logActivity(connection, req.session.user.internalId, 'updated', 'term', id, {
        academic_year_id: publicAcademicYearId, name: data.name, start_date: data.start_date, end_date: data.end_date,
        record_before: recordBefore
      });
      await connection.commit();
      res.json({ success: true });
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Term name already exists for this academic year' });
      throw error;
    } finally {
      connection.release();
    }
  });
  router.delete(apiRoutes.terms.item, manager, transactionalMutation(pool, async (req, res) => {
    const { id: publicTermId } = parse(idParam, req.params);
    const id = await resolvePublicId(pool, 'terms', publicTermId, 404);
    const [[term]] = await pool.execute(
      'SELECT name FROM terms WHERE id = ? AND academic_year_id = ?',
      [id, req.academicYearId || 0]
    );
    if (!term) return res.status(404).json({ error: 'Academic term not found' });
    const recordBefore = await activityRecordSnapshot(pool, 'term', id);
    try {
      await pool.execute('DELETE FROM terms WHERE id = ?', [id]);
      await logActivity(pool, req.session.user.internalId, 'deleted', 'term', id, { name: term.name, record_before: recordBefore });
      res.json({ success: true });
    } catch (error) {
      if (error.code === 'ER_ROW_IS_REFERENCED_2') {
        return res.status(409).json({ error: 'This academic term is used by assessments and cannot be deleted.' });
      }
      throw error;
    }
  }));
  router.get(apiRoutes.gradingScales.collection, academic, async (req, res) => {
    const [rows] = await pool.execute(`
      SELECT gs.*, ay.name AS academic_year FROM grading_scales gs
      JOIN academic_years ay ON ay.id = gs.academic_year_id
      WHERE gs.academic_year_id = ?
      ORDER BY ay.start_date DESC, gs.minimum_percentage DESC
    `, [req.academicYearId || 0]);
    res.json(await publicizeRows(pool, 'grading_scales', rows, { academic_year_id: 'academic_years' }));
  });
  router.post(apiRoutes.gradingScales.collection, manager, async (req, res) => {
    const gradingScaleInput = z.object({
      academic_year_id: publicId,
      label: z.string().trim().min(1).max(20),
      minimum_percentage: z.coerce.number().min(0).max(100),
      maximum_percentage: z.coerce.number().min(0).max(100),
      description: z.string().trim().max(100).optional().nullable()
    }).refine(value => value.maximum_percentage >= value.minimum_percentage, {
      path: ['maximum_percentage'], message: 'Maximum must be at least the minimum'
    });
    const data = parse(gradingScaleInput, req.body);
    const publicAcademicYearId = data.academic_year_id;
    data.academic_year_id = await resolvePublicId(pool, 'academic_years', data.academic_year_id, 400);
    if (String(data.academic_year_id) !== String(req.academicYearId || 0)) {
      return res.status(400).json({ error: 'Select the academic year shown in the header' });
    }
    const [[year]] = await pool.execute('SELECT id FROM academic_years WHERE id = ?', [data.academic_year_id]);
    if (!year) return res.status(400).json({ error: 'Academic year not found' });
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [overlaps] = await connection.execute(`
        SELECT id FROM grading_scales
        WHERE academic_year_id = ? AND minimum_percentage <= ? AND maximum_percentage >= ?
        LIMIT 1 FOR UPDATE
      `, [data.academic_year_id, data.maximum_percentage, data.minimum_percentage]);
      if (overlaps.length) throw Object.assign(new Error('This percentage range overlaps an existing grading scale'), { status: 409 });
      const [result] = await connection.execute(`
        INSERT INTO grading_scales (academic_year_id, label, minimum_percentage, maximum_percentage, description)
        VALUES (?, ?, ?, ?, ?)
      `, [data.academic_year_id, data.label, data.minimum_percentage, data.maximum_percentage, data.description || null]);
      await logActivity(connection, req.session.user.internalId, 'created', 'grading_scale', result.insertId, {
        academic_year_id: publicAcademicYearId, label: data.label, minimum_percentage: data.minimum_percentage,
        maximum_percentage: data.maximum_percentage, description: data.description
      });
      const id = await publicIdFor(connection, 'grading_scales', result.insertId);
      await connection.commit();
      res.status(201).json({ id });
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That grading label already exists for this academic year' });
      throw error;
    } finally {
      connection.release();
    }
  });
  router.patch(apiRoutes.gradingScales.item, manager, async (req, res) => {
    const { id: publicScaleId } = parse(idParam, req.params);
    const id = await resolvePublicId(pool, 'grading_scales', publicScaleId, 404);
    const data = parse(z.object({
      academic_year_id: publicId,
      label: z.string().trim().min(1).max(20),
      minimum_percentage: z.coerce.number().min(0).max(100),
      maximum_percentage: z.coerce.number().min(0).max(100),
      description: z.string().trim().max(100).optional().nullable()
    }).refine(value => value.maximum_percentage >= value.minimum_percentage, {
      path: ['maximum_percentage'], message: 'Maximum must be at least the minimum'
    }), req.body);
    const publicAcademicYearId = data.academic_year_id;
    data.academic_year_id = await resolvePublicId(pool, 'academic_years', data.academic_year_id, 400);
    if (String(data.academic_year_id) !== String(req.academicYearId || 0)) {
      return res.status(400).json({ error: 'Select the academic year shown in the header' });
    }
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const [[scale]] = await connection.execute(
        'SELECT id, academic_year_id FROM grading_scales WHERE id = ? FOR UPDATE',
        [id]
      );
      if (scale && String(scale.academic_year_id) !== String(req.academicYearId || 0)) {
        await connection.rollback();
        return res.status(404).json({ error: 'Grading scale not found in the selected academic year' });
      }
      if (!scale) {
        await connection.rollback();
        return res.status(404).json({ error: 'Grading scale not found' });
      }
      const recordBefore = await activityRecordSnapshot(connection, 'grading_scale', id);
      const [overlaps] = await connection.execute(`
        SELECT id FROM grading_scales
        WHERE academic_year_id = ? AND id <> ? AND minimum_percentage <= ? AND maximum_percentage >= ?
        LIMIT 1 FOR UPDATE
      `, [data.academic_year_id, id, data.maximum_percentage, data.minimum_percentage]);
      if (overlaps.length) throw Object.assign(new Error('This percentage range overlaps an existing grading scale'), { status: 409 });
      await connection.execute(`
        UPDATE grading_scales
        SET academic_year_id = ?, label = ?, minimum_percentage = ?, maximum_percentage = ?, description = ?
        WHERE id = ? AND academic_year_id = ?
      `, [data.academic_year_id, data.label, data.minimum_percentage, data.maximum_percentage,
        data.description || null, id, req.academicYearId || 0]);
      await logActivity(connection, req.session.user.internalId, 'updated', 'grading_scale', id, {
        academic_year_id: publicAcademicYearId, label: data.label, minimum_percentage: data.minimum_percentage,
        maximum_percentage: data.maximum_percentage, description: data.description,
        record_before: recordBefore
      });
      await connection.commit();
      res.json({ success: true });
    } catch (error) {
      await connection.rollback();
      if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'That grading label already exists for this academic year' });
      throw error;
    } finally {
      connection.release();
    }
  });
  router.delete(apiRoutes.gradingScales.item, manager, transactionalMutation(pool, async (req, res) => {
    const { id: publicScaleId } = parse(idParam, req.params);
    const id = await resolvePublicId(pool, 'grading_scales', publicScaleId, 404);
    const [[scale]] = await pool.execute(
      'SELECT label FROM grading_scales WHERE id = ? AND academic_year_id = ?',
      [id, req.academicYearId || 0]
    );
    if (!scale) return res.status(404).json({ error: 'Grading scale not found' });
    const recordBefore = await activityRecordSnapshot(pool, 'grading_scale', id);
    await pool.execute('DELETE FROM grading_scales WHERE id = ?', [id]);
    await logActivity(pool, req.session.user.internalId, 'deleted', 'grading_scale', id, { label: scale.label, record_before: recordBefore });
    res.json({ success: true });
  }));
}
