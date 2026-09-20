/**
 * Absensi Sekolah - Savings Routes
 * src/routes/savings.js
 * 
 * Rute Dashboard untuk Tabungan Siswa:
 * - Guru: Kelola tabungan rombel yang diampu (Setoran, Penarikan, Buku Tabungan).
 * - Admin: Rekapitulasi total saldo yang dipegang setiap guru, grand total sekolah, dan detail per rombel.
 */

'use strict';

const express = require('express');
const router = express.Router();
const db = require('../database/db');
const savingsService = require('../services/savingsService');
const { requireAuth } = require('../middlewares/auth');

/**
 * GET /dashboard/savings
 * Halaman Utama Tabungan Siswa (Responsif terhadap role Guru & Admin)
 */
router.get('/dashboard/savings', requireAuth, (req, res) => {
  const user = req.session.user;
  const isGuru = user.role === 'guru';
  const isAdmin = user.role === 'admin';

  let selectedClassId = req.query.class_id ? parseInt(req.query.class_id, 10) : null;
  let classData = null;
  let teacherSummary = null;
  let schoolStats = null;
  let allTeachers = [];

  const classes = db.prepare('SELECT * FROM classes ORDER BY name ASC').all();

  if (isGuru) {
    // Guru otomatis melihat rombel yang diampunya
    const teacherClassId = user.class_id;
    if (teacherClassId) {
      classData = savingsService.getClassSavings(teacherClassId);
    }
  } else if (isAdmin) {
    // Admin melihat rekapitulasi seluruh guru & statistik global
    schoolStats = savingsService.getSchoolSavingsStats();
    teacherSummary = savingsService.getTeacherSavingsSummary();

    // Jika admin memilih salah satu kelas, muat detail kelas tersebut
    if (selectedClassId) {
      classData = savingsService.getClassSavings(selectedClassId);
    }
  }

  res.render('dashboard/savings/index', {
    pageTitle: 'Tabungan Siswa',
    currentPath: '/dashboard/savings',
    isGuru,
    isAdmin,
    classData,
    teacherSummary,
    schoolStats,
    classes,
    selectedClassId,
    formatRupiah: savingsService.formatRupiah,
    error: req.query.error,
    success: req.query.success
  });
});

/**
 * POST /dashboard/savings/deposit
 * Catat Transaksi Setor Tabungan
 */
router.post('/dashboard/savings/deposit', requireAuth, (req, res) => {
  const returnTo = req.body.return_to || '/dashboard/savings';
  try {
    const { student_id, amount, notes, transaction_date } = req.body;
    const studentId = parseInt(student_id, 10);
    const user = req.session.user;

    if (!studentId || !amount) {
      return res.redirect(`${returnTo}?error=${encodeURIComponent('Pilih siswa dan masukkan nominal setoran yang valid.')}`);
    }

    // Validasi hak akses: Hanya Guru / Wali Kelas yang berhak mencatat setoran tabungan
    if (user.role !== 'guru') {
      return res.redirect(`${returnTo}?error=${encodeURIComponent('Pencatatan setoran tabungan adalah wewenang & tanggung jawab Guru / Wali Kelas.')}`);
    }

    const student = db.prepare('SELECT class_id FROM students WHERE id = ?').get(studentId);
    if (!student || student.class_id !== user.class_id) {
      return res.redirect(`${returnTo}?error=${encodeURIComponent('Anda hanya berhak mencatat tabungan siswa di rombel kelas Anda.')}`);
    }

    const tx = savingsService.deposit({
      studentId,
      teacherId: user.id,
      amount,
      notes,
      transactionDate: transaction_date
    });

    // Kirim notifikasi WhatsApp otomatis ke orang tua jika ada nomor telepon
    try {
      if (tx.parent_phone) {
        const queueService = require('../services/queue');
        const schoolSetting = db.prepare("SELECT value FROM settings WHERE key = 'school_name'").get();
        const schoolName = schoolSetting?.value || 'Sekolah';

        const waMsg = `*NOTIFIKASI TABUNGAN SISWA*\n${schoolName}\n-------------------------------------------\n` +
          `Yth. Wali Murid dari ananda *${tx.student_name}*,\n\n` +
          `Telah diterima *SETORAN TABUNGAN*:\n` +
          `• Jumlah Setor: *${savingsService.formatRupiah(tx.amount)}*\n` +
          `• Saldo Sekarang: *${savingsService.formatRupiah(tx.balance_after)}*\n` +
          `• Tanggal: ${tx.transaction_date}\n` +
          `• Catatan: ${tx.notes || '-'}\n` +
          `• Dicatat oleh: ${tx.teacher_name || user.name} (Wali Kelas)\n\n` +
          `_Ketik *TABUNGAN* untuk memeriksa saldo lengkap ananda._`;

        queueService.enqueue({
          studentId: tx.student_id,
          phone: tx.parent_phone,
          message: waMsg,
          type: 'SAVINGS'
        });
      }
    } catch (waErr) {
      console.warn('[Savings] Gagal antrekan notif WA:', waErr.message);
    }

    return res.redirect(`${returnTo}?success=${encodeURIComponent(`Setoran sebesar ${savingsService.formatRupiah(tx.amount)} untuk ${tx.student_name} berhasil disimpan. Saldo baru: ${savingsService.formatRupiah(tx.balance_after)}.`)}`);
  } catch (err) {
    console.error('[Savings] Gagal setor tabungan:', err);
    return res.redirect(`${returnTo}?error=${encodeURIComponent(err.message)}`);
  }
});

/**
 * POST /dashboard/savings/withdraw
 * Catat Transaksi Penarikan Tabungan
 */
