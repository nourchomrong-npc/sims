import { logError } from '../utils/logger.js';

export function notFound(req, res) {
  res.status(404).json({ error: 'Endpoint not found' });
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = error.status || 500;
  logError({
    event: 'http.request_error',
    requestId: req.requestId,
    status,
    name: error.name || 'Error',
    code: error.code,
    ...(status >= 500 ? { message: error.message || 'Unknown server error' } : {})
  });
  res.status(status).json({
    error: status < 500 ? error.message : 'An unexpected server error occurred',
    request_id: req.requestId
  });
}
