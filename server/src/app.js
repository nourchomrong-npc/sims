import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import session from 'express-session';
import PgSessionFactory from 'connect-pg-simple';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { bindDatabaseMode, pgPool, pool } from './config/db.js';
import api from './routes/api.js';
import { errorHandler, notFound } from './middleware/errors.js';
import { configureRateLimiters } from './middleware/rateLimit.js';
import { requestLogger } from './utils/logger.js';
import sync from './routes/sync.js';
import { API_PREFIX, apiRoutes } from './routes/apiRoutes.js';

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 ||
    /replace|change.?me|placeholder/i.test(process.env.SESSION_SECRET)) {
  throw new Error('SESSION_SECRET must contain at least 32 characters');
}

const isProduction = process.env.NODE_ENV === 'production';
const configuredOrigins = process.env.CLIENT_URLS || process.env.CLIENT_URL ||
  (isProduction ? '' : 'http://localhost:5173');
const allowedOrigins = configuredOrigins.split(',').map(origin => origin.trim()).filter(Boolean);
if (!allowedOrigins.length) throw new Error('CLIENT_URL or CLIENT_URLS must configure the frontend origin');
for (const origin of allowedOrigins) {
  let parsedOrigin;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    throw new Error('CLIENT_URLS must contain valid origin URLs');
  }
  const isLocalhost = parsedOrigin.hostname === 'localhost' || parsedOrigin.hostname.endsWith('.localhost') ||
    parsedOrigin.hostname === '127.0.0.1' || parsedOrigin.hostname === '[::1]';
  if (parsedOrigin.origin !== origin ||
      (isProduction && (parsedOrigin.protocol !== 'https:' || isLocalhost))) {
    throw new Error('CLIENT_URLS must contain exact origins and use HTTPS in production');
  }
}
const sameSite = process.env.SESSION_COOKIE_SAME_SITE || (isProduction ? 'none' : 'lax');
if (!['strict', 'lax', 'none'].includes(sameSite)) {
  throw new Error('SESSION_COOKIE_SAME_SITE must be strict, lax, or none');
}
if (isProduction && sameSite === 'none' && process.env.SESSION_COOKIE_SAME_SITE !== 'none') {
  throw new Error('Configure SESSION_COOKIE_SAME_SITE explicitly for production');
}

const app = express();
const PgSessionStore = PgSessionFactory(session);
const sessionStore = new PgSessionStore({
  pool: pgPool,
  tableName: 'user_sessions',
  createTableIfMissing: true,
  pruneSessionInterval: 15 * 60
});

app.disable('x-powered-by');
app.set('trust proxy', isProduction ? 1 : false);
app.use(requestLogger);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(Object.assign(new Error('Origin is not allowed'), { status: 403 }));
  },
  credentials: true
}));
app.use(express.json({ limit: '1500kb' }));
app.use(bindDatabaseMode);
app.use(session({
  name: 'sims.sid',
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  proxy: isProduction,
  cookie: {
    httpOnly: true,
    secure: isProduction,
    sameSite,
    maxAge: 8 * 60 * 60 * 1000
  }
}));

const { generalLimiter } = configureRateLimiters();

app.get(apiRoutes.live, (req, res) => res.json({ status: 'ok' }));
app.get(apiRoutes.ready, async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
});
app.get(apiRoutes.health, async (req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok' });
});
app.use(API_PREFIX, generalLimiter);
app.use(`${API_PREFIX}${apiRoutes.sync.base}`, sync);
app.use(API_PREFIX, api);
if (process.env.SERVE_CLIENT === 'true') {
  const clientBuildDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
  if (!existsSync(path.join(clientBuildDirectory, 'index.html'))) {
    throw new Error('SERVE_CLIENT=true requires a production build in client/dist');
  }
  app.use((req, res, next) => {
    if (req.path === API_PREFIX || req.path.startsWith(`${API_PREFIX}/`)) return next();
    return express.static(clientBuildDirectory, { index: false })(req, res, next);
  });
  app.get(/^(?!\/api(?:\/|$)).*/, (req, res, next) => {
    res.sendFile(path.join(clientBuildDirectory, 'index.html'), error => {
      if (error) next(error);
    });
  });
}
app.use(notFound);
app.use(errorHandler);

export async function closeDependencies() {
  const results = await Promise.allSettled([sessionStore.close()]);
  const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (failures.length) throw new AggregateError(failures, 'One or more application stores failed to close');
}

export default app;
