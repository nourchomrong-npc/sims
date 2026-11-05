import { apiRoutes } from './apiRoutes.js';
export function registerAuthRoutes(router, context) {
  const { bcrypt, z, pool, requireAuth, loginLimiter, sensitiveAuthLimiter, logActivity, resolvePublicId, idParam, loginInput, parse, publicId, superAdmin, verifyPassword, publicUser, resetUserPassword } = context;

  router.use(async (req, res, next) => {
    const previousSession = req.session?.user;
    if (!previousSession || previousSession.internalId) return next();
    const legacyId = previousSession.id;
    if (!/^\d+$/.test(String(legacyId))) return next();
    const [[user]] = await pool.execute(
      'SELECT id, public_id, username, full_name, role, must_change_password, active FROM users WHERE id = ? AND is_deleted = 0',
      [legacyId]
    );
    if (!user || !user.active) {
      await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
      res.clearCookie('sims.sid');
      return res.status(401).json({ error: 'Authentication required' });
    }
    req.session.user = {
      internalId: user.id,
      publicId: user.public_id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      must_change_password: Boolean(user.must_change_password)
    };
    next();
  });
  router.use(async (req, res, next) => {
    const sessionUser = req.session?.user;
    if (!sessionUser?.internalId) return next();
    const [[user]] = await pool.execute(
      'SELECT active, is_deleted FROM users WHERE id = ?',
      [sessionUser.internalId]
    );
    if (!user || !user.active || user.is_deleted) {
      await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
      res.clearCookie('sims.sid');
      return res.status(401).json({
        code: 'ACCOUNT_DISABLED',
        error: 'Your account has been disabled. Contact your system administrator.'
      });
    }
    next();
  });
  router.post(apiRoutes.auth.login, loginLimiter, async (req, res) => {
    const { username, password } = parse(loginInput, req.body);
    const [rows] = await pool.execute(
      'SELECT id, public_id, username, password_hash, full_name, role, must_change_password, active FROM users WHERE username = ? AND is_deleted = 0',
      [username]
    );
    const user = rows[0];
    const passwordMatches = await verifyPassword(password, user?.password_hash);
    if (!user || !user.active || !passwordMatches) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    await new Promise((resolve, reject) => req.session.regenerate(error => error ? reject(error) : resolve()));
    req.session.user = {
      internalId: user.id,
      publicId: user.public_id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      must_change_password: Boolean(user.must_change_password)
    };
    await logActivity(pool, user.id, 'login', 'user', user.id);
    res.json({ user: publicUser(req.session.user) });
  });
  router.post(apiRoutes.auth.logout, requireAuth, async (req, res) => {
    await logActivity(pool, req.session.user.internalId, 'logout', 'user', req.session.user.internalId);
    await new Promise((resolve, reject) => req.session.destroy(error => error ? reject(error) : resolve()));
    res.clearCookie('sims.sid');
    res.json({ success: true });
  });
  router.get(apiRoutes.auth.me, requireAuth, (req, res) => res.json({ user: publicUser(req.session.user) }));
  router.post(apiRoutes.auth.password, sensitiveAuthLimiter, requireAuth, async (req, res) => {
    const { new_password } = parse(z.object({
      new_password: z.string().min(12).max(200)
    }), req.body);
    const passwordHash = await bcrypt.hash(new_password, 12);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await connection.execute(
        'UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?',
        [passwordHash, req.session.user.internalId]
      );
      await logActivity(connection, req.session.user.internalId, 'password_changed', 'user', req.session.user.internalId);
      await connection.commit();
      req.session.user.must_change_password = false;
      res.json({ success: true });
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });
  router.post(apiRoutes.auth.passwordReset, sensitiveAuthLimiter, superAdmin, async (req, res) => {
    const { user_id } = parse(z.object({
      user_id: publicId
    }), req.body);
    const targetId = await resolvePublicId(pool, 'users', user_id, 404, true);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const payload = await resetUserPassword(connection, req.session.user.internalId, targetId);
      await connection.commit();
      res.json(payload);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });
  router.post(apiRoutes.users.resetPassword, sensitiveAuthLimiter, superAdmin, async (req, res) => {
    const { id: publicUserId } = parse(idParam, req.params);
    const targetId = await resolvePublicId(pool, 'users', publicUserId, 404, true);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const payload = await resetUserPassword(connection, req.session.user.internalId, targetId);
      await connection.commit();
      res.json(payload);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });
  router.post(apiRoutes.users.regeneratePassword, sensitiveAuthLimiter, superAdmin, async (req, res) => {
    const { id: publicUserId } = parse(idParam, req.params);
    const targetId = await resolvePublicId(pool, 'users', publicUserId, 404, true);
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const payload = await resetUserPassword(connection, req.session.user.internalId, targetId);
      await connection.commit();
      res.json(payload);
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  });
}
