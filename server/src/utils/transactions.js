import { runWithPoolTransaction } from '../config/db.js';
import { activityLoggedForRequest, logActivity } from './activity.js';

const superAdminAuditExclusions = new Set([
  '/class-schedules/validate',
  '/sync/connections/test',
  '/connections/test'
]);

export function transactionalMutation(pool, handler) {
  return async (req, res, next) => {
    let connection;
    let transactionStarted = false;
    let responseAction = null;
    let responseStatus = res.statusCode;
    const originalStatus = res.status;
    const originalJson = res.json;
    const originalSend = res.send;
    const originalEnd = res.end;

    res.status = code => {
      responseStatus = code;
      return res;
    };
    res.json = body => {
      responseAction = () => originalJson.call(res, body);
      return res;
    };
    res.send = body => {
      responseAction = () => originalSend.call(res, body);
      return res;
    };
    res.end = (...args) => {
      responseAction = () => originalEnd.apply(res, args);
      return res;
    };

    try {
      connection = await pool.getConnection();
      await connection.beginTransaction();
      transactionStarted = true;
      await runWithPoolTransaction(pool, connection, () => handler(req, res, next));

      if (responseStatus < 200 || responseStatus >= 300) {
        await connection.rollback();
        transactionStarted = false;
      } else {
        if (req.session?.user?.role === 'SuperAdmin' &&
          !superAdminAuditExclusions.has(req.path) &&
          !activityLoggedForRequest(req)) {
          const method = req.method;
          const path = String(req.originalUrl || req.url || '').split('?')[0].slice(0, 500);
          const fields = Object.keys(req.body || {})
            .filter(field => !/(?:password|secret|token|hash|authorization|cookie)/i.test(field));
          await logActivity(connection, req.session.user.internalId, 'superadmin_action', 'system', null, {
            summary: `SuperAdmin request: ${method} ${path}`,
            fields
          });
        }
        await connection.commit();
        transactionStarted = false;
      }

      res.status = originalStatus;
      res.json = originalJson;
      res.send = originalSend;
      res.end = originalEnd;
      if (responseAction) {
        if (responseStatus !== res.statusCode && originalStatus) originalStatus.call(res, responseStatus);
        responseAction();
      } else {
        next();
      }
    } catch (error) {
      if (transactionStarted) {
        try {
          await connection.rollback();
        } catch {
          // Preserve the original transaction error.
        }
      }
      res.status = originalStatus;
      res.json = originalJson;
      res.send = originalSend;
      res.end = originalEnd;
      next(error);
    } finally {
      connection?.release();
    }
  };
}
