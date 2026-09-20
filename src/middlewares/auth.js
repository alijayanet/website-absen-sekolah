const db = require('../database/db');

// Middleware untuk memastikan pengguna sudah login
function isAuthenticated(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.status(401).json({ success: false, message: 'Silakan login terlebih dahulu' });
  }
  return res.redirect('/login');
}

// Middleware untuk memastikan hak akses adalah Admin
function isAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') {
    return next();
  }
  if (req.xhr || req.headers.accept?.includes('json')) {
    return res.status(403).json({ success: false, message: 'Akses khusus Administrator' });
  }
  return res.status(403).send('Akses Ditolak: Hanya Administrator yang berhak mengakses halaman ini.');
}

// Middleware untuk menyematkan data pengguna dan pengaturan sekolah ke res.locals
function attachGlobalData(req, res, next) {
  try {
    // Ambil seluruh pengaturan sekolah ke object key-value
    const settingsRows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const row of settingsRows) {
      settings[row.key] = row.value;
    }

    res.locals.settings = settings;
    let pendingLeavesCount = 0;

    if (req.session && req.session.user) {
      if (req.session.user.class_id && !req.session.user.class_name) {
        const cls = db.prepare('SELECT name FROM classes WHERE id = ?').get(req.session.user.class_id);
        req.session.user.class_name = cls ? cls.name : null;
      }
      res.locals.currentUser = req.session.user;

      // Hitung permohonan izin pending
      try {
        if (req.session.user.role === 'admin') {
          const row = db.prepare("SELECT COUNT(*) as c FROM leave_requests WHERE status = 'PENDING'").get();
          pendingLeavesCount = row ? row.c : 0;
        } else if (req.session.user.role === 'guru' && req.session.user.class_id) {
          const row = db.prepare(`
            SELECT COUNT(*) as c 
            FROM leave_requests lr 
            JOIN students s ON lr.student_id = s.id 
            WHERE lr.status = 'PENDING' AND s.class_id = ?
          `).get(req.session.user.class_id);
          pendingLeavesCount = row ? row.c : 0;
        }
      } catch (countErr) {
        pendingLeavesCount = 0;
      }
    } else {
      res.locals.currentUser = null;
    }
    res.locals.pendingLeavesCount = pendingLeavesCount;
    res.locals.currentPath = req.path;
  } catch (err) {
    console.error('Error in attachGlobalData middleware:', err);
    res.locals.settings = {};
    res.locals.currentUser = null;
    res.locals.currentPath = req.path;
  }
  next();
}

module.exports = {
  isAuthenticated,
  isAdmin,
  attachGlobalData,
  requireAuth: isAuthenticated,
  requireAdmin: isAdmin
};
