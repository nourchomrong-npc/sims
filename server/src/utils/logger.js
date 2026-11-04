import { randomUUID } from 'node:crypto';

function write(level, fields) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    ...fields
  };
  console[level === 'error' ? 'error' : 'log'](JSON.stringify(entry));
}

export function logInfo(fields) {
  write('info', fields);
}

export function logError(fields) {
  write('error', fields);
}

export function requestLogger(req, res, next) {
  const startedAt = Date.now();
  req.requestId = randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  res.on('finish', () => {
    logInfo({
      event: 'http.request',
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durationMs: Date.now() - startedAt
    });
  });
  next();
}
