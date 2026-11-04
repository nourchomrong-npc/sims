const tables = new Set([
  'users', 'academic_years', 'teachers', 'classes', 'students', 'terms',
  'student_enrollments', 'subjects', 'teacher_assignments', 'attendance_records',
  'class_schedules', 'assessments', 'student_scores', 'grading_scales', 'activity_logs'
]);
const softDeleteTables = new Set(['users', 'teachers', 'classes', 'students', 'subjects', 'class_schedules', 'assessments']);

function tableName(table) {
  if (!tables.has(table)) throw new Error(`Unsupported public ID table: ${table}`);
  return table;
}

export async function resolvePublicId(executor, table, publicId, missingStatus = 404, allowDeleted = false) {
  const name = tableName(table);
  const visibility = softDeleteTables.has(name) && !allowDeleted ? ' AND is_deleted = 0' : '';
  const [[row]] = await executor.execute(`SELECT id FROM ${name} WHERE public_id = ?${visibility}`, [publicId]);
  if (!row) throw Object.assign(new Error(`${name} record not found`), { status: missingStatus });
  return row.id;
}

export async function resolvePublicIds(executor, table, publicIds, missingStatus = 400, allowDeleted = false) {
  const name = tableName(table);
  const uniqueIds = [...new Set(publicIds)];
  if (!uniqueIds.length) return [];
  const placeholders = uniqueIds.map(() => '?').join(', ');
  const visibility = softDeleteTables.has(name) && !allowDeleted ? ' AND is_deleted = 0' : '';
  const [rows] = await executor.execute(
    `SELECT id, public_id FROM ${name} WHERE public_id IN (${placeholders})${visibility}`,
    uniqueIds
  );
  const internalIds = new Map(rows.map(row => [row.public_id, row.id]));
  if (uniqueIds.some(id => !internalIds.has(id))) {
    throw Object.assign(new Error(`${name} record not found`), { status: missingStatus });
  }
  return publicIds.map(id => internalIds.get(id));
}

export async function publicIdFor(executor, table, internalId) {
  const name = tableName(table);
  const [[row]] = await executor.execute(`SELECT public_id FROM ${name} WHERE id = ?`, [internalId]);
  if (!row) throw new Error(`Unable to find the public ID for ${name} record`);
  return row.public_id;
}

async function idMapFor(executor, table, ids) {
  const name = tableName(table);
  const uniqueIds = [...new Set(ids.filter(id => id !== null && id !== undefined).map(String))];
  if (!uniqueIds.length) return new Map();
  const placeholders = uniqueIds.map(() => '?').join(', ');
  const [rows] = await executor.execute(
    `SELECT id, public_id FROM ${name} WHERE id IN (${placeholders})`,
    uniqueIds
  );
  return new Map(rows.map(row => [String(row.id), row.public_id]));
}

export async function publicizeRows(executor, table, rows, foreignKeys = {}) {
  if (!rows.length) return rows;
  const [primaryIds, ...foreignIdMaps] = await Promise.all([
    idMapFor(executor, table, rows
      .filter(row => row.public_id === null || row.public_id === undefined)
      .map(row => row.id)),
    ...Object.entries(foreignKeys).map(([field, target]) =>
      idMapFor(executor, target, rows.map(row => row[field])))
  ]);
  const foreignMappings = Object.keys(foreignKeys);

  return rows.map(row => {
    const { id, public_id: storedPublicId, ...rest } = row;
    const publicId = storedPublicId || primaryIds.get(String(id));
    if (!publicId) throw new Error(`Unable to serialize a ${table} record without a public ID`);
    const result = { ...rest, id: publicId };
    foreignMappings.forEach((field, index) => {
      if (result[field] === null || result[field] === undefined) return;
      const publicForeignId = foreignIdMaps[index].get(String(result[field]));
      if (!publicForeignId) throw new Error(`Unable to serialize ${table}.${field} as a public ID`);
      result[field] = publicForeignId;
    });
    return result;
  });
}

