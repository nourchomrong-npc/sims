import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Buffer } from 'node:buffer';

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'sims-photo-storage-'));
process.env.STORAGE_DRIVER = 'local';
process.env.STUDENT_PHOTO_STORAGE_DIR = temporaryDirectory;
process.env.SUPABASE_URL = 'https://storage-test.supabase.co';
process.env.SUPABASE_SECRET_KEY = 'test-secret-key';
process.env.SUPABASE_STORAGE_BUCKET = 'student-photos';

const objects = new Map();
let failNextUpload = false;
let failNextDownload = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  const segments = url.pathname.split('/').filter(Boolean);
  const bucketIndex = segments.indexOf('object') + 1;
  const bucket = segments[bucketIndex];
  const filename = segments[bucketIndex + 1];
  if (bucket !== process.env.SUPABASE_STORAGE_BUCKET) {
    return new Response(JSON.stringify({ message: 'Unexpected storage bucket' }), { status: 404 });
  }
  if (options.method === 'POST' && filename) {
    if (failNextUpload) {
      failNextUpload = false;
      return new Response(JSON.stringify({ message: 'Storage temporarily unavailable' }), { status: 503 });
    }
    objects.set(filename, Buffer.from(await new Response(options.body).arrayBuffer()));
    return new Response(JSON.stringify({ Key: `${bucket}/${filename}` }), { status: 200 });
  }
  if (options.method === 'GET' && filename) {
    if (failNextDownload) {
      failNextDownload = false;
      return new Response(JSON.stringify({ message: 'Storage temporarily unavailable' }), { status: 503 });
    }
    const image = objects.get(filename);
    return image
      ? new Response(image, { status: 200, headers: { 'Content-Type': 'image/jpeg' } })
      : new Response(JSON.stringify({ statusCode: '404', message: 'Object not found' }), { status: 404 });
  }
  if (options.method === 'DELETE') {
    const body = JSON.parse(options.body);
    for (const key of body.prefixes) objects.delete(key);
    return new Response(JSON.stringify(body.prefixes.map(name => ({ name }))), { status: 200 });
  }
  return new Response(JSON.stringify({ message: 'Unexpected storage request' }), { status: 400 });
};

const photos = await import('../src/utils/studentPhotos.js');

test('local student photo storage queues cloud uploads, retries failures, caches cloud photos, and syncs deletes', async t => {
  t.after(async () => {
    globalThis.fetch = originalFetch;
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  const image = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]);
  const saved = await photos.saveStudentPhoto(image.toString('base64'));
  assert.deepEqual(await photos.readStudentPhoto(saved.filename), image);
  const cloudFilename = '8d7e7c1d-8955-4db4-b1c6-bbf7fdbd84b4.jpg';
  objects.set(cloudFilename, image);
  assert.deepEqual(await photos.syncPendingStudentPhotos({
    direction: 'cloud_to_local',
    photoUrls: [`/student-photos/${cloudFilename}`]
  }), {
    processed: 1,
    synced: 1,
    failed: 0,
    uploaded: 0,
    downloaded: 1
  });
  assert.deepEqual(await photos.readStudentPhoto(cloudFilename), image);
  failNextUpload = true;
  assert.deepEqual(await photos.syncPendingStudentPhotos({
    direction: 'local_to_cloud',
    photoUrls: ['/student-photos/8d7e7c1d-8955-4db4-b1c6-bbf7fdbd84b5.jpg']
  }), {
    processed: 1,
    synced: 0,
    failed: 1,
    uploaded: 0,
    downloaded: 0
  });
  await assert.rejects(photos.readStudentPhoto('8d7e7c1d-8955-4db4-b1c6-bbf7fdbd84b5.jpg'), { code: 'ENOENT' });
  assert.deepEqual(await photos.getStudentPhotoSyncStatus(), {
    enabled: true,
    pending: 0,
    failed: 1,
    pendingUploads: 0,
    pendingDownloads: 0,
    failedUploads: 1,
    failedDownloads: 0,
    running: false
  });
  assert.equal(objects.has(saved.filename), false);

  assert.equal(await photos.retryFailedStudentPhotoSync(), 1);
  assert.deepEqual(await photos.syncPendingStudentPhotos(), {
    processed: 1,
    synced: 1,
    failed: 0,
    uploaded: 1,
    downloaded: 0
  });
  assert.deepEqual(objects.get(saved.filename), image);
  assert.deepEqual(await photos.getStudentPhotoSyncStatus(), {
    enabled: true,
    pending: 0,
    failed: 0,
    pendingUploads: 0,
    pendingDownloads: 0,
    failedUploads: 0,
    failedDownloads: 0,
    running: false
  });

  const syncDownFilename = '8d7e7c1d-8955-4db4-b1c6-bbf7fdbd84b5.jpg';
  objects.set(syncDownFilename, image);
  failNextDownload = true;
  assert.deepEqual(await photos.syncPendingStudentPhotos({
    photoUrls: [`/student-photos/${syncDownFilename}`]
  }), {
    processed: 1,
    synced: 0,
    failed: 1,
    uploaded: 0,
    downloaded: 0
  });
  assert.equal((await photos.getStudentPhotoSyncStatus()).failedDownloads, 1);
  assert.equal(await photos.retryFailedStudentPhotoSync(), 1);
  assert.deepEqual(await photos.syncPendingStudentPhotos(), {
    processed: 1,
    synced: 1,
    failed: 0,
    uploaded: 0,
    downloaded: 1
  });
  assert.deepEqual(await photos.readStudentPhoto(syncDownFilename), image);

  await photos.deleteStudentPhoto(saved.url);
  assert.equal(await photos.readStudentPhoto(saved.filename).then(() => true, error => error.code === 'ENOENT'), true);
  assert.equal(objects.has(saved.filename), true);
  assert.deepEqual(await photos.syncPendingStudentPhotos(), {
    processed: 1, synced: 1, failed: 0, uploaded: 0, downloaded: 0
  });
  assert.equal(objects.has(saved.filename), false);

  const unsynced = await photos.saveStudentPhoto(image.toString('base64'));
  await photos.deleteStudentPhoto(unsynced.url);
  assert.deepEqual(await photos.syncPendingStudentPhotos(), {
    processed: 1, synced: 1, failed: 0, uploaded: 0, downloaded: 0
  });
  assert.equal(objects.has(unsynced.filename), false);
  assert.deepEqual(await photos.getStudentPhotoSyncStatus(), {
    enabled: true,
    pending: 0,
    failed: 0,
    pendingUploads: 0,
    pendingDownloads: 0,
    failedUploads: 0,
    failedDownloads: 0,
    running: false
  });
});
