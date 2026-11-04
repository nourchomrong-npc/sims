import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const maxPhotoBytes = 1024 * 1024;
const photoPublicIdPattern = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const filenamePattern = new RegExp(`^${photoPublicIdPattern}\\.(?:jpg|webp)$`, 'i');
const photoUrlPattern = new RegExp(`^/student-photos/(${photoPublicIdPattern})\\.(?:jpg|webp)$`, 'i');
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;
const bucketName = process.env.SUPABASE_STORAGE_BUCKET || 'student-photos';
const configuredStorageDriver = process.env.STORAGE_DRIVER || 'supabase';
const defaultStorageDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../storage/student-photos');
const storageDirectory = path.resolve(process.env.STUDENT_PHOTO_STORAGE_DIR || defaultStorageDirectory);
const queueDirectory = path.join(storageDirectory, '.sync-queue');

if (!['supabase', 'local'].includes(configuredStorageDriver)) {
  throw new Error('STORAGE_DRIVER must be supabase or local');
}
if (!supabaseUrl || !supabaseSecretKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be configured for student photo storage and cloud synchronization');
}
let parsedSupabaseUrl;
try {
  parsedSupabaseUrl = new URL(supabaseUrl);
} catch {
  throw new Error('SUPABASE_URL must be a valid URL');
}
if (!['http:', 'https:'].includes(parsedSupabaseUrl.protocol) ||
    (process.env.NODE_ENV === 'production' && parsedSupabaseUrl.protocol !== 'https:')) {
  throw new Error('SUPABASE_URL must use HTTPS in production');
}

const supabase = createClient(supabaseUrl, supabaseSecretKey, {
  auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false }
});

export function studentPhotoPublicId(url) {
  const match = typeof url === 'string' && photoUrlPattern.exec(url);
  return match ? match[1].toLowerCase() : null;
}

export function studentPhotoContentType(filename) {
  return /\.webp$/i.test(filename) ? 'image/webp' : 'image/jpeg';
}

function badPhoto(message) {
  return Object.assign(new Error(message), { status: 400 });
}

