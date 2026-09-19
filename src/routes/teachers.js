const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../database/db');
const { isAuthenticated, isAdmin } = require('../middlewares/auth');

// 1. Tampilkan Daftar Guru & Wali Kelas
router.get('/dashboard/teachers', isAuthenticated, isAdmin, (req, res) => {
  try {
    const users = db.prepare(`
      SELECT u.id, u.username, u.name, u.phone, u.role, u.class_id, u.created_at, 
             c.name as class_name, c.level as class_level
      FROM users u
      LEFT JOIN classes c ON u.class_id = c.id
      ORDER BY CASE WHEN u.role = 'admin' THEN 0 ELSE 1 END, c.name ASC, u.name ASC
    `).all();

    const classes = db.prepare('SELECT * FROM classes ORDER BY name ASC').all();

    res.render('dashboard/teachers', {
      users,
      classes,
      successMsg: req.query.success || null,
      errorMsg: req.query.error || null
    });
  } catch (err) {
    console.error('Error load teachers:', err);
    res.status(500).send('Gagal memuat data guru: ' + err.message);
  }
});

// 2. Tambah Akun Guru / Wali Kelas Baru
router.post('/dashboard/teachers', isAuthenticated, isAdmin, (req, res) => {
  try {
    const { name, username, password, phone, class_id, role } = req.body;

    if (!name || !username || !password) {
      return res.redirect('/dashboard/teachers?error=Nama lengkap, username, dan password wajib diisi.');
    }

    const cleanUsername = username.trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
    if (existing) {
      return res.redirect('/dashboard/teachers?error=Username sudah digunakan, silakan pilih username lain.');
    }

    const userRole = role === 'admin' ? 'admin' : 'guru';
    const assignedClassId = (userRole === 'guru' && class_id) ? Number(class_id) : null;
    const cleanPhone = phone ? phone.trim() : null;

    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(password.trim(), salt);

    const stmt = db.prepare(`
      INSERT INTO users (username, password_hash, name, phone, role, class_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(cleanUsername, passwordHash, name.trim(), cleanPhone, userRole, assignedClassId);

    res.redirect('/dashboard/teachers?success=Akun guru / wali kelas berhasil ditambahkan.');
  } catch (err) {
    console.error('Error create teacher:', err);
    res.redirect('/dashboard/teachers?error=' + encodeURIComponent(err.message));
  }
});

// 3. Edit Data Guru / Ganti Kelas Binaan / Reset Password
router.post('/dashboard/teachers/:id/edit', isAuthenticated, isAdmin, (req, res) => {
  try {
    const id = req.params.id;
    const { name, username, password, phone, class_id, role } = req.body;

    const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!targetUser) {
      return res.redirect('/dashboard/teachers?error=Pengguna tidak ditemukan.');
    }

    const cleanUsername = username ? username.trim().toLowerCase() : targetUser.username;
    const existing = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(cleanUsername, id);
    if (existing) {
      return res.redirect('/dashboard/teachers?error=Username sudah digunakan oleh akun lain.');
    }

    const userRole = role ? (role === 'admin' ? 'admin' : 'guru') : targetUser.role;
    const assignedClassId = (userRole === 'guru' && class_id) ? Number(class_id) : null;
    const cleanPhone = phone !== undefined ? (phone ? phone.trim() : null) : targetUser.phone;

    if (password && password.trim().length > 0) {
      const salt = bcrypt.genSaltSync(10);
      const passwordHash = bcrypt.hashSync(password.trim(), salt);

      const stmt = db.prepare(`
        UPDATE users 
        SET name = ?, username = ?, phone = ?, role = ?, class_id = ?, password_hash = ?
        WHERE id = ?
      `);
      stmt.run(name.trim(), cleanUsername, cleanPhone, userRole, assignedClassId, passwordHash, id);
    } else {
      const stmt = db.prepare(`
        UPDATE users 
        SET name = ?, username = ?, phone = ?, role = ?, class_id = ?
        WHERE id = ?
      `);
      stmt.run(name.trim(), cleanUsername, cleanPhone, userRole, assignedClassId, id);
    }

    // Jika admin mengedit akunnya sendiri, perbarui session
    if (req.session.user && req.session.user.id == id) {
      req.session.user.name = name.trim();
      req.session.user.username = cleanUsername;
      req.session.user.phone = cleanPhone;
      req.session.user.role = userRole;
      req.session.user.class_id = assignedClassId;
      req.session.user.class_name = null; // akan diisi otomatis oleh middleware
    }

    res.redirect('/dashboard/teachers?success=Data guru berhasil diperbarui.');
  } catch (err) {
    console.error('Error edit teacher:', err);
    res.redirect('/dashboard/teachers?error=' + encodeURIComponent(err.message));
  }
});

// 4. Hapus Akun Guru
router.post('/dashboard/teachers/:id/delete', isAuthenticated, isAdmin, (req, res) => {
  try {
    const id = req.params.id;

    if (req.session.user && req.session.user.id == id) {
      return res.redirect('/dashboard/teachers?error=Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif.');
    }

    const targetUser = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    if (!targetUser) {
      return res.redirect('/dashboard/teachers?error=Pengguna tidak ditemukan.');
    }

    if (targetUser.role === 'admin') {
      const adminCount = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get()?.count || 0;
      if (adminCount <= 1) {
        return res.redirect('/dashboard/teachers?error=Tidak dapat menghapus administrator terakhir.');
      }
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    res.redirect('/dashboard/teachers?success=Akun guru berhasil dihapus.');
  } catch (err) {
    console.error('Error delete teacher:', err);
    res.redirect('/dashboard/teachers?error=' + encodeURIComponent(err.message));
  }
});

module.exports = router;
