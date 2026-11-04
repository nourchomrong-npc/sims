import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

process.env.STORAGE_DRIVER = 'supabase';
process.env.SUPABASE_URL = 'https://storage-test.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-secret-key';
process.env.SUPABASE_STORAGE_BUCKET = 'student-photos';

const objects = new Map();
let failStorageDelete = false;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  const segments = url.pathname.split('/').filter(Boolean);
  const bucketIndex = segments.indexOf('object') + 1;
  const bucket = segments[bucketIndex];
  const filename = segments[bucketIndex + 1];
  if (bucket !== process.env.SUPABASE_STORAGE_BUCKET) {
    return new Response(JSON.stringify({ message: 'Unexpected bucket' }), { status: 404 });
  }
  if (options.method === 'POST' && filename) {
    objects.set(filename, Buffer.from(await new Response(options.body).arrayBuffer()));
    return new Response(JSON.stringify({ Key: `${bucket}/${filename}` }), { status: 200 });
  }
  if (options.method === 'GET' && filename) {
    const image = objects.get(filename);
    return image
      ? new Response(image, { status: 200, headers: { 'Content-Type': 'image/jpeg' } })
      : new Response(JSON.stringify({ statusCode: '404', message: 'Object not found' }), { status: 404 });
  }
  if (options.method === 'DELETE') {
    if (failStorageDelete) return new Response(JSON.stringify({ message: 'Storage unavailable' }), { status: 500 });
    const body = JSON.parse(options.body);
    for (const key of body.prefixes) objects.delete(key);
    return new Response(JSON.stringify(body.prefixes.map(name => ({ name }))), { status: 200 });
  }
  return new Response(JSON.stringify({ message: 'Unexpected storage request' }), { status: 400 });
};

const { deleteStudentPhoto, deleteStudentPhotoIfUnreferenced, readStudentPhoto, recordStudentPhoto, saveStudentPhoto, studentPhotoContentType, studentPhotoPublicId } =
  await import('../src/utils/studentPhotos.js');

test('student photos upload, download, and delete through Supabase Storage', async () => {
  const image = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]);
  const saved = await saveStudentPhoto(image.toString('base64'));
  try {
    assert.match(saved.url, /^\/student-photos\/[0-9a-f-]+\.jpg$/);
    assert.equal(studentPhotoPublicId(saved.url), saved.filename.slice(0, -4));
    assert.equal(studentPhotoContentType(saved.filename), 'image/jpeg');
    assert.deepEqual(await readStudentPhoto(saved.filename), image);
  } finally {
    await deleteStudentPhoto(saved.url);
  }
  await assert.rejects(readStudentPhoto(saved.filename), { code: 'ENOENT' });
});

test('student photos accept and serve WebP while preserving JPEG compatibility', async () => {
  const image = Buffer.from('RIFF\x04\x00\x00\x00WEBP');
  const saved = await saveStudentPhoto(image.toString('base64'));
  try {
    assert.match(saved.url, /^\/student-photos\/[0-9a-f-]+\.webp$/);
    assert.equal(studentPhotoContentType(saved.filename), 'image/webp');
    assert.deepEqual(await readStudentPhoto(saved.filename), image);
  } finally {
    await deleteStudentPhoto(saved.url);
  }
});

test('student photo public IDs are read only from valid JPEG or WebP photo URLs', () => {
  assert.equal(studentPhotoPublicId('/student-photos/7b077b2a-f166-4a63-8ec8-cbd073a17b27.jpg'), '7b077b2a-f166-4a63-8ec8-cbd073a17b27');
  assert.equal(studentPhotoPublicId('/student-photos/7b077b2a-f166-4a63-8ec8-cbd073a17b27.webp'), '7b077b2a-f166-4a63-8ec8-cbd073a17b27');
  assert.equal(studentPhotoPublicId('/student-photos/not-a-uuid.jpg'), null);
});

test('student photo storage rejects malformed image data', async () => {
  await assert.rejects(saveStudentPhoto(Buffer.from('not an image').toString('base64')), { status: 400 });
  await assert.rejects(saveStudentPhoto(Buffer.from('RIFF1234NOPE').toString('base64')), { status: 400 });
});

test('photo cleanup retains shared and historically audited images', async () => {
  const saved = await saveStudentPhoto(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]).toString('base64'));
  let metadataDeleted = false;
  const db = {
    async execute(sql, values) {
      if (sql.includes('FROM students')) return [[{ id: 2 }]];
      if (sql.includes('FROM activity_logs')) return [[]];
      if (sql.startsWith('DELETE FROM student_photos')) {
        metadataDeleted = true;
        assert.equal(values[0], saved.url);
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`unexpected query: ${sql}`);
    }
  };
  assert.equal(await deleteStudentPhotoIfUnreferenced(db, saved.url), false);
  assert.equal(objects.has(saved.filename), true);

  db.execute = async sql => {
    if (sql.includes('FROM students')) return [[]];
    if (sql.includes('FROM activity_logs')) return [[{ id: 8 }]];
    if (sql.startsWith('DELETE FROM student_photos')) throw new Error('metadata should remain for activity history');
    throw new Error(`unexpected query: ${sql}`);
  };
  assert.equal(await deleteStudentPhotoIfUnreferenced(db, saved.url), false);
  assert.equal(objects.has(saved.filename), true);

  db.execute = async sql => {
    if (sql.includes('FROM students') || sql.includes('FROM activity_logs')) return [[]];
    if (sql.startsWith('DELETE FROM student_photos')) {
      metadataDeleted = true;
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`unexpected query: ${sql}`);
  };
  assert.equal(await deleteStudentPhotoIfUnreferenced(db, saved.url), true);
  assert.equal(objects.has(saved.filename), false);
  assert.equal(metadataDeleted, true);
});

test('student photo metadata records titles, owner public UUID, and stored path', async () => {
  let query;
  const db = {
    async execute(sql, values) {
      query = { sql, values };
      return [{ affectedRows: 1 }, []];
    }
  };
  await recordStudentPhoto(db, 'student-public-uuid', '/student-photos/7b077b2a-f166-4a63-8ec8-cbd073a17b27.webp', 'Student portrait');
  assert.match(query.sql, /INSERT INTO student_photos \(title, url, owner_id\) VALUES \(\?, \?, \?\)/);
  assert.match(query.sql, /ON CONFLICT \(url\) DO UPDATE SET title = EXCLUDED\.title/);
  assert.deepEqual(query.values, [
    'Student portrait',
    '/student-photos/7b077b2a-f166-4a63-8ec8-cbd073a17b27.webp',
    'student-public-uuid'
  ]);
});

test('photo cleanup reports storage failures and does not silently succeed', async () => {
  const saved = await saveStudentPhoto(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]).toString('base64'));
  failStorageDelete = true;
  try {
    await assert.rejects(deleteStudentPhotoIfUnreferenced({ async execute() { return [[]]; } }, saved.url));
    assert.equal(objects.has(saved.filename), true);
  } finally {
    failStorageDelete = false;
    await deleteStudentPhoto(saved.url);
  }
});
