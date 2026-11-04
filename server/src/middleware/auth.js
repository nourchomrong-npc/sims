export function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.user) return res.status(401).json({ error: 'Authentication required' });
    if (!roles.includes(req.session.user.role)) return res.status(403).json({ error: 'Insufficient permission' });
    next();
  };
}

export function requirePasswordChanged(req, res, next) {
  if (req.session.user?.must_change_password) {
    return res.status(403).json({ error: 'Change your initial password before using the system' });
  }
  next();
}
