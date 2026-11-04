import 'dotenv/config';
import app, { closeDependencies } from './app.js';
import { pool } from './config/db.js';
import { logError, logInfo } from './utils/logger.js';
import { initializeSync, stopSyncWorker } from './services/sync.js';

const port = Number(process.env.PORT || 5000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

await initializeSync();

const server = app.listen(port, '0.0.0.0', () => {
  logInfo({ event: 'server.listening', host: '0.0.0.0', port });
});
server.requestTimeout = 120_000;
server.headersTimeout = 30_000;
server.keepAliveTimeout = 5_000;

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logInfo({ event: 'server.shutdown_started', signal });
  const forceExit = setTimeout(() => {
    logError({ event: 'server.shutdown_timeout' });
    process.exit(1);
  }, 15_000);
  forceExit.unref();
  stopSyncWorker();
  try {
    const closeServer = new Promise(resolve => {
      server.close(error => resolve(error));
    });
    const serverError = await closeServer;
    const cleanupResults = await Promise.all([
      closeDependencies().then(() => null, error => error),
      pool.end().then(() => null, error => error)
    ]);
    const failures = [serverError, ...cleanupResults].filter(Boolean);
    if (failures.length) throw new AggregateError(failures, 'One or more server resources failed to close');
    logInfo({ event: 'server.shutdown_complete', signal });
  } catch (error) {
    logError({
      event: 'server.shutdown_error',
      name: error.name || 'Error',
      code: error.code
    });
    process.exitCode = 1;
  } finally {
    clearTimeout(forceExit);
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
