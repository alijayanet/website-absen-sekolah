const express = require('express');
const router = express.Router();
const db = require('../database/db');

// Halaman Depan / Landing Page
router.get('/', (req, res) => {
  const keyword = (req.query.q || '').trim();
  let studentData = null;
  let attendanceSummary = null;
  let recentAttendances = [];
  let errorMsg = null;

  if (keyword) {
    // Cari data siswa berdasarkan NIS atau NISN
    studentData = db.prepare(`
      SELECT s.*, c.name as class_name 
      FROM students s 
      LEFT JOIN classes c ON s.class_id = c.id 
      WHERE (s.nis = ? OR s.nisn = ?) AND s.is_active = 1
    `).get(keyword, keyword);

    if (studentData) {
      // Ambil riwayat absensi bulan ini
      const now = new Date();
      const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      recentAttendances = db.prepare(`
        SELECT * FROM attendances 
        WHERE student_id = ? AND date LIKE ? 
        ORDER BY date DESC 
        LIMIT 31
      `).all(studentData.id, `${currentMonthPrefix}%`);

      // Hitung ringkasan statistik
      const stats = db.prepare(`
        SELECT 
          SUM(CASE WHEN status = 'HADIR' THEN 1 ELSE 0 END) as hadir,
          SUM(CASE WHEN status = 'TERLAMBAT' THEN 1 ELSE 0 END) as terlambat,
          SUM(CASE WHEN status = 'SAKIT' THEN 1 ELSE 0 END) as sakit,
          SUM(CASE WHEN status = 'IZIN' THEN 1 ELSE 0 END) as izin,
          SUM(CASE WHEN status = 'ALPA' THEN 1 ELSE 0 END) as alpa,
          COUNT(*) as total
        FROM attendances 
        WHERE student_id = ? AND date LIKE ?
      `).get(studentData.id, `${currentMonthPrefix}%`);

      attendanceSummary = {
        hadir: stats.hadir || 0,
        terlambat: stats.terlambat || 0,
        sakit: stats.sakit || 0,
        izin: stats.izin || 0,
        alpa: stats.alpa || 0,
        total: stats.total || 0,
        persentase: stats.total > 0 ? Math.round(((stats.hadir + stats.terlambat) / stats.total) * 100) : 0
      };
    } else {
      errorMsg = `Data siswa dengan NIS/NISN "${keyword}" tidak ditemukan. Pastikan nomor yang dimasukkan sudah benar.`;
    }
  }

  // Ringkasan statistik umum sekolah untuk landing page
  const totalStudents = db.prepare('SELECT COUNT(*) as count FROM students WHERE is_active = 1').get()?.count || 0;
  const totalClasses = db.prepare('SELECT COUNT(*) as count FROM classes').get()?.count || 0;
  const totalTeachers = db.prepare('SELECT COUNT(*) as count FROM users').get()?.count || 0;
  
  const today = new Date().toISOString().split('T')[0];
  const todayAttended = db.prepare('SELECT COUNT(*) as count FROM attendances WHERE date = ?').get(today)?.count || 0;

  // Daftar Dewan Guru & Tenaga Kependidikan dari Database
  const teachers = db.prepare(`
    SELECT u.id, u.name, u.role, c.name as class_name 
    FROM users u 
    LEFT JOIN classes c ON u.class_id = c.id 
    ORDER BY CASE WHEN u.role = 'guru' THEN 1 ELSE 2 END, u.name ASC
  `).all();

  // Galeri Sekolah
  const gallery = db.prepare('SELECT * FROM school_gallery ORDER BY id DESC').all();

  res.render('landing', {
    keyword,
    studentData,
    attendanceSummary,
    recentAttendances,
    errorMsg,
    gallery,
    teachers,
    overview: {
      totalStudents,
      totalClasses,
      totalTeachers,
      todayAttended
    }
  });
});

module.exports = router;