router.post('/dashboard/savings/withdraw', requireAuth, (req, res) => {
  const returnTo = req.body.return_to || '/dashboard/savings';
  try {
    const { student_id, amount, notes, transaction_date } = req.body;
    const studentId = parseInt(student_id, 10);
    const user = req.session.user;

    if (!studentId || !amount) {
      return res.redirect(`${returnTo}?error=${encodeURIComponent('Pilih siswa dan masukkan nominal penarikan yang valid.')}`);
    }

    // Validasi hak akses: Hanya Guru / Wali Kelas yang berhak mencatat penarikan tabungan
    if (user.role !== 'guru') {
      return res.redirect(`${returnTo}?error=${encodeURIComponent('Pencatatan penarikan tabungan adalah wewenang & tanggung jawab Guru / Wali Kelas.')}`);
    }

    const student = db.prepare('SELECT class_id FROM students WHERE id = ?').get(studentId);
    if (!student || student.class_id !== user.class_id) {
      return res.redirect(`${returnTo}?error=${encodeURIComponent('Anda hanya berhak mencatat tabungan siswa di rombel kelas Anda.')}`);
    }

    const tx = savingsService.withdraw({
      studentId,
      teacherId: user.id,
      amount,
      notes,
      transactionDate: transaction_date
    });

    // Kirim notifikasi WhatsApp otomatis ke orang tua jika ada nomor telepon
    try {
      if (tx.parent_phone) {
        const queueService = require('../services/queue');
        const schoolSetting = db.prepare("SELECT value FROM settings WHERE key = 'school_name'").get();
        const schoolName = schoolSetting?.value || 'Sekolah';

        const waMsg = `*NOTIFIKASI PENARIKAN TABUNGAN*\n${schoolName}\n-------------------------------------------\n` +
          `Yth. Wali Murid dari ananda *${tx.student_name}*,\n\n` +
          `Telah dilakukan *PENARIKAN TABUNGAN*:\n` +
          `• Jumlah Tarik: *${savingsService.formatRupiah(tx.amount)}*\n` +
          `• Sisa Saldo: *${savingsService.formatRupiah(tx.balance_after)}*\n` +
          `• Tanggal: ${tx.transaction_date}\n` +
          `• Keperluan: ${tx.notes || '-'}\n` +
          `• Dicatat oleh: ${tx.teacher_name || user.name} (Wali Kelas)\n\n` +
          `_Ketik *TABUNGAN* untuk memeriksa saldo ananda._`;

        queueService.enqueue({
          studentId: tx.student_id,
          phone: tx.parent_phone,
          message: waMsg,
          type: 'SAVINGS'
        });
      }
    } catch (waErr) {
      console.warn('[Savings] Gagal antrekan notif WA penarikan:', waErr.message);
    }

    return res.redirect(`${returnTo}?success=${encodeURIComponent(`Penarikan sebesar ${savingsService.formatRupiah(tx.amount)} untuk ${tx.student_name} berhasil disimpan. Sisa saldo: ${savingsService.formatRupiah(tx.balance_after)}.`)}`);
  } catch (err) {
    console.error('[Savings] Gagal tarik tabungan:', err);
    return res.redirect(`${returnTo}?error=${encodeURIComponent(err.message)}`);
  }
});

/**
 * GET /dashboard/savings/student/:id/history
 * Endpoint JSON untuk Riwayat Mutasi Buku Tabungan
 */
router.get('/dashboard/savings/student/:id/history', requireAuth, (req, res) => {
  try {
    const studentId = parseInt(req.params.id, 10);
    const data = savingsService.getStudentSavings(studentId);
    if (!data) {
      return res.status(404).json({ success: false, error: 'Siswa tidak ditemukan' });
    }

    // Jika guru, pastikan siswa adalah siswanya
    if (req.session.user.role === 'guru' && data.student.class_id !== req.session.user.class_id) {
      return res.status(403).json({ success: false, error: 'Akses ditolak ke kelas lain' });
    }

    return res.json({
      success: true,
      student: {
        id: data.student.id,
        name: data.student.name,
        nis: data.student.nis,
        className: data.student.class_name,
        balance: data.balance,
        formattedBalance: data.formattedBalance,
        parentName: data.student.parent_name
      },
      teacher: data.teacher,
      transactions: data.transactions.map(t => ({
        id: t.id,
        type: t.type,
        amount: t.amount,
        formattedAmount: savingsService.formatRupiah(t.amount),
        balanceAfter: t.balance_after,
        formattedBalanceAfter: savingsService.formatRupiah(t.balance_after),
        transactionDate: t.transaction_date,
        notes: t.notes,
        teacherName: t.teacher_name || 'Petugas'
      }))
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /dashboard/savings/student/:id/print
 * Cetak Lembar Buku Tabungan Siswa
 */
router.get('/dashboard/savings/student/:id/print', requireAuth, (req, res) => {
  try {
    const studentId = parseInt(req.params.id, 10);
    const data = savingsService.getStudentSavings(studentId);
    if (!data) return res.redirect('/dashboard/savings?error=Siswa tidak ditemukan');

    const settingsRows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const r of settingsRows) settings[r.key] = r.value;

    res.render('dashboard/savings/print', {
      pageTitle: `Buku Tabungan - ${data.student.name}`,
      student: data.student,
      balance: data.balance,
      formattedBalance: data.formattedBalance,
      teacher: data.teacher,
      transactions: data.transactions,
      settings,
      formatRupiah: savingsService.formatRupiah
    });
  } catch (err) {
    return res.redirect(`/dashboard/savings?error=${encodeURIComponent(err.message)}`);
  }
});

module.exports = router;
