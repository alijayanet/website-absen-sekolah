const express = require('express');
const router = express.Router();
const XLSX = require('xlsx');
const db = require('../database/db');
const { isAuthenticated } = require('../middlewares/auth');
const queue = require('../services/queue');
const { generateTeacherSummary } = require('../services/summary');
const { getTodayWIB, getTimeSecondWIB, getTimeStringWIB, formatDateIndonesia } = require('../utils/timeHelper');

// 1. Tampilkan Daftar Kehadiran & Rekap
router.get('/dashboard/attendances', isAuthenticated, (req, res) => {
  const user = req.session.user;
  const today = getTodayWIB();
  const date = req.query.date || today;
  const classId = (user.role === 'guru' && user.class_id) ? user.class_id : (req.query.class_id || '');
  const status = req.query.status || '';

  let query = `
    SELECT a.*, s.name as student_name, s.nis, s.nisn, s.photo, c.name as class_name,
           s.parent_name, s.parent_phone, s.wa_status
    FROM attendances a
    JOIN students s ON a.student_id = s.id
    LEFT JOIN classes c ON s.class_id = c.id
    WHERE a.date = ?
  `;
  const params = [date];

  if (classId) {
    query += ` AND s.class_id = ? `;
    params.push(classId);
  }

  if (status) {
    query += ` AND a.status = ? `;
    params.push(status);
  }

  query += ` ORDER BY a.time_in DESC, s.name ASC `;

  const attendances = db.prepare(query).all(...params);

  // Ambil data siswa yang BELUM hadir pada tanggal ini
  let absentQuery = `
    SELECT s.*, c.name as class_name
    FROM students s
    LEFT JOIN classes c ON s.class_id = c.id
    WHERE s.is_active = 1 
      AND s.id NOT IN (SELECT student_id FROM attendances WHERE date = ?)
  `;
  const absentParams = [date];
  if (classId) {
    absentQuery += ` AND s.class_id = ? `;
    absentParams.push(classId);
  }
  absentQuery += ` ORDER BY c.name ASC, s.name ASC `;
  const absentStudents = db.prepare(absentQuery).all(...absentParams);

  const classes = (user.role === 'guru' && user.class_id)
    ? db.prepare('SELECT * FROM classes WHERE id = ?').all(user.class_id)
    : db.prepare('SELECT * FROM classes ORDER BY name ASC').all();

  let allStudentsQuery = `
    SELECT s.id, s.name, s.nis, c.name as class_name 
    FROM students s 
    LEFT JOIN classes c ON s.class_id = c.id 
    WHERE s.is_active = 1
  `;
  const allStudentsParams = [];
  if (user.role === 'guru') {
    if (user.class_id) {
      allStudentsQuery += ` AND s.class_id = ? `;
      allStudentsParams.push(user.class_id);
    } else {
      allStudentsQuery += ` AND 1 = 0 `;
    }
  }
  allStudentsQuery += ` ORDER BY c.name ASC, s.name ASC `;
  const allStudents = db.prepare(allStudentsQuery).all(...allStudentsParams);

  res.render('dashboard/attendances', {
    attendances,
    absentStudents,
    classes,
    allStudents,
    filters: { date, classId: user.role === 'guru' ? (user.class_id || '') : classId, status },
    successMsg: req.query.success || null,
    errorMsg: req.query.error || (!user.class_id && user.role === 'guru' ? 'Akun Anda belum memiliki kelas binaan.' : null)
  });
});

// 2. Input Manual Kehadiran (Izin / Sakit / Hadir Manual)
router.post('/dashboard/attendances/manual', isAuthenticated, (req, res) => {
  try {
    const user = req.session.user;
    const { student_id, date, status, notes } = req.body;

    if (!student_id || !date || !status) {
      return res.redirect('/dashboard/attendances?error=Siswa, Tanggal, dan Status wajib dipilih');
    }

    const student = db.prepare('SELECT id, class_id FROM students WHERE id = ?').get(student_id);
    if (!student) {
      return res.redirect('/dashboard/attendances?error=Siswa tidak ditemukan');
    }

    if (user.role === 'guru' && user.class_id && student.class_id !== user.class_id) {
      return res.redirect('/dashboard/attendances?error=Anda hanya berhak menginput absensi siswa di kelas binaan Anda');
    }

    const timeIn = getTimeSecondWIB(); // HH:MM:SS dalam WIB
    const creator = req.session.user.name || 'GURU/ADMIN';

    // Insert or Replace jika sudah ada
    const stmt = db.prepare(`
      INSERT INTO attendances (student_id, date, time_in, status, late_minutes, notes, created_by)
      VALUES (?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(student_id, date) DO UPDATE SET
        status = excluded.status,
        notes = excluded.notes,
        created_by = excluded.created_by
    `);

    stmt.run(student_id, date, timeIn, status, notes ? notes.trim() : null, creator);

    res.redirect(`/dashboard/attendances?date=${date}&success=Absensi manual berhasil dicatat.`);
  } catch (err) {
    console.error('Error manual attendance:', err);
    res.redirect(`/dashboard/attendances?error=${encodeURIComponent(err.message)}`);
  }
});