async function writeQueueTask(task) {
  await mkdir(queueDirectory, { recursive: true });
  const taskPath = path.join(queueDirectory, `${Date.now()}-${randomUUID()}.json`);
  const temporaryPath = `${taskPath}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(task), { flag: 'wx', mode: 0o600 });
    await rename(temporaryPath, taskPath);
    return taskPath;
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function removeQueueTask(taskPath) {
  await rm(taskPath, { force: true });
}

async function replaceQueueTask(taskPath, task) {
  const temporaryPath = `${taskPath}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(task), { flag: 'wx', mode: 0o600 });
    await rename(temporaryPath, taskPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function readQueueTasks() {
  let names;
  try {
    names = await readdir(queueDirectory);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const tasks = [];
  for (const name of names.filter(entry => entry.endsWith('.json')).sort()) {
    const taskPath = path.join(queueDirectory, name);
    const task = JSON.parse(await readFile(taskPath, 'utf8'));
    if (!filenamePattern.test(task.filename) || !['upload', 'download', 'delete'].includes(task.operation) ||
        !Number.isInteger(task.attempts) || !Number.isFinite(task.nextAttemptAt)) {
      throw new Error(`Invalid student photo sync task: ${name}`);
    }
    tasks.push({ ...task, taskPath });
  }
  return tasks;
}

async function readCloudPhoto(filename) {
  const { data, error } = await supabase.storage.from(bucketName).download(filename);
  if (error) {
    if (error.statusCode === '404' || error.status === 404) {
      throw Object.assign(new Error('Student photo not found'), { code: 'ENOENT' });
    }
    throw error;
  }
  return Buffer.from(await data.arrayBuffer());
}

async function uploadCloudPhoto(filename, image) {
  const { error } = await supabase.storage.from(bucketName).upload(filename, image, {
    contentType: studentPhotoContentType(filename),
    cacheControl: '0',
    upsert: true
  });
  if (error) throw error;
}

async function deleteCloudPhoto(filename) {
  const { error } = await supabase.storage.from(bucketName).remove([filename]);
  if (error) throw error;
}

export async function saveStudentPhoto(base64) {
  if (typeof base64 !== 'string' || !base64 || base64.length > 1_400_000 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw badPhoto('The cropped photo is invalid');
  }
  const image = Buffer.from(base64, 'base64');
  if (!image.length || image.length > maxPhotoBytes || image.toString('base64') !== base64) {
    throw badPhoto('The cropped photo must be a JPEG or WebP image no larger than 1 MB');
  }

  const isJpeg = image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff &&
    image[image.length - 2] === 0xff && image[image.length - 1] === 0xd9;
  const isWebp = image.length >= 12 && image.toString('ascii', 0, 4) === 'RIFF' &&
    image.toString('ascii', 8, 12) === 'WEBP';
  if (!isJpeg && !isWebp) throw badPhoto('The cropped photo must be a valid JPEG or WebP image');

  const filename = `${randomUUID()}.${isWebp ? 'webp' : 'jpg'}`;
  if (configuredStorageDriver === 'local') {
    await mkdir(storageDirectory, { recursive: true });
    const photoPath = path.join(storageDirectory, filename);
    await writeFile(photoPath, image, { flag: 'wx', mode: 0o600 });
    try {
      await writeQueueTask({
        operation: 'upload',
        filename,
        attempts: 0,
        nextAttemptAt: 0,
        lastError: null
      });
    } catch (error) {
      await rm(photoPath, { force: true });
      throw error;
    }
  } else {
    await uploadCloudPhoto(filename, image);
  }
  return { filename, url: `/student-photos/${filename}` };
}

export async function readStudentPhoto(filename) {
  if (!filenamePattern.test(filename)) throw badPhoto('Invalid photo identifier');
  if (configuredStorageDriver === 'local') {
    try {
      return await readFile(path.join(storageDirectory, filename));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if ((await readQueueTasks()).some(task => task.filename === filename && task.operation === 'delete')) {
      throw Object.assign(new Error('Student photo not found'), { code: 'ENOENT' });
    }
    const image = await readCloudPhoto(filename);
    await mkdir(storageDirectory, { recursive: true });
    try {
      await writeFile(path.join(storageDirectory, filename), image, { flag: 'wx', mode: 0o600 });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    return image;
  }
  return readCloudPhoto(filename);
}

export async function deleteStudentPhoto(url) {
  const match = typeof url === 'string' && /^\/student-photos\/([^/]+)$/.exec(url);
  if (!match || !filenamePattern.test(match[1])) return;
  if (configuredStorageDriver === 'local') {
    const taskPath = await writeQueueTask({
      operation: 'delete',
      filename: match[1],
      attempts: 0,
      nextAttemptAt: 0,
      lastError: null
    });
    try {
      await rm(path.join(storageDirectory, match[1]), { force: true });
    } catch (error) {
      await removeQueueTask(taskPath);
      throw error;
    }
  } else {
    await deleteCloudPhoto(match[1]);
  }
}

async function queueMissingCloudPhotos(photoUrls) {
  const tasks = await readQueueTasks();
  const taskFilenames = new Set(tasks.map(task => task.filename));
  for (const url of new Set(photoUrls)) {
    const match = typeof url === 'string' && /^\/student-photos\/([^/]+)$/.exec(url);
    if (!match || !filenamePattern.test(match[1]) || taskFilenames.has(match[1])) continue;
    try {
      await readFile(path.join(storageDirectory, match[1]));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await writeQueueTask({
        operation: 'download',
        filename: match[1],
        attempts: 0,
        nextAttemptAt: 0,
        lastError: null
      });
      taskFilenames.add(match[1]);
    }
  }
}

let photoSyncRun;
export async function syncPendingStudentPhotos({ direction = 'both', photoUrls = [], retryFailed = false } = {}) {
  if (configuredStorageDriver !== 'local') {
    return { processed: 0, synced: 0, failed: 0, uploaded: 0, downloaded: 0 };
  }
  if (!['local_to_cloud', 'cloud_to_local', 'both'].includes(direction)) {
    throw Object.assign(new Error('Invalid student photo synchronization direction'), { status: 400 });
  }
  if (photoSyncRun) return photoSyncRun;
  photoSyncRun = (async () => {
    if (direction !== 'local_to_cloud') await queueMissingCloudPhotos(photoUrls);
    const tasks = await readQueueTasks();
    const supersededUploads = direction !== 'cloud_to_local' ? tasks.filter(task =>
      task.operation === 'upload' &&
      tasks.some(candidate => candidate.operation === 'delete' && candidate.filename === task.filename)
    ) : [];
    await Promise.all(supersededUploads.map(task => removeQueueTask(task.taskPath)));
    const dueTasks = tasks.filter(task => {
      const directionMatches = task.operation === 'download'
        ? direction !== 'local_to_cloud'
        : direction !== 'cloud_to_local';
      return directionMatches && !supersededUploads.includes(task) &&
        (retryFailed || task.nextAttemptAt <= Date.now());
    });
    let synced = 0;
    let failed = 0;
    let uploaded = 0;
    let downloaded = 0;
    for (const task of dueTasks) {
      try {
        if (task.operation === 'upload') {
          const image = await readFile(path.join(storageDirectory, task.filename));
          await uploadCloudPhoto(task.filename, image);
          uploaded += 1;
        } else if (task.operation === 'download') {
          const image = await readCloudPhoto(task.filename);
          await mkdir(storageDirectory, { recursive: true });
          try {
            await writeFile(path.join(storageDirectory, task.filename), image, { flag: 'wx', mode: 0o600 });
          } catch (error) {
            if (error.code !== 'EEXIST') throw error;
          }
          downloaded += 1;
        } else {
          await deleteCloudPhoto(task.filename);
        }
        await removeQueueTask(task.taskPath);
        synced += 1;
      } catch (error) {
        const attempts = task.attempts + 1;
        const delayMs = Math.min(5_000 * (2 ** Math.min(attempts, 12)), 900_000);
        const updatedTask = {
          operation: task.operation,
          filename: task.filename,
          attempts,
          nextAttemptAt: Date.now() + delayMs,
          lastError: error.code || error.name || 'storage_sync_error'
        };
        await replaceQueueTask(task.taskPath, updatedTask);
        failed += 1;
      }
    }
    return { processed: dueTasks.length, synced, failed, uploaded, downloaded };
  })();
  try {
    return await photoSyncRun;
  } finally {
    photoSyncRun = null;
  }
}

export async function retryFailedStudentPhotoSync() {
  if (photoSyncRun) await photoSyncRun;
  const tasks = await readQueueTasks();
  const failedTasks = tasks.filter(task => task.attempts > 0);
  await Promise.all(failedTasks.map(task => replaceQueueTask(task.taskPath, {
    operation: task.operation,
    filename: task.filename,
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null
  })));
  return failedTasks.length;
}

export async function getStudentPhotoSyncStatus() {
  if (configuredStorageDriver !== 'local') {
    return {
      enabled: false, pending: 0, failed: 0, pendingUploads: 0,
      pendingDownloads: 0, failedUploads: 0, failedDownloads: 0, running: false
    };
  }
  const tasks = await readQueueTasks();
  const pendingTasks = tasks.filter(task => task.attempts === 0);
  const failedTasks = tasks.filter(task => task.attempts > 0);
  return {
    enabled: true,
    pending: pendingTasks.length,
    failed: failedTasks.length,
    pendingUploads: pendingTasks.filter(task => task.operation === 'upload').length,
    pendingDownloads: pendingTasks.filter(task => task.operation === 'download').length,
    failedUploads: failedTasks.filter(task => task.operation === 'upload').length,
    failedDownloads: failedTasks.filter(task => task.operation === 'download').length,
    running: Boolean(photoSyncRun)
  };
}

export async function recordStudentPhoto(db, ownerId, url, title = 'Student profile photo') {
  if (!studentPhotoPublicId(url)) throw badPhoto('Invalid photo identifier');
  await db.execute(
    `INSERT INTO student_photos (title, url, owner_id) VALUES (?, ?, ?)
     ON CONFLICT (url) DO UPDATE SET title = EXCLUDED.title, owner_id = EXCLUDED.owner_id`,
    [title, url, ownerId]
  );
}

export async function deleteStudentPhotoIfUnreferenced(db, url) {
  if (!studentPhotoPublicId(url)) return false;
  const [[studentReference]] = await db.execute(
    'SELECT 1 FROM students WHERE photo_url = ? LIMIT 1',
    [url]
  );
  if (studentReference) return false;
  const [[activityReference]] = await db.execute(
    'SELECT 1 FROM activity_logs WHERE details::text LIKE ? LIMIT 1',
    [`%${url}%`]
  );
  if (activityReference) return false;
  await deleteStudentPhoto(url);
  await db.execute('DELETE FROM student_photos WHERE url = ?', [url]);
  return true;
}
