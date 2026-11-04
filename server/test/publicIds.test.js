import test from 'node:test';
import assert from 'node:assert/strict';
import { publicizeEntityIds, publicizeRows, resolvePublicId, resolvePublicIds } from '../src/utils/publicIds.js';

const studentId = '5f1d4f19-78b1-4d9c-9e4c-f1127bd19c01';
const classId = '9cf13f34-56ba-43e3-81cf-92171e256a21';
const scheduleId = 'b8a1b37a-d7e4-4db4-b5d3-cf5f479a8292';

function createExecutor(records) {
  return {
    async execute(sql, values) {
      const table = sql.match(/FROM (\w+)/)?.[1];
      assert.ok(records[table], `unexpected table ${table}`);
      const rows = records[table];
      if (sql.includes('WHERE public_id = ?')) {
        const row = rows.find(item => item.public_id === values[0]);
        return [[row ? { id: row.id } : undefined].filter(Boolean)];
      }
      if (sql.includes('WHERE public_id IN (')) {
        return [rows.filter(item => values.includes(item.public_id)).map(({ id, public_id }) => ({ id, public_id }))];
      }
      if (sql.includes('WHERE id IN (')) {
        return [rows.filter(item => values.includes(String(item.id))).map(({ id, public_id }) => ({ id, public_id }))];
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };
}

const executor = createExecutor({
  students: [{ id: 14, public_id: studentId, class_id: 3 }],
  classes: [{ id: 3, public_id: classId }],
  teachers: [{ id: 44, public_id: '1ea30575-cc4a-4efc-8e43-ffbe6aa56a57' }],
  teacher_assignments: [{ id: 22, public_id: 'aa63d176-334f-40f4-ad34-b2cd288dd357' }],
  class_schedules: [{ id: 32, public_id: scheduleId }],
  users: [{ id: 2, public_id: 'e67ca398-7f4d-4ce1-9a2e-7103b12f9d67' }],
  activity_logs: [{ id: 8, public_id: '9b3dc75a-0413-4b66-96d3-68286e52fdc9' }]
});

test('resolves public IDs without exposing internal database IDs', async () => {
  assert.equal(await resolvePublicId(executor, 'students', studentId), 14);
  assert.deepEqual(await resolvePublicIds(executor, 'students', []), []);
  assert.deepEqual(
    await resolvePublicIds(executor, 'students', [studentId, studentId]),
    [14, 14]
  );
  await assert.rejects(resolvePublicId(executor, 'students', classId), { status: 404 });
  await assert.rejects(resolvePublicIds(executor, 'students', [classId]), { status: 400 });
});

test('serializes primary and foreign keys as public UUIDs', async () => {
  const rows = await publicizeRows(executor, 'students', [
    { id: 14, student_code: 'S-14', class_id: 3 },
    { id: 15, student_code: 'S-15', class_id: null, public_id: studentId }
  ], { class_id: 'classes' });
  assert.deepEqual(rows, [
    { student_code: 'S-14', class_id: classId, id: studentId },
    { student_code: 'S-15', class_id: null, id: studentId }
  ]);
});

test('skips the primary ID lookup when rows already include public UUIDs', async () => {
  const queries = [];
  const trackingExecutor = {
    async execute(sql, values) {
      queries.push(sql);
      return executor.execute(sql, values);
    }
  };
  const [row] = await publicizeRows(trackingExecutor, 'students', [{
    id: 14,
    public_id: studentId,
    student_code: 'S-14'
  }]);

  assert.deepEqual(row, { student_code: 'S-14', id: studentId });
  assert.deepEqual(queries, []);
});

test('serializes activity log entity references and rejects unsupported entities', async () => {
  const rows = await publicizeEntityIds(executor, [{
    id: 8,
    public_id: '9b3dc75a-0413-4b66-96d3-68286e52fdc9',
    entity: 'student',
    entity_id: 14,
    details: null
  }]);
  assert.equal(rows[0].id, '9b3dc75a-0413-4b66-96d3-68286e52fdc9');
  assert.equal(rows[0].entity_id, studentId);
  await assert.rejects(publicizeEntityIds(executor, [{
    id: 8,
    entity: 'unknown',
    entity_id: 14
  }]), /unsupported entity/);
});

test('serializes legacy numeric IDs inside activity details', async () => {
  const rows = await publicizeEntityIds(executor, [{
    id: 8,
    public_id: '9b3dc75a-0413-4b66-96d3-68286e52fdc9',
    entity: 'teacher_assignment',
    entity_id: 22,
    details: JSON.stringify({ teacher_id: 44, nested: [{ class_id: 3 }] })
  }]);
  assert.equal(rows[0].entity_id, 'aa63d176-334f-40f4-ad34-b2cd288dd357');
  assert.deepEqual(JSON.parse(rows[0].details), {
    teacher_id: '1ea30575-cc4a-4efc-8e43-ffbe6aa56a57',
    nested: [{ class_id: classId }]
  });
});

test('activity responses expose public account IDs and omit internal identity IDs', async () => {
  const [row] = await publicizeEntityIds(executor, [{
    id: 8,
    public_id: '9b3dc75a-0413-4b66-96d3-68286e52fdc9',
    entity: 'user',
    entity_id: null,
    actor: { id: '2', display_name: 'Actor', username: 'actor', roles: ['Administrator'] },
    details: {
      actor: { id: '2', display_name: 'Actor', username: 'actor', roles: ['Administrator'] },
      affected_user: { id: '2', display_name: 'Account', username: 'account', roles: ['Teacher'] },
      changes: [{ field: 'user_id', before: '2', after: '2' }]
    }
  }]);

  assert.equal(row.actor.public_id, 'e67ca398-7f4d-4ce1-9a2e-7103b12f9d67');
  assert.equal('id' in row.actor, false);
  assert.equal(row.details.actor.public_id, 'e67ca398-7f4d-4ce1-9a2e-7103b12f9d67');
  assert.equal('id' in row.details.actor, false);
  assert.equal(row.details.affected_user.public_id, 'e67ca398-7f4d-4ce1-9a2e-7103b12f9d67');
  assert.equal('id' in row.details.affected_user, false);
  assert.deepEqual(row.details.changes, [{
    field: 'user_id',
    before: 'e67ca398-7f4d-4ce1-9a2e-7103b12f9d67',
    after: 'e67ca398-7f4d-4ce1-9a2e-7103b12f9d67'
  }]);
});

test('does not expose numeric IDs for deleted activity entities', async () => {
  const rows = await publicizeEntityIds(executor, [{
    id: 8,
    public_id: '9b3dc75a-0413-4b66-96d3-68286e52fdc9',
    entity: 'user',
    entity_id: 999,
    details: { user_id: 999 }
  }]);
  assert.equal(rows[0].entity_id, null);
  assert.equal(rows[0].entity_id_unavailable, true);
  assert.deepEqual(rows[0].details, { user_id: 'Record no longer exists' });
});

test('resolves and serializes class schedule public IDs', async () => {
  assert.equal(await resolvePublicId(executor, 'class_schedules', scheduleId), 32);
  const [row] = await publicizeRows(executor, 'class_schedules', [{ id: 32, day_of_week: 1 }]);
  assert.deepEqual(row, { day_of_week: 1, id: scheduleId });
  const [activity] = await publicizeEntityIds(executor, [{
    id: 8,
    public_id: '9b3dc75a-0413-4b66-96d3-68286e52fdc9',
    entity: 'class_schedule',
    entity_id: 32,
    details: null
  }]);
  assert.equal(activity.entity_id, scheduleId);
});
