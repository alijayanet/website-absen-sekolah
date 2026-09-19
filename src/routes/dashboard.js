const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { isAuthenticated } = require('../middlewares/auth');
const whatsapp = require('../services/whatsapp');

// Dashboard Utama
router.get('/dashboard', isAuthenticated, (req, res) => {
  const user = req.session.user;
  const isGuru = user.role === 'guru';
  const classFilter = isGuru && user.class_id ? user.class_id : null;

  const today = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD

  // Total Siswa
  let totalStudentsQuery = 'SELECT COUNT(*) as count FROM students WHERE is_active = 1';
  let totalStudentsParams = [];
  if (isGuru) {
    if (user.class_id) {
      totalStudentsQuery += ' AND class_id = ?';
      totalStudentsParams.push(user.class_id);
    } else {
      totalStudentsQuery += ' AND 1 = 0';
    }
  }
  const totalStudents = db.prepare(totalStudentsQuery).get(...totalStudentsParams)?.count || 0;

  // Statistik Kehadiran Hari Ini
  let statsQuery = `
    SELECT 
      SUM(CASE WHEN a.status = 'HADIR' THEN 1 ELSE 0 END) as hadir,
      SUM(CASE WHEN a.status = 'TERLAMBAT' THEN 1 ELSE 0 END) as terlambat,
      SUM(CASE WHEN a.status = 'IZIN' THEN 1 ELSE 0 END) as izin,
      SUM(CASE WHEN a.status = 'SAKIT' THEN 1 ELSE 0 END) as sakit,
      COUNT(a.id) as total_masuk
    FROM attendances a
    JOIN students s ON a.student_id = s.id
    WHERE a.date = ?
  `;
  let statsParams = [today];
  if (isGuru) {
    if (user.class_id) {
      statsQuery += ' AND s.class_id = ?';
      statsParams.push(user.class_id);
    } else {
      statsQuery += ' AND 1 = 0';
    }
  }
  const stats = db.prepare(statsQuery).get(...statsParams) || {};

  const hadir = stats.hadir || 0;
  const terlambat = stats.terlambat || 0;
  const izin = stats.izin || 0;
  const sakit = stats.sakit || 0;
  const totalMasuk = stats.total_masuk || 0;
  const belumHadir = Math.max(0, totalStudents - totalMasuk);
  const persentase = totalStudents > 0 ? Math.round(((hadir + terlambat) / totalStudents) * 100) : 0;

  // 10 Aktivitas Absensi Terakhir Hari Ini
  let recentQuery = `
    SELECT a.*, s.name as student_name, s.nis, s.photo, c.name as class_name
    FROM attendances a
    JOIN students s ON a.student_id = s.id
    LEFT JOIN classes c ON s.class_id = c.id
    WHERE a.date = ?
  `;
  let recentParams = [today];
  if (isGuru) {
    if (user.class_id) {
      recentQuery += ' AND s.class_id = ?';
      recentParams.push(user.class_id);
    } else {
      recentQuery += ' AND 1 = 0';
    }
  }
  recentQuery += ' ORDER BY a.id DESC LIMIT 10';
  const recentLogs = db.prepare(recentQuery).all(...recentParams);

  // Status WhatsApp & Antrean
  const waStatus = whatsapp.getStatus();
  const queueStats = db.prepare(`
    SELECT 
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
    FROM wa_queue
  `).get() || { pending: 0, sent: 0, failed: 0 };

  // Status Verifikasi WA Siswa
  let waVerifQuery = `
    SELECT 
      SUM(CASE WHEN wa_status = 'confirmed' THEN 1 ELSE 0 END) as confirmed,
      SUM(CASE WHEN wa_status = 'intro_sent' THEN 1 ELSE 0 END) as intro_sent,
      SUM(CASE WHEN wa_status = 'unverified' THEN 1 ELSE 0 END) as unverified
    FROM students
    WHERE is_active = 1
  `;
  let waVerifParams = [];
  if (isGuru) {
    if (user.class_id) {
      waVerifQuery += ' AND class_id = ?';
      waVerifParams.push(user.class_id);
    } else {
      waVerifQuery += ' AND 1 = 0';
    }
  }
  const waVerificationStats = db.prepare(waVerifQuery).get(...waVerifParams) || { confirmed: 0, intro_sent: 0, unverified: 0 };

  res.render('dashboard/index', {
    metrics: {
      totalStudents,
      hadir,
      terlambat,
      izin,
      sakit,
      belumHadir,
      persentase
    },
    recentLogs,
    waStatus,
    queueStats,
    waVerificationStats,
    today
  });
});

module.exports = router;
