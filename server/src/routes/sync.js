import { Router } from 'express';
import { apiRoutes } from './apiRoutes.js';
import { z } from 'zod';
import { getDatabaseMode, getDatabasePool, normalizeDatabaseMode, pool, runWithDatabaseMode } from '../config/db.js';
import { requireAuth, requirePasswordChanged, requireRole } from '../middleware/auth.js';
import {
  changeDatabaseMode,
  getSyncDashboard,
  getSyncHistoryPage,
  getSyncEventDetails,
  resolveSyncConflict,
  retryFailedSyncEvents,
  runSyncNow,
  setAutomaticSyncEnabled,
  testDatabaseConnection
} from '../services/sync.js';
import { parse, publicId } from '../utils/validation.js';
import { activityRequestContext, superAdminActivityAudit } from '../utils/activity.js';

const router = Router();
const administrator = requireRole('Admin', 'SuperAdmin');
router.use(activityRequestContext, superAdminActivityAudit(pool));
router.use(requireAuth, requirePasswordChanged, administrator);

router.get(apiRoutes.sync.status.slice(apiRoutes.sync.base.length), async (req, res) => {
  res.json(await getSyncDashboard());
});

router.get(apiRoutes.sync.history.slice(apiRoutes.sync.base.length), async (req, res) => {
  const { page, status, database, from, to } = parse(z.object({
    page: z.coerce.number().int().min(1).max(1000).default(1),
    status: z.enum(['all', 'running', 'completed', 'partial', 'failed']).default('all'),
    database: z.enum(['all', 'local', 'cloud']).default('all'),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional()
  }).superRefine((filters, context) => {
    if (Boolean(filters.from) !== Boolean(filters.to)) {
      context.addIssue({ code: 'custom', message: 'Both date-time bounds are required' });
    } else if (filters.from && filters.to && Date.parse(filters.from) > Date.parse(filters.to)) {
      context.addIssue({ code: 'custom', message: 'The start date-time must be before the end date-time' });
    }
  }), req.query);
  res.json(await getSyncHistoryPage(page, status, database, from, to));
});

router.post(apiRoutes.sync.connectionsTest.slice(apiRoutes.sync.base.length), async (req, res) => {
  const { database } = parse(z.object({ database: z.enum(['local', 'cloud']) }), req.body);
  res.json(await testDatabaseConnection(database));
});

router.patch(apiRoutes.sync.mode.slice(apiRoutes.sync.base.length), async (req, res) => {
  const { mode } = parse(z.object({
    mode: z.preprocess(normalizeDatabaseMode, z.enum(['local_only', 'cloud_only', 'hybrid']))
  }), req.body);
  const previousPool = getDatabasePool();
  const previousMode = getDatabaseMode();
  const activeMode = await changeDatabaseMode(mode);
  const activePool = getDatabasePool(mode === 'cloud_only' ? 'cloud' : 'local');
  if (previousPool !== activePool) {
    await runWithDatabaseMode(activeMode, () => new Promise((resolve, reject) => {
      req.session.save(error => error ? reject(error) : resolve());
    }));
    await previousPool.query('DELETE FROM user_sessions WHERE sid = $1', [req.sessionID]);
  }
  res.json({ mode: activeMode, previousMode });
});

router.patch(apiRoutes.sync.automatic.slice(apiRoutes.sync.base.length), async (req, res) => {
  const { enabled } = parse(z.object({ enabled: z.boolean() }), req.body);
  res.json(await setAutomaticSyncEnabled(enabled));
});

router.post(apiRoutes.sync.run.slice(apiRoutes.sync.base.length), async (req, res) => {
  const { direction } = parse(z.object({
    direction: z.enum(['local_to_cloud', 'cloud_to_local', 'both']).default('both')
  }), req.body ?? {});
  res.json(await runSyncNow(direction));
});

router.post(apiRoutes.sync.retry.slice(apiRoutes.sync.base.length), async (req, res) => {
  res.json(await retryFailedSyncEvents());
});

router.get(apiRoutes.sync.event.slice(apiRoutes.sync.base.length), async (req, res) => {
  const { id } = parse(z.object({ id: publicId }), req.params);
  res.json({ events: await getSyncEventDetails(id) });
});

router.post(apiRoutes.sync.resolveConflict.slice(apiRoutes.sync.base.length), async (req, res) => {
  const { id } = parse(z.object({ id: publicId }), req.params);
  const { resolution } = parse(z.object({
    resolution: z.enum(['keep_local', 'keep_cloud'])
  }), req.body);
  res.json(await resolveSyncConflict(id, resolution));
});

export default router;
