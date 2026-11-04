import 'dotenv/config';
import bcrypt from 'bcrypt';
import { pool } from '../config/db.js';
import { logInfo } from './logger.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('The default administrator setup script is disabled in production');
}
if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32 ||
    /replace|change.?me|placeholder/i.test(process.env.SESSION_SECRET)) {
  throw new Error('Configure a SESSION_SECRET of at least 32 characters before setup');
}

try {
  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'Admin@12345';
  const [existing] = await pool.execute('SELECT id FROM users WHERE username = ?', [username]);
  if (existing.length) {
    throw new Error('The configured administrator account already exists; setup did not change its password');
  }
  const hash = await bcrypt.hash(password, 12);
  await pool.execute(
    'INSERT INTO users (username, password_hash, full_name, role, must_change_password) VALUES (?, ?, ?, ?, 1)',
    [username, hash, 'System Administrator', 'SuperAdmin']
  );
  logInfo({ event: 'development_admin_created', passwordChangeRequired: true });
  if (!process.env.ADMIN_PASSWORD) {
    logInfo({ event: 'development_admin_uses_documented_temporary_password' });
  }
} finally {
  await pool.end();
}