export async function publicizeEntityIds(executor, rows) {
  const entityTables = {
    user: 'users',
    academic_year: 'academic_years',
    student: 'students',
    teacher: 'teachers',
    class: 'classes',
    term: 'terms',
    student_enrollment: 'student_enrollments',
    subject: 'subjects',
    teacher_assignment: 'teacher_assignments',
    class_schedule: 'class_schedules',
    attendance_record: 'attendance_records',
    assessment: 'assessments',
    student_score: 'student_scores',
    grading_scale: 'grading_scales',
  };
  const detailIdTables = {
    user_id: 'users',
    created_by: 'users',
    entered_by: 'users',
    recorded_by: 'users',
    deleted_by: 'users',
    academic_year_id: 'academic_years',
    teacher_id: 'teachers',
    class_id: 'classes',
    student_id: 'students',
    term_id: 'terms',
    enrollment_id: 'student_enrollments',
    subject_id: 'subjects',
    teacher_assignment_id: 'teacher_assignments',
    class_schedule_id: 'class_schedules',
    schedule_id: 'class_schedules',
    attendance_record_id: 'attendance_records',
    assessment_id: 'assessments',
    student_score_id: 'student_scores',
    grading_scale_id: 'grading_scales'
  };
  const result = await publicizeRows(executor, 'activity_logs', rows, { user_id: 'users' });
  const byTable = new Map();
  const detailReferences = [];
  const identityReferences = [];
  const detailsRows = [];
  for (const row of result) {
    const identities = [row.actor, row.affected_user];
    const target = entityTables[row.entity];
    if (target && row.entity_id !== null) {
      if (!byTable.has(target)) byTable.set(target, []);
      byTable.get(target).push(row.entity_id);
    }
    if (row.details !== null && row.details !== undefined) {
      const wasString = typeof row.details === 'string';
      const details = wasString ? JSON.parse(row.details) : row.details;
      detailsRows.push({ row, details, wasString });
      identities.push(details?.actor, details?.affected_user);
      const visit = value => {
        if (Array.isArray(value)) {
          value.forEach(visit);
        } else if (value && typeof value === 'object') {
          const changedFieldTable = typeof value.field === 'string' ? detailIdTables[value.field] : null;
          if (changedFieldTable) {
            for (const field of ['before', 'after']) {
              const id = value[field];
              if (id === null || id === undefined || !/^\d+$/.test(String(id))) continue;
              if (!byTable.has(changedFieldTable)) byTable.set(changedFieldTable, []);
              byTable.get(changedFieldTable).push(id);
              detailReferences.push({ value, field, id, table: changedFieldTable });
            }
          }
          for (const [field, id] of Object.entries(value)) {
            const detailTarget = detailIdTables[field];
            if (!detailTarget || id === null || id === undefined || !/^\d+$/.test(String(id))) {
              visit(id);
              continue;
            }
            if (!byTable.has(detailTarget)) byTable.set(detailTarget, []);
            byTable.get(detailTarget).push(id);
            detailReferences.push({ value, field, id, table: detailTarget });
          }
        }
      };
      visit(details);
    }
    for (const identity of identities) {
      if (!identity || typeof identity !== 'object' || Array.isArray(identity)) continue;
      if (identity.id !== null && identity.id !== undefined && /^\d+$/.test(String(identity.id))) {
        if (!identity.public_id) {
          if (!byTable.has('users')) byTable.set('users', []);
          byTable.get('users').push(identity.id);
          identityReferences.push({ identity, id: identity.id });
        }
      } else if (!identity.public_id && typeof identity.id === 'string' && /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(identity.id)) {
        identity.public_id = identity.id;
      }
      delete identity.id;
    }
  }
  const mappings = new Map(await Promise.all([...byTable].map(async ([target, ids]) =>
    [target, await idMapFor(executor, target, ids)]
  )));
  for (const row of result) {
    if (row.entity_id === null) continue;
    const target = entityTables[row.entity];
    if (!target) throw new Error(`Unable to serialize activity ID for unsupported entity: ${row.entity}`);
    const publicId = mappings.get(target).get(String(row.entity_id));
    if (publicId) {
      row.entity_id = publicId;
    } else {
      row.entity_id = null;
      row.entity_id_unavailable = true;
    }
  }
  for (const { value, field, id, table } of detailReferences) {
    const publicId = mappings.get(table).get(String(id));
    value[field] = publicId || 'Record no longer exists';
  }
  for (const { identity, id } of identityReferences) {
    identity.public_id = mappings.get('users').get(String(id)) || null;
  }
  for (const { row, details, wasString } of detailsRows) {
    row.details = wasString ? JSON.stringify(details) : details;
  }
  return result;
}
