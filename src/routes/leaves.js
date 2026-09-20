const express = require('express');
const router = express.Router();
const db = require('../database/db');
const queue = require('../services/queue');
const { isAuthenticated } = require('../middlewares/auth');

// 1. Tampilkan Daftar Pengajuan Izin / Sakit Siswa
router.get('/dashboard/leaves', isAuthenticated, (req, res) => {
  try {
    const user = req.session.user;
    const statusFilter = (req.query.status || 'ALL').toUpperCase();
    const classFilter = req.query.class_id || '';
    const search = (req.query.search || '').trim();

    let query = `
      SELECT lr.*, 
             s.name as student_name, s.nis, s.nisn, s.parent_name, s.parent_phone, s.photo as student_photo,
             c.name as class_name, c.id as class_id,
             u.name as reviewer_name
      FROM leave_requests lr
      JOIN students s ON lr.student_id = s.id
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN users u ON lr.reviewed_by = u.id
      WHERE 1 = 1
    `;
    const params = [];

    // Filter akses berdasarkan peran: Guru hanya melihat siswa di kelas binaannya
    if (user.role === 'guru') {
      if (!user.class_id) {
        query += ` AND 1 = 0 `;
      } else {
        query += ` AND s.class_id = ? `;
        params.push(user.class_id);
      }
    } else if (classFilter) {
      query += ` AND s.class_id = ? `;
      params.push(classFilter);
    }

    if (statusFilter && statusFilter !== 'ALL') {
      query += ` AND lr.status = ? `;
      params.push(statusFilter);
    }

    if (search) {
      query += ` AND (s.name LIKE ? OR s.nis LIKE ? OR lr.reason LIKE ?) `;
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    query += ` ORDER BY CASE WHEN lr.status = 'PENDING' THEN 1 ELSE 2 END, lr.created_at DESC `;

    const leaves = db.prepare(query).all(...params);

    // Hitung ringkasan jumlah status untuk tab filter
    let statsQuery = `
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN lr.status = 'PENDING' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN lr.status = 'APPROVED' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN lr.status = 'REJECTED' THEN 1 ELSE 0 END) as rejected
      FROM leave_requests lr
      JOIN students s ON lr.student_id = s.id
      WHERE 1 = 1
    `;
    const statsParams = [];
    if (user.role === 'guru' && user.class_id) {
      statsQuery += ` AND s.class_id = ? `;
      statsParams.push(user.class_id);
    }
    const stats = db.prepare(statsQuery).get(...statsParams) || { total: 0, pending: 0, approved: 0, rejected: 0 };

    // Daftar kelas untuk filter admin
    const classes = db.prepare('SELECT id, name FROM classes ORDER BY name ASC').all();

    res.render('dashboard/leaves', {
      leaves,
      stats,
      classes,
      statusFilter,
      classFilter,
      search,
      successMsg: req.query.success || null,
      errorMsg: req.query.error || null
    });
  } catch (err) {
    console.error('Error load leaves dashboard:', err);
    res.status(500).send('Terjadi kesalahan saat memuat data pengajuan izin: ' + err.message);
  }
});

// 2. Setujui Pengajuan Izin Siswa (Approve)
router.post('/dashboard/leaves/:id/approve', isAuthenticated, (req, res) => {
  try {
    const user = req.session.user;
    const leaveId = req.params.id;

    const leave = db.prepare(`
      SELECT lr.*, s.name as student_name, s.class_id, s.parent_phone, c.name as class_name
      FROM leave_requests lr
      JOIN students s ON lr.student_id = s.id
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE lr.id = ?
    `).get(leaveId);

    if (!leave) {
      return res.redirect('/dashboard/leaves?error=Data pengajuan izin tidak ditemukan.');
    }

    if (user.role === 'guru' && user.class_id && leave.class_id !== user.class_id) {
      return res.redirect('/dashboard/leaves?error=Anda hanya berhak menyetujui izin siswa di kelas binaan Anda.');
    }

    // 1. Update status permohonan menjadi APPROVED
    const updateStmt = db.prepare(`
      UPDATE leave_requests 
      SET status = 'APPROVED', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, rejection_note = NULL
      WHERE id = ?
    `);
    updateStmt.run(user.id, leaveId);

    // 2. Sinkronisasi ke tabel Presensi (attendances) untuk seluruh tanggal dalam rentang izin
    const curDate = new Date(leave.start_date + 'T00:00:00');
    const stopDate = new Date(leave.end_date + 'T00:00:00');
    const reviewerName = user.name || 'Wali Kelas';
    const note = `Izin Mandiri (${leave.type === 'SAKIT' ? 'Sakit' : 'Izin'}) disetujui ${reviewerName}: ${leave.reason}`;

    const upsertAttendance = db.prepare(`
      INSERT INTO attendances (student_id, date, time_in, status, notes, created_by)
      VALUES (?, ?, '07:00:00', ?, ?, ?)
      ON CONFLICT(student_id, date) DO UPDATE SET
        status = excluded.status,
        notes = excluded.notes,
        time_in = excluded.time_in,
        created_by = excluded.created_by
    `);

    while (curDate <= stopDate) {
      const dateStr = curDate.toLocaleDateString('en-CA');
      upsertAttendance.run(leave.student_id, dateStr, leave.type, note, reviewerName);
      curDate.setDate(curDate.getDate() + 1);
    }

    // 3. Masukkan notifikasi WhatsApp otomatis ke antrean untuk orang tua murid
    const schoolName = db.prepare("SELECT value FROM settings WHERE key = 'school_name'").get()?.value || 'Sekolah';
    const dateDesc = leave.start_date === leave.end_date ? leave.start_date : `${leave.start_date} s/d ${leave.end_date}`;
    const typeDesc = leave.type === 'SAKIT' ? 'Sakit' : 'Izin';

    if (leave.parent_phone && leave.parent_phone.trim() !== '') {
      const message = `Assalamu’alaikum Wr. Wb.
Yth. Bapak/Ibu Wali Murid dari *${leave.student_name}* (Kelas ${leave.class_name || '-'}),

Diberitahukan bahwa permohonan *${typeDesc}* untuk ananda pada tanggal:
📅 *${dateDesc}*
📝 Alasan: _${leave.reason}_

Telah *DISETUJUI* oleh Wali Kelas (*${reviewerName}*).
Status absensi siswa telah resmi diperbarui menjadi *${leave.type}*. Semoga ananda lekas pulih/kegiatan berjalan lancar.

Terima kasih atas kerja samanya.
_Sistem Absensi ${schoolName}_`;

      queue.enqueue({
        studentId: leave.student_id,
        phone: leave.parent_phone.trim(),
        message,
        type: 'LEAVE_APPROVAL'
      });
    }

    res.redirect('/dashboard/leaves?success=Permohonan izin berhasil disetujui dan catatan presensi siswa telah otomatis diperbarui.');
  } catch (err) {
    console.error('Error approve leave:', err);
    res.redirect(`/dashboard/leaves?error=${encodeURIComponent('Gagal menyetujui izin: ' + err.message)}`);
  }
});

// 3. Tolak Pengajuan Izin Siswa (Reject)
router.post('/dashboard/leaves/:id/reject', isAuthenticated, (req, res) => {
  try {
    const user = req.session.user;
    const leaveId = req.params.id;
    const rejectionNote = (req.body.rejection_note || '').trim() || 'Tidak memenuhi ketentuan / surat bukti tidak sesuai';

    const leave = db.prepare(`
      SELECT lr.*, s.name as student_name, s.class_id, s.parent_phone, c.name as class_name
      FROM leave_requests lr
      JOIN students s ON lr.student_id = s.id
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE lr.id = ?
    `).get(leaveId);

    if (!leave) {
      return res.redirect('/dashboard/leaves?error=Data pengajuan izin tidak ditemukan.');
    }

    if (user.role === 'guru' && user.class_id && leave.class_id !== user.class_id) {
      return res.redirect('/dashboard/leaves?error=Anda hanya berhak menolak izin siswa di kelas binaan Anda.');
    }

    // Update status permohonan menjadi REJECTED
    const updateStmt = db.prepare(`
      UPDATE leave_requests 
      SET status = 'REJECTED', rejection_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    updateStmt.run(rejectionNote, user.id, leaveId);

    // Kirim notifikasi penolakan ke WhatsApp orang tua
    const schoolName = db.prepare("SELECT value FROM settings WHERE key = 'school_name'").get()?.value || 'Sekolah';
    const dateDesc = leave.start_date === leave.end_date ? leave.start_date : `${leave.start_date} s/d ${leave.end_date}`;
    const typeDesc = leave.type === 'SAKIT' ? 'Sakit' : 'Izin';
    const reviewerName = user.name || 'Wali Kelas';

    if (leave.parent_phone && leave.parent_phone.trim() !== '') {
      const message = `Assalamu’alaikum Wr. Wb.
Yth. Bapak/Ibu Wali Murid dari *${leave.student_name}* (Kelas ${leave.class_name || '-'}),

Mohon maaf, permohonan *${typeDesc}* untuk ananda pada tanggal *${dateDesc}* belum dapat disetujui oleh Wali Kelas (*${reviewerName}*).
⚠️ Alasan Penolakan: _${rejectionNote}_

Silakan hubungi Wali Kelas secara langsung untuk informasi lebih lanjut.
_Sistem Absensi ${schoolName}_`;

      queue.enqueue({
        studentId: leave.student_id,
        phone: leave.parent_phone.trim(),
        message,
        type: 'LEAVE_APPROVAL'
      });
    }

    res.redirect('/dashboard/leaves?success=Permohonan izin telah ditolak.');
  } catch (err) {
    console.error('Error reject leave:', err);
    res.redirect(`/dashboard/leaves?error=${encodeURIComponent('Gagal menolak izin: ' + err.message)}`);
  }
});

module.exports = router;
