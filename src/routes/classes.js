const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { isAuthenticated, isAdmin } = require('../middlewares/auth');

// Daftar Kelas
router.get('/dashboard/classes', isAuthenticated, (req, res) => {
  const user = req.session.user;
  let query = `
    SELECT c.*, COUNT(s.id) as student_count
    FROM classes c
    LEFT JOIN students s ON c.id = s.class_id AND s.is_active = 1
  `;
  const params = [];

  // Jika guru, hanya tampilkan kelas binaannya
  if (user.role === 'guru') {
    if (user.class_id) {
      query += ` WHERE c.id = ? `;
      params.push(user.class_id);
    } else {
      query += ` WHERE 1 = 0 `;
    }
  }

  query += ` GROUP BY c.id ORDER BY c.name ASC `;
  const classes = db.prepare(query).all(...params);

  res.render('dashboard/classes', {
    classes,
    successMsg: req.query.success || null,
    errorMsg: req.query.error || (!user.class_id && user.role === 'guru' ? 'Akun Anda belum memiliki kelas binaan.' : null)
  });
});

// Tambah Kelas (Hanya Admin)
router.post('/dashboard/classes', isAuthenticated, isAdmin, (req, res) => {
  try {
    const { name, level } = req.body;
    if (!name) return res.redirect('/dashboard/classes?error=Nama kelas wajib diisi');

    db.prepare('INSERT INTO classes (name, level) VALUES (?, ?)').run(name.trim(), level ? level.trim() : null);
    res.redirect('/dashboard/classes?success=Kelas berhasil ditambahkan');
  } catch (err) {
    res.redirect(`/dashboard/classes?error=${encodeURIComponent(err.message)}`);
  }
});

// Edit Kelas
router.post('/dashboard/classes/:id/edit', isAuthenticated, isAdmin, (req, res) => {
  try {
    const { id } = req.params;
    const { name, level } = req.body;
    if (!name) return res.redirect('/dashboard/classes?error=Nama kelas wajib diisi');

    db.prepare('UPDATE classes SET name = ?, level = ? WHERE id = ?').run(name.trim(), level ? level.trim() : null, id);
    res.redirect('/dashboard/classes?success=Data kelas berhasil diperbarui');
  } catch (err) {
    res.redirect(`/dashboard/classes?error=${encodeURIComponent(err.message)}`);
  }
});

// Hapus Kelas
router.post('/dashboard/classes/:id/delete', isAuthenticated, isAdmin, (req, res) => {
  try {
    const { id } = req.params;
    // Cek apakah ada siswa di kelas ini
    const count = db.prepare('SELECT COUNT(*) as c FROM students WHERE class_id = ?').get(id)?.c || 0;
    if (count > 0) {
      return res.redirect(`/dashboard/classes?error=Tidak dapat menghapus kelas karena masih ada ${count} siswa terdaftar.`);
    }

    db.prepare('DELETE FROM classes WHERE id = ?').run(id);
    res.redirect('/dashboard/classes?success=Kelas berhasil dihapus');
  } catch (err) {
    res.redirect(`/dashboard/classes?error=${encodeURIComponent(err.message)}`);
  }
});

module.exports = router;
