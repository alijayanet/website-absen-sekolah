const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const db = require('../database/db');
const config = require('../config');

// Konfigurasi Upload Surat Dokter / Bukti Izin dari Orang Tua
const letterStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.lettersPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `surat_${Date.now()}_${Math.round(Math.random() * 1E9)}${ext}`;
    cb(null, uniqueName);
  }
});
const letterFilter = (req, file, cb) => {
  if (/image\/(jpeg|jpg|png|webp)|application\/pdf/.test(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Format berkas harus berupa gambar (JPG, PNG, WEBP) atau PDF.'));
  }
};
const uploadLetter = multer({
  storage: letterStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Maks 5MB
  fileFilter: letterFilter
});

// Halaman Depan / Landing Page
router.get('/', (req, res) => {
  const keyword = (req.query.q || '').trim();
  let studentData = null;
  let attendanceSummary = null;
  let recentAttendances = [];
  let recentLeaves = [];
  let waliKelas = null;
  let errorMsg = null;
  const leaveSuccess = req.query.leave_success || null;
  const leaveError = req.query.leave_error || null;


  if (keyword) {
    // Cari data siswa berdasarkan NIS atau NISN
    studentData = db.prepare(`
      SELECT s.*, c.name as class_name 
      FROM students s 
      LEFT JOIN classes c ON s.class_id = c.id 
      WHERE (s.nis = ? OR s.nisn = ?) AND s.is_active = 1
    `).get(keyword, keyword);

    if (studentData) {
      // Ambil Guru / Wali Kelas penanggung jawab rombel
      waliKelas = db.prepare(`
        SELECT u.name, u.phone 
        FROM users u 
        WHERE u.role = 'guru' AND u.class_id = ? 
        LIMIT 1
      `).get(studentData.class_id);

      // Ambil riwayat absensi bulan ini
      const now = new Date();
      const currentMonthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      recentAttendances = db.prepare(`
        SELECT * FROM attendances 
        WHERE student_id = ? AND date LIKE ? 
        ORDER BY date DESC 
        LIMIT 31
      `).all(studentData.id, `${currentMonthPrefix}%`);

      // Ambil riwayat pengajuan izin siswa terakhir
      recentLeaves = db.prepare(`
        SELECT lr.*, u.name as reviewer_name 
        FROM leave_requests lr 
        LEFT JOIN users u ON lr.reviewed_by = u.id 
        WHERE lr.student_id = ? 
        ORDER BY lr.id DESC 
        LIMIT 5
      `).all(studentData.id);

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
    recentLeaves,
    errorMsg,
    leaveSuccess,
    leaveError,
    waliKelas,
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

// Formulir Pengajuan Izin / Sakit Mandiri oleh Orang Tua Siswa
router.post('/leaves/submit', (req, res) => {
  uploadLetter.single('letter_attachment')(req, res, (err) => {
    const keyword = (req.body.keyword || '').trim();
    const redirectUrl = `/#cek-kehadiran?q=${encodeURIComponent(keyword)}`;

    if (err) {
      return res.redirect(`${redirectUrl}&leave_error=${encodeURIComponent(err.message)}`);
    }

    try {
      const { student_id, type, start_date, end_date, reason, parent_phone_last4 } = req.body;

      if (!student_id || !type || !start_date || !end_date || !reason || !parent_phone_last4) {
        return res.redirect(`${redirectUrl}&leave_error=${encodeURIComponent('Mohon lengkapi semua isian formulir pengajuan izin.')}`);
      }

      if (start_date > end_date) {
        return res.redirect(`${redirectUrl}&leave_error=${encodeURIComponent('Tanggal mulai tidak boleh lebih lambat dari tanggal selesai.')}`);
      }

      const student = db.prepare('SELECT * FROM students WHERE id = ? AND is_active = 1').get(student_id);
      if (!student) {
        return res.redirect(`${redirectUrl}&leave_error=${encodeURIComponent('Data siswa tidak ditemukan atau tidak aktif.')}`);
      }

      // Verifikasi Keamanan: Cocokkan 4 Digit Terakhir No. WhatsApp Orang Tua
      if (student.parent_phone && student.parent_phone.trim() !== '') {
        const cleanPhone = student.parent_phone.replace(/\D/g, '');
        const cleanInputLast4 = parent_phone_last4.replace(/\D/g, '');
        const actualLast4 = cleanPhone.slice(-4);

        if (cleanInputLast4.length !== 4 || actualLast4 !== cleanInputLast4) {
          return res.redirect(`${redirectUrl}&leave_error=${encodeURIComponent('Verifikasi gagal: 4 digit terakhir nomor WhatsApp orang tua tidak cocok dengan data siswa yang terdaftar.')}`);
        }
      }

      const attachmentPath = req.file ? `/uploads/letters/${req.file.filename}` : null;

      // Simpan Pengajuan Izin dengan Status PENDING
      const stmt = db.prepare(`
        INSERT INTO leave_requests (
          student_id, type, start_date, end_date, reason, attachment, parent_phone_last4, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')
      `);
      stmt.run(student.id, type, start_date, end_date, reason.trim(), attachmentPath, parent_phone_last4.trim());

      const successMsg = `Permohonan izin ${type === 'SAKIT' ? 'sakit' : 'izin'} untuk ananda ${student.name} berhasil diajukan dan sedang menunggu persetujuan Wali Kelas.`;
      res.redirect(`${redirectUrl}&leave_success=${encodeURIComponent(successMsg)}`);
    } catch (dbErr) {
      console.error('Error submit leave request:', dbErr);
      res.redirect(`${redirectUrl}&leave_error=${encodeURIComponent('Terjadi kesalahan saat memproses permohonan: ' + dbErr.message)}`);
    }
  });
});

module.exports = router;