// 3. Hapus Catatan Absensi
router.post('/dashboard/attendances/:id/delete', isAuthenticated, (req, res) => {
  try {
    const user = req.session.user;
    const { id } = req.params;

    const record = db.prepare(`
      SELECT a.date, s.class_id 
      FROM attendances a 
      JOIN students s ON a.student_id = s.id 
      WHERE a.id = ?
    `).get(id);

    if (!record) {
      return res.redirect('/dashboard/attendances?error=Catatan absensi tidak ditemukan');
    }

    if (user.role === 'guru' && user.class_id && record.class_id !== user.class_id) {
      return res.redirect('/dashboard/attendances?error=Anda hanya berhak menghapus absensi siswa di kelas binaan Anda');
    }

    db.prepare('DELETE FROM attendances WHERE id = ?').run(id);
    res.redirect(`/dashboard/attendances?date=${record.date}&success=Catatan absensi berhasil dihapus.`);
  } catch (err) {
    res.redirect(`/dashboard/attendances?error=${encodeURIComponent(err.message)}`);
  }
});

// 4. Broadcast Notifikasi Belum Hadir (Alpa) ke Nomor Wali Murid
router.post('/dashboard/attendances/broadcast-alpa', isAuthenticated, (req, res) => {
  try {
    const user = req.session.user;
    const { date } = req.body;
    const targetDate = date || getTodayWIB();
    let targetClassId = (user.role === 'guru' && user.class_id) ? user.class_id : req.body.class_id;

    if (user.role === 'guru' && !user.class_id) {
      return res.json({ success: false, message: 'Akun Anda belum memiliki kelas binaan.' });
    }

    // Siswa aktif yang belum punya catatan absen pada tanggal ini dan memiliki nomor HP wali
    let query = `
      SELECT s.*, c.name as class_name
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE s.is_active = 1 
        AND s.parent_phone IS NOT NULL AND s.parent_phone != ''
        AND s.id NOT IN (SELECT student_id FROM attendances WHERE date = ?)
    `;
    const params = [targetDate];

    if (targetClassId) {
      query += ` AND s.class_id = ? `;
      params.push(targetClassId);
    }

    const targetStudents = db.prepare(query).all(...params);

    if (targetStudents.length === 0) {
      return res.json({
        success: false,
        message: 'Tidak ada siswa yang belum hadir atau tidak ada nomor HP wali yang tersedia.'
      });
    }

    const templateSetting = db.prepare("SELECT value FROM settings WHERE key = 'wa_template_alpa'").get()?.value;
    const schoolNameSetting = db.prepare("SELECT value FROM settings WHERE key = 'school_name'").get()?.value || 'Sekolah';

    const timeNow = getTimeStringWIB();                  // HH:MM dalam WIB
    const indoDate = formatDateIndonesia(targetDate);     // format bahasa Indonesia

    let queuedCount = 0;

    for (const s of targetStudents) {
      const message = (templateSetting || '')
        .replace(/{nama_siswa}/g, s.name)
        .replace(/{kelas}/g, s.class_name || '-')
        .replace(/{tanggal}/g, indoDate)
        .replace(/{jam}/g, timeNow)
        .replace(/{nama_sekolah}/g, schoolNameSetting);

      queue.enqueue({
        studentId: s.id,
        phone: s.parent_phone,
        message,
        type: 'ALPA'
      });
      queuedCount++;
    }

    res.json({
      success: true,
      count: queuedCount,
      message: `${queuedCount} notifikasi pemberitahuan belum hadir telah dimasukkan ke antrean WhatsApp.`
    });

  } catch (err) {
    console.error('Error broadcast alpa:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 5. Export Laporan Kehadiran ke Excel (.xlsx)
router.get('/dashboard/attendances/export/excel', isAuthenticated, (req, res) => {
  try {
    const user = req.session.user;
    const { date, status } = req.query;
    const targetDate = date || getTodayWIB();
    let targetClassId = (user.role === 'guru' && user.class_id) ? user.class_id : req.query.class_id;

    let query = `
      SELECT a.date, a.time_in, a.status, a.late_minutes, a.notes, a.created_by,
             s.nis, s.nisn, s.name as student_name, c.name as class_name, s.parent_phone
      FROM attendances a
      JOIN students s ON a.student_id = s.id
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE a.date = ?
    `;
    const params = [targetDate];

    if (user.role === 'guru') {
      if (!user.class_id) {
        query += ` AND 1 = 0 `;
      } else {
        query += ` AND s.class_id = ? `;
        params.push(user.class_id);
      }
    } else if (targetClassId) {
      query += ` AND s.class_id = ? `;
      params.push(targetClassId);
    }
    if (status) {
      query += ` AND a.status = ? `;
      params.push(status);
    }

    query += ` ORDER BY a.time_in ASC, s.name ASC `;

    const records = db.prepare(query).all(...params);

    const worksheet = XLSX.utils.json_to_sheet(records.map(r => ({
      'Tanggal': r.date,
      'Jam Masuk': r.time_in,
      'Status': r.status,
      'Keterlambatan (Menit)': r.late_minutes || 0,
      'Catatan': r.notes || '',
      'NIS': r.nis,
      'NISN': r.nisn || '',
      'Nama Siswa': r.student_name,
      'Kelas': r.class_name || '',
      'No WA Wali': r.parent_phone || '',
      'Dicatat Oleh': r.created_by
    })));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Laporan Kehadiran');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', `attachment; filename=Rekap_Absensi_${targetDate}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    console.error('Error export attendance excel:', err);
    res.redirect('/dashboard/attendances?error=Gagal mengekspor laporan absensi.');
  }
});

// 6. Preview Rekap Urutan Presensi Siswa untuk WhatsApp Guru
router.get('/dashboard/attendances/teacher-summary-preview', isAuthenticated, (req, res) => {
  try {
    const user = req.session.user;
    const today = getTodayWIB();
    const date = req.query.date || today;
    let classId = req.query.class_id;

    // Jika guru, batasi hanya untuk kelas binaannya
    if (user.role === 'guru') {
      if (!user.class_id) {
        return res.status(400).json({ success: false, message: 'Akun Anda belum memiliki kelas binaan.' });
      }
      classId = user.class_id;
    }

    if (!classId) {
      // Ambil kelas pertama jika admin tidak memilih kelas
      const firstClass = db.prepare('SELECT id FROM classes ORDER BY name ASC LIMIT 1').get();
      if (!firstClass) {
        return res.status(400).json({ success: false, message: 'Belum ada data kelas.' });
      }
      classId = firstClass.id;
    }

    const summary = generateTeacherSummary(classId, date);
    res.json(summary);
  } catch (err) {
    console.error('Error preview teacher summary:', err);
    res.status(500).json({ success: false, message: 'Gagal memuat pratinjau rekap: ' + err.message });
  }
});

// 7. Kirim Rekap Urutan Presensi ke WhatsApp Guru
router.post('/dashboard/attendances/send-teacher-summary', isAuthenticated, (req, res) => {
  try {
    const { phone, message, class_name } = req.body;

    if (!phone || !phone.trim()) {
      return res.status(400).json({ success: false, message: 'Nomor WhatsApp tujuan wajib diisi.' });
    }

    if (!message || !message.trim()) {
      return res.status(400).json({ success: false, message: 'Pesan rekap tidak boleh kosong.' });
    }

    const queueId = queue.enqueue({
      phone: phone.trim(),
      message: message.trim(),
      type: 'TEACHER_SUMMARY'
    });

    res.json({
      success: true,
      queueId,
      message: `Rekap urutan absensi ${class_name ? 'kelas ' + class_name : ''} berhasil dimasukkan ke antrean WhatsApp untuk nomor ${phone.trim()}!`
    });
  } catch (err) {
    console.error('Error send teacher summary:', err);
    res.status(500).json({ success: false, message: 'Gagal mengirim rekap: ' + err.message });
  }
});

module.exports = router;
