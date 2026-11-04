import { createHash } from 'node:crypto';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import { logInfo } from '../utils/logger.js';

const activeLimiters = {};

function requestKey(req) {
  const userId = req.session?.user?.internalId;
  return userId ? `user:${userId}` : `ip:${ipKeyGenerator(req.ip || 'unknown')}`;
}

function ipRequestKey(req) {
  return `ip:${ipKeyGenerator(req.ip || 'unknown')}`;
}

function loginRequestKey(req) {
  const username = typeof req.body?.username === 'string'
    ? req.body.username.trim().slice(0, 80).toLowerCase()
    : '';
  const usernameHash = createHash('sha256').update(username).digest('hex');
  return `login:${ipKeyGenerator(req.ip || 'unknown')}:${usernameHash}`;
}

export function createRateLimiter({ windowMs, limit, store, keyGenerator = requestKey, category }) {
  return rateLimit({
    windowMs,
    limit,
    store,
    keyGenerator,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    passOnStoreError: false,
    handler(req, res) {
      const resetTime = req.rateLimit?.resetTime;
      const retryAfter = resetTime
        ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
        : Math.max(1, Math.ceil(windowMs / 1000));
      logInfo({
        event: 'http.rate_limit_exceeded',
        requestId: req.requestId,
        category,
        method: req.method,
        path: req.path
      });
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({
        error: 'Too many requests. Please wait before trying again.',
        code: 'RATE_LIMITED',
        retry_after_seconds: retryAfter
      });
    }
  });
}

function configuredInteger(name, fallback) {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function createStore(prefix) {
  return undefined;
}

function deferredLimiter(name) {
  return (req, res, next) => {
    if (!activeLimiters[name]) return next(new Error(`Rate limiter ${name} has not been configured`));
    return activeLimiters[name](req, res, next);
  };
}

export function configureRateLimiters() {
  activeLimiters.general = createRateLimiter({
    windowMs: configuredInteger('RATE_LIMIT_GENERAL_WINDOW_MS', 15 * 60 * 1000),
    limit: configuredInteger('RATE_LIMIT_GENERAL_MAX', 120),
    store: createStore('general'),
    category: 'general'
  });
  activeLimiters.login = createRateLimiter({
    windowMs: configuredInteger('RATE_LIMIT_LOGIN_WINDOW_MS', 15 * 60 * 1000),
    limit: configuredInteger('RATE_LIMIT_LOGIN_MAX', 10),
    store: createStore('login'),
    keyGenerator: loginRequestKey,
    category: 'login'
  });
  activeLimiters.upload = createRateLimiter({
    windowMs: configuredInteger('RATE_LIMIT_UPLOAD_WINDOW_MS', 15 * 60 * 1000),
    limit: configuredInteger('RATE_LIMIT_UPLOAD_MAX', 10),
    store: createStore('upload'),
    category: 'upload'
  });
  activeLimiters.auth = createRateLimiter({
    windowMs: configuredInteger('RATE_LIMIT_AUTH_WINDOW_MS', 15 * 60 * 1000),
    limit: configuredInteger('RATE_LIMIT_AUTH_MAX', 10),
    store: createStore('auth'),
    category: 'sensitive_auth'
  });
  activeLimiters.expensive = createRateLimiter({
    windowMs: configuredInteger('RATE_LIMIT_EXPENSIVE_WINDOW_MS', 60 * 1000),
    limit: configuredInteger('RATE_LIMIT_EXPENSIVE_MAX', 30),
    store: createStore('expensive'),
    category: 'expensive'
  });
  return { generalLimiter: activeLimiters.general };
}

export const loginLimiter = deferredLimiter('login');
export const uploadLimiter = (req, res, next) => {
  if (!req.body?.photo_data) return next();
  return deferredLimiter('upload')(req, res, next);
};
export const sensitiveAuthLimiter = deferredLimiter('auth');
export const expensiveLimiter = deferredLimiter('expensive');
