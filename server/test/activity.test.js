import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { activityRecordChanges, activityRequestContext, hydrateActivityRecordTimestamps, logActivity, sanitizeActivityDetails, superAdminActivityAudit } from '../src/utils/activity.js';

test('SuperAdmin changes receive one audit event when the route has no explicit audit', async t => {
  const events = [];
  const db = {
    async execute(sql, params) {
      if (sql.includes('SELECT id, public_id, username, full_name, role FROM users')) {
        return [[{
          id: 7, public_id: 'a7c8b1ce-f383-44ab-b5dd-7f28c21d4190',
          username: 'admin', full_name: 'System Administrator', role: 'SuperAdmin'
        }], []];
      }
      if (sql.includes('SELECT created_at, updated_at FROM users WHERE id = ?')) {
        return [[{ created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-02T11:00:00.000Z' }], []];
      }
      assert.match(sql, /INSERT INTO activity_logs/);
      events.push({ action: params[1], entity: params[2], details: JSON.parse(params[4]) });
      return [{ affectedRows: 1 }, []];
    }
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.session = { user: { role: 'SuperAdmin', internalId: 7 } };
    next();
  });
  app.use(activityRequestContext);
  app.use(superAdminActivityAudit(db));
  app.post('/change', (req, res) => res.json({ success: true }));
  app.post('/already-audited', async (req, res, next) => {
    try {
      await logActivity(db, 7, 'login', 'user', 7);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  });
  app.patch('/unchanged', (req, res) => res.json({ success: true, unchanged: true }));
  app.get('/read-only', (req, res) => res.json({ success: true }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    res.status(500).json({ error: error.message });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  const response = await fetch(`${baseUrl}/change`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ class_name: 'Grade 7', password: 'never-log-this' })
  });
  assert.equal(response.status, 200);
  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'superadmin_action');
  assert.equal(events[0].entity, 'system');
  assert.equal(events[0].details.summary, 'SuperAdmin request: POST /change');
  assert.deepEqual(events[0].details.fields, ['class_name']);
  assert.doesNotMatch(JSON.stringify(events[0]), /never-log-this|password/);
  assert.equal(events[0].details.request.activityLogged, undefined);

  const auditedResponse = await fetch(`${baseUrl}/already-audited`, { method: 'POST' });
  assert.equal(auditedResponse.status, 200, await auditedResponse.text());
  assert.equal(events.length, 2, 'existing route audits must not be duplicated');
  assert.equal(events[1].action, 'login');

  await fetch(`${baseUrl}/unchanged`, { method: 'PATCH' });
  await fetch(`${baseUrl}/read-only`);
  assert.equal(events.length, 2, 'unchanged and read-only requests should not create audit events');
});

test('activity events include sanitized request and client details', async () => {
  const headers = {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',
    referer: 'https://school.example/students?secret=not-logged',
    'accept-language': 'en-US,en;q=0.9'
  };
  const req = {
    method: 'PATCH',
    originalUrl: '/api/students/abc123?search=not-logged',
    ip: '192.0.2.10',
    headers,
    get: name => headers[name.toLowerCase()]
  };
  const identity = {
    id: 7,
    public_id: 'a7c8b1ce-f383-44ab-b5dd-7f28c21d4190',
    username: 'ABC',
    full_name: 'ABC User',
    role: 'Administrator'
  };
  let inserted;
  const db = {
    async execute(sql, params) {
      if (sql.includes('SELECT id, public_id, username, full_name, role FROM users')) {
        return [[identity], []];
      }
      if (sql.includes('SELECT * FROM students WHERE id = ?')) {
        return [[{
          id: 42, public_id: 'student-public-id', student_code: 'STU-00042',
          english_name: 'Student Example', phone: '012345678',
          created_at: '2026-10-01T10:00:00.000Z',
          updated_at: '2026-10-02T11:00:00.000Z',
          photo_url: '/student-photos/7b077b2a-f166-4a63-8ec8-cbd073a17b27.webp'
        }], []];
      }
      if (sql.includes('FROM student_enrollments e JOIN classes c')) return [[], []];
      if (sql.includes('FROM student_photos')) return [[{ title: 'School portrait' }], []];
      assert.match(sql, /INSERT INTO activity_logs/);
      inserted = params;
      return [{ affectedRows: 1 }, []];
    }
  };

  await new Promise((resolve, reject) => {
    activityRequestContext(req, null, () => {
      logActivity(db, 7, 'created', 'student', 42, { fields: ['phone'] }).then(resolve, reject);
    });
  });

  const details = JSON.parse(inserted[4]);
  identity.username = 'CBA';
  identity.full_name = 'Changed User';
  identity.role = 'Teacher';
  assert.deepEqual(details.fields, ['phone']);
  assert.deepEqual(details.record_after, {
    public_id: 'student-public-id',
    student_code: 'STU-00042',
    english_name: 'Student Example',
    phone: '012345678',
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-02T11:00:00.000Z',
    photo_url: '/student-photos/7b077b2a-f166-4a63-8ec8-cbd073a17b27.webp',
    photo_title: 'School portrait',
    class_id: null,
    class_name: null,
    class_grade_level: null
  });
  assert.deepEqual(details.actor, {
    id: '7',
    public_id: 'a7c8b1ce-f383-44ab-b5dd-7f28c21d4190',
    display_name: 'ABC User',
    username: 'ABC',
    roles: ['Administrator']
  });
  assert.deepEqual(details.request, {
    requestId: null,
    method: 'PATCH',
    url: '/api/students/abc123',
    ip: '192.0.2.10',
    device: 'Desktop',
    os: 'Windows 10/11',
    browser: 'Edge 130',
    userAgent: headers['user-agent'],
    referrer: 'https://school.example/students',
    language: 'en-US,en;q=0.9'
  });
  assert.doesNotMatch(JSON.stringify(details), /not-logged/);
});

test('activity details strip secret fields and secret changes before persistence', () => {
  assert.deepEqual(sanitizeActivityDetails({
    fields: ['username', 'password_hash'],
    password_hash: 'do-not-keep',
    changes: [
      { field: 'username', before: 'ABC', after: 'CBA' },
      { field: 'password', before: 'old-secret', after: 'new-secret' }
    ],
    request: { token: 'do-not-keep', method: 'PATCH' }
  }), {
    fields: ['username', 'password_hash'],
    changes: [{ field: 'username', before: 'ABC', after: 'CBA' }],
    request: { method: 'PATCH' }
  });
});

test('activity record snapshots show only actual non-secret field changes', () => {
  const changes = activityRecordChanges({
    public_id: 'student-public-id',
    english_name: 'Old Name',
    phone: '0123',
    password_hash: 'not-for-audit'
  }, {
    public_id: 'student-public-id',
    english_name: 'New Name',
    phone: '0123',
    password_hash: 'updated-secret'
  });
  assert.deepEqual(sanitizeActivityDetails({ changes }), {
    changes: [{ field: 'english_name', label: 'English Name', before: 'Old Name', after: 'New Name' }]
  });
});

test('photo title-only changes retain the photo preview and historical titles', () => {
  assert.deepEqual(activityRecordChanges({
    photo_url: '/student-photos/7b077b2a-f166-4a63-8ec8-cbd073a17b27.webp',
    photo_title: 'Old title'
  }, {
    photo_url: '/student-photos/7b077b2a-f166-4a63-8ec8-cbd073a17b27.webp',
    photo_title: 'New title'
  }), [{
    field: 'photo_url',
    label: 'Photo',
    before: '/student-photos/7b077b2a-f166-4a63-8ec8-cbd073a17b27.webp',
    after: '/student-photos/7b077b2a-f166-4a63-8ec8-cbd073a17b27.webp',
    before_title: 'Old title',
    after_title: 'New title'
  }]);
});

test('record updates persist full before/after values and a sanitized field diff', async () => {
  let inserted;
  const db = {
    async execute(sql, params) {
      if (sql.includes('SELECT * FROM students WHERE id = ?')) {
        return [[{
          id: 42, public_id: 'student-public-id', student_code: 'STU-00042',
          english_name: 'New Name', phone: '012345678', password_hash: 'secret',
          created_at: '2026-10-01T10:00:00.000Z', updated_at: '2026-10-03T12:00:00.000Z',
          photo_url: '/student-photos/9c6eb9bc-9069-4bf1-a8ea-5c0b9a2cbb01.webp'
        }], []];
      }
      if (sql.includes('FROM student_enrollments e JOIN classes c')) return [[], []];
      if (sql.includes('FROM student_photos')) return [[{ title: 'New portrait' }], []];
      assert.match(sql, /INSERT INTO activity_logs/);
      inserted = params;
      return [{ affectedRows: 1 }, []];
    }
  };
  await logActivity(db, null, 'updated', 'student', 42, {
    record_before: {
      public_id: 'student-public-id',
      student_code: 'STU-00042',
      english_name: 'Old Name',
      phone: '012345678',
      created_at: '2026-10-01T10:00:00.000Z',
      updated_at: '2026-10-02T11:00:00.000Z',
      photo_url: '/student-photos/7b077b2a-f166-4a63-8ec8-cbd073a17b27.jpg',
      photo_title: 'Old portrait',
      password_hash: 'old-secret'
    }
  });

  const details = JSON.parse(inserted[4]);
  assert.equal(details.record_before.english_name, 'Old Name');
  assert.equal(details.record_after.english_name, 'New Name');
  assert.equal(details.record_before.photo_url, '/student-photos/7b077b2a-f166-4a63-8ec8-cbd073a17b27.jpg');
  assert.equal(details.record_after.photo_url, '/student-photos/9c6eb9bc-9069-4bf1-a8ea-5c0b9a2cbb01.webp');
  assert.equal(details.record_before.photo_title, 'Old portrait');
  assert.equal(details.record_after.photo_title, 'New portrait');
  assert.deepEqual(details.record_timestamps, {
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-03T12:00:00.000Z'
  });
  assert.deepEqual(details.changes, [
    { field: 'english_name', label: 'English Name', before: 'Old Name', after: 'New Name' },
    { field: 'updated_at', label: 'Updated At', before: '2026-10-02T11:00:00.000Z', after: '2026-10-03T12:00:00.000Z' },
    {
      field: 'photo_url',
      label: 'Photo',
      before: '/student-photos/7b077b2a-f166-4a63-8ec8-cbd073a17b27.jpg',
      after: '/student-photos/9c6eb9bc-9069-4bf1-a8ea-5c0b9a2cbb01.webp',
      before_title: 'Old portrait',
      after_title: 'New portrait'
    }
  ]);
  assert.doesNotMatch(JSON.stringify(details), /secret/);
});

test('activity events retain record timestamps when full snapshots are skipped', async () => {
  let inserted;
  const db = {
    async execute(sql, params) {
      if (sql.includes('SELECT created_at, updated_at FROM attendance_records WHERE id = ?')) {
        assert.deepEqual(params, [12]);
        return [[{
          created_at: '2026-10-01T10:00:00.000Z',
          updated_at: '2026-10-03T12:00:00.000Z'
        }], []];
      }
      assert.match(sql, /INSERT INTO activity_logs/);
      inserted = params;
      return [{ affectedRows: 1 }, []];
    }
  };

  await logActivity(db, null, 'updated', 'attendance_record', 12, {
    changes: [{ field: 'status', label: 'Attendance Status', before: 'Absent', after: 'Present' }]
  }, { skipRecordSnapshot: true });

  const details = JSON.parse(inserted[4]);
  assert.deepEqual(details.record_timestamps, {
    created_at: '2026-10-01T10:00:00.000Z',
    updated_at: '2026-10-03T12:00:00.000Z'
  });
  assert.deepEqual(details.changes, [
    { field: 'status', label: 'Attendance Status', before: 'Absent', after: 'Present' }
  ]);
});

test('activity feed hydration adds current timestamps to legacy records with empty snapshots', async () => {
  const rows = [
    { action: 'updated', entity: 'student', entity_id: 42, details: { record_after: { created_at: null, updated_at: null } } },
    {
      action: 'recorded_attendance',
      entity: 'class',
      entity_id: 4,
      details: {
        date: '2026-10-27',
        class_schedule_id: 8,
        affected_students: [{ name: 'Student Example', student_code: 'S-12', status: 'Present' }]
      }
    }
  ];
  const db = {
    async execute(sql, params) {
      if (sql.includes('FROM attendance_records attendance')) {
        assert.deepEqual(params, [4, 8, '2026-10-27', 'S-12']);
        return [[{
          student_code: 'S-12',
          created_at: '2026-10-27T14:51:11.048Z',
          updated_at: '2026-10-29T09:00:00.000Z'
        }], []];
      }
      assert.match(sql, /SELECT id, created_at, updated_at FROM students WHERE id IN \(\?\)/);
      assert.deepEqual(params, ['42']);
      return [[{
        id: 42,
        created_at: '2026-10-27T14:51:11.048Z',
        updated_at: '2026-10-29T09:00:00.000Z'
      }], []];
    }
  };

  await hydrateActivityRecordTimestamps(db, rows);

  assert.deepEqual(rows[0].details.record_timestamps, {
    created_at: '2026-10-27T14:51:11.048Z',
    updated_at: '2026-10-29T09:00:00.000Z'
  });
  assert.equal(rows[0].details.record_timestamps_source, 'current_record');
  assert.equal(rows[1].details.record_timestamps_source, 'current_record');
  assert.deepEqual(rows[1].details.affected_students[0], {
    name: 'Student Example',
    student_code: 'S-12',
    status: 'Present',
    created_at: '2026-10-27T14:51:11.048Z',
    updated_at: '2026-10-29T09:00:00.000Z',
    timestamps_source: 'current_record'
  });
});
