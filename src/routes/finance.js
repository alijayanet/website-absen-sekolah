/**
 * Absensi Sekolah - Finance & Billing Dashboard Routes
 * src/routes/finance.js
 * 
 * Mengelola antarmuka dashboard untuk Keuangan Sekolah, Tagihan SPP,
 * Pembayaran Manual/Otomatis, Kuitansi, dan Pengaturan QRIS Statis.
 */

'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const config = require('../config');
const db = require('../database/db');
const financeService = require('../services/financeService');
const qrisUtil = require('../utils/qrisUtil');
const { requireAuth, requireAdmin } = require('../middlewares/auth');

// Konfigurasi Multer untuk Upload Gambar QRIS
const qrisStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.qrisPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `qris_static_${Date.now()}${ext}`);
  }
});

const uploadQris = multer({
  storage: qrisStorage,
  limits: { fileSize: 10 * 1024 * 1024 }, // Maksimal 10MB
  fileFilter: (req, file, cb) => {
    if (/image\/(jpeg|jpg|png|webp|svg\+xml)/.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Format file harus berupa gambar (JPG, PNG, WEBP).'));
    }
  }
});

/**
 * GET /dashboard/finance
 * Halaman Ringkasan Keuangan Sekolah
 */
router.get('/dashboard/finance', requireAuth, (req, res) => {
  const month = req.query.month || new Date().toISOString().slice(0, 7);
  const stats = financeService.getFinanceStats(month);

  const categories = db.prepare('SELECT * FROM fee_categories ORDER BY id ASC').all();

  res.render('dashboard/finance/index', {
    pageTitle: 'Ringkasan Keuangan & SPP',
    currentPath: '/dashboard/finance',
    stats,
    categories,
    selectedMonth: month,
    formatRupiah: financeService.formatRupiah
  });
});

/**
 * GET /dashboard/finance/bills
 * Daftar Tagihan Siswa & Kelola SPP
 */
router.get('/dashboard/finance/bills', requireAuth, (req, res) => {
  const { status, category_id, class_id, period, search } = req.query;

  let query = `
    SELECT b.*, s.name as student_name, s.nis, s.parent_name, s.parent_phone, 
           c.name as class_name, cat.name as category_name, cat.code as category_code
    FROM student_bills b
    JOIN students s ON b.student_id = s.id
    JOIN fee_categories cat ON b.category_id = cat.id
    LEFT JOIN classes c ON s.class_id = c.id
    WHERE 1=1
  `;
  const params = [];

  if (status && status !== 'all') {
    query += ' AND b.status = ?';
    params.push(status);
  }

  if (category_id && category_id !== 'all') {
    query += ' AND b.category_id = ?';
    params.push(category_id);
  }

  if (class_id && class_id !== 'all') {
    query += ' AND s.class_id = ?';
    params.push(class_id);
  }

  if (period) {
    query += ' AND b.period = ?';
    params.push(period);
  }

  if (search) {
    query += ' AND (s.name LIKE ? OR s.nis LIKE ? OR b.bill_code LIKE ?)';
    const kw = `%${search}%`;
    params.push(kw, kw, kw);
  }

  query += ' ORDER BY b.created_at DESC LIMIT 200';

  const bills = db.prepare(query).all(...params);
  const classes = db.prepare('SELECT * FROM classes ORDER BY name ASC').all();
  const categories = db.prepare('SELECT * FROM fee_categories ORDER BY id ASC').all();
  const students = db.prepare('SELECT s.id, s.name, s.nis, c.name as class_name FROM students s LEFT JOIN classes c ON s.class_id = c.id WHERE s.is_active = 1 ORDER BY s.name ASC').all();

  const currentPeriod = new Date().toISOString().slice(0, 7);

  res.render('dashboard/finance/bills', {
    pageTitle: 'Kelola Tagihan & SPP Siswa',
    currentPath: '/dashboard/finance/bills',
    bills,
    classes,
    categories,
    students,
    filters: { status, category_id, class_id, period, search },
    currentPeriod,
    formatRupiah: financeService.formatRupiah,
    error: req.query.error,
    success: req.query.success
  });
});

/**
 * POST /dashboard/finance/bills/generate-monthly
 * Buat Tagihan SPP Massal per Bulan
 */
router.post('/dashboard/finance/bills/generate-monthly', requireAuth, requireAdmin, (req, res) => {
  try {
    const { period, class_id, category_id, base_amount, due_date, notes, title } = req.body;

    const result = financeService.generateMonthlyBills({
      period,
      classId: class_id,
      categoryId: parseInt(category_id, 10),
      baseAmount: parseInt(base_amount, 10),
      dueDate: due_date,
      notes,
      title
    });

    const displayPeriod = result.readable_period || result.period;
    return res.redirect(`/dashboard/finance/bills?success=Berhasil membuat ${result.created_count} tagihan untuk periode ${displayPeriod} (${result.skipped_count} dilewati karena sudah ada).`);
  } catch (err) {
    console.error('[Finance] Gagal generate tagihan rutin:', err);
    return res.redirect(`/dashboard/finance/bills?error=${encodeURIComponent(err.message)}`);
  }
});

/**
 * POST /dashboard/finance/bills/create-single
 * Buat Tagihan Individual (Custom)
 */
router.post('/dashboard/finance/bills/create-single', requireAuth, requireAdmin, (req, res) => {
  try {
    const { student_id, category_id, title, period, base_amount, due_date, notes } = req.body;

    financeService.createBill({
      studentId: parseInt(student_id, 10),
      categoryId: parseInt(category_id, 10),
      title,
      period: period || null,
      baseAmount: parseInt(base_amount, 10),
      dueDate: due_date,
      notes
    });

    return res.redirect('/dashboard/finance/bills?success=Tagihan baru berhasil diterbitkan.');
  } catch (err) {
    console.error('[Finance] Gagal membuat tagihan satuan:', err);
    return res.redirect(`/dashboard/finance/bills?error=${encodeURIComponent(err.message)}`);
  }
});

/**
 * POST /dashboard/finance/bills/:id/update
 * Edit Tagihan (Nominal, Judul, Jatuh Tempo)
 */
router.post('/dashboard/finance/bills/:id/update', requireAuth, requireAdmin, (req, res) => {
  try {
    const billId = parseInt(req.params.id, 10);
    const { title, base_amount, due_date, notes } = req.body;

    const bill = db.prepare('SELECT * FROM student_bills WHERE id = ?').get(billId);
    if (!bill) return res.redirect('/dashboard/finance/bills?error=Tagihan tidak ditemukan');
    if (bill.status === 'PAID') return res.redirect('/dashboard/finance/bills?error=Tagihan yang sudah lunas tidak dapat diubah');

    const newBase = parseInt(base_amount, 10) || bill.base_amount;
    const newTotal = newBase + (bill.unique_code || 0);

    db.prepare(`
      UPDATE student_bills 
      SET title = ?, base_amount = ?, total_amount = ?, due_date = ?, notes = ?
      WHERE id = ?
    `).run(
      title || bill.title,
      newBase,
      newTotal,
      due_date || null,
      notes || null,
      billId
    );

    return res.redirect('/dashboard/finance/bills?success=Data tagihan berhasil diperbarui.');
  } catch (err) {
    return res.redirect(`/dashboard/finance/bills?error=${encodeURIComponent(err.message)}`);
  }
});

/**
 * POST /dashboard/finance/bills/:id/pay-cash
 * Bayar Tagihan Tunai Langsung di Kasir TU
 */
router.post('/dashboard/finance/bills/:id/pay-cash', requireAuth, (req, res) => {
  try {
    const billId = parseInt(req.params.id, 10);
    const { reference_note } = req.body;
    const cashierName = req.session.user ? req.session.user.name : 'Kasir TU';

    const result = financeService.payBill(billId, {
      paymentMethod: 'CASH',
      paymentChannel: 'Kasir TU Sekolah',
      referenceNote: reference_note || 'Pembayaran Tunai Langsung di Kasir TU',
      receivedBy: cashierName
    });

    return res.redirect(`/dashboard/finance/bills?success=Pembayaran berhasil dicatat. Kuitansi: ${result.receipt_no}`);
  } catch (err) {
    return res.redirect(`/dashboard/finance/bills?error=${encodeURIComponent(err.message)}`);
  }
});

/**
 * POST /dashboard/finance/bills/:id/cancel
 * Batalkan Tagihan
 */
router.post('/dashboard/finance/bills/:id/cancel', requireAuth, requireAdmin, (req, res) => {
  try {
    const billId = parseInt(req.params.id, 10);
    const bill = db.prepare('SELECT * FROM student_bills WHERE id = ?').get(billId);
    if (!bill) return res.redirect('/dashboard/finance/bills?error=Tagihan tidak ditemukan');
    if (bill.status === 'PAID') return res.redirect('/dashboard/finance/bills?error=Tagihan yang sudah lunas tidak dapat dibatalkan');

    db.prepare("UPDATE student_bills SET status = 'CANCELLED' WHERE id = ?").run(billId);
    return res.redirect('/dashboard/finance/bills?success=Tagihan berhasil dibatalkan.');
  } catch (err) {
    return res.redirect(`/dashboard/finance/bills?error=${encodeURIComponent(err.message)}`);
  }
});

/**
 * GET /dashboard/finance/bills/:id/qris-json
 * Dapatkan Payload & Data URL QRIS Dinamis untuk Modal Preview
 */
router.get('/dashboard/finance/bills/:id/qris-json', requireAuth, async (req, res) => {
  try {
    const billId = parseInt(req.params.id, 10);
    const qrisData = await financeService.getDynamicQrisForBill(billId);
    return res.json({ success: true, ...qrisData });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /dashboard/finance/bills/:id/receipt
 * Cetak Kuitansi Pembayaran Resmi
 */
router.get('/dashboard/finance/bills/:id/receipt', requireAuth, (req, res) => {
  const billId = parseInt(req.params.id, 10);
  const bill = db.prepare(`
    SELECT b.*, s.name as student_name, s.nis, s.nisn, s.parent_name, s.parent_phone,
           c.name as class_name, cat.name as category_name
    FROM student_bills b
    JOIN students s ON b.student_id = s.id
    JOIN fee_categories cat ON b.category_id = cat.id
    LEFT JOIN classes c ON s.class_id = c.id
    WHERE b.id = ?
  `).get(billId);

  if (!bill) return res.status(404).send('Tagihan tidak ditemukan');

  const receipt = db.prepare('SELECT * FROM payment_receipts WHERE bill_id = ? ORDER BY id DESC LIMIT 1').get(billId);
  const settingsRows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const s of settingsRows) settings[s.key] = s.value;

  res.render('dashboard/finance/receipt-print', {
    bill,
    receipt,
    settings,
    formatRupiah: financeService.formatRupiah
  });
});

/**
 * GET /dashboard/finance/qris
 * Pengaturan QRIS Statis Sekolah & Live Converter Tester
 */
router.get('/dashboard/finance/qris', requireAuth, requireAdmin, (req, res) => {
  const staticPayload = financeService.getSetting('qris_static_payload', '');
  const merchantName = financeService.getSetting('qris_merchant_name', 'SMK Teladan Jakarta');
  const qrisEnabled = financeService.getSetting('qris_static_enabled', '1');
  const webhookSecret = financeService.getSetting('payment_gateway_secret', 'absensi-sekolah-gateway-secret');
  const qrisImagePath = financeService.getSetting('qris_image_path', '');

  // Ambil 10 log webhook terakhir
  const logs = db.prepare('SELECT * FROM webhook_logs ORDER BY created_at DESC LIMIT 10').all();

  res.render('dashboard/finance/qris', {
    pageTitle: 'Pengaturan QRIS Statis & Gateway',
    currentPath: '/dashboard/finance/qris',
    staticPayload,
    merchantName,
    qrisEnabled,
    webhookSecret,
    qrisImagePath,
    logs,
    error: req.query.error,
    success: req.query.success
  });
});

/**
 * POST /dashboard/finance/qris/upload
 * Endpoint Upload File Gambar QRIS Statis & Penyimpanan
 */
router.post('/dashboard/finance/qris/upload', requireAuth, requireAdmin, uploadQris.single('qris_image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: 'Tidak ada file gambar yang diunggah' });
    }

    const publicPath = `/uploads/qris/${req.file.filename}`;

    const upsertSetting = db.prepare(`
      INSERT INTO settings (key, value) VALUES ('qris_image_path', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);
    upsertSetting.run(publicPath);

    return res.json({
      success: true,
      filePath: publicPath,
      message: 'Gambar QRIS berhasil disimpan'
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /dashboard/finance/qris/save
 * Simpan Pengaturan QRIS Statis
 */
router.post('/dashboard/finance/qris/save', requireAuth, requireAdmin, (req, res) => {
  try {
    const { qris_static_payload, qris_merchant_name, qris_static_enabled, payment_gateway_secret, qris_image_path } = req.body;

    const upsertSetting = db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    upsertSetting.run('qris_static_payload', (qris_static_payload || '').trim());
    upsertSetting.run('qris_merchant_name', (qris_merchant_name || '').trim());
    upsertSetting.run('qris_static_enabled', qris_static_enabled ? '1' : '0');
    upsertSetting.run('payment_gateway_secret', (payment_gateway_secret || '').trim());
    if (qris_image_path !== undefined) {
      upsertSetting.run('qris_image_path', (qris_image_path || '').trim());
    }

    return res.redirect('/dashboard/finance/qris?success=Pengaturan QRIS & Gateway berhasil disimpan.');
  } catch (err) {
    return res.redirect(`/dashboard/finance/qris?error=${encodeURIComponent(err.message)}`);
  }
});

/**
 * POST /dashboard/finance/qris/test-convert
 * API Tester: Tes konversi payload statis ke dinamis
 */
router.post('/dashboard/finance/qris/test-convert', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { payload, amount } = req.body;
    const staticString = (payload || financeService.getSetting('qris_static_payload', '')).trim();

    if (!staticString) {
      return res.status(400).json({ success: false, error: 'Payload QRIS Statis kosong' });
    }

    const { dynamicPayload, dataUrl } = await qrisUtil.generateDynamicQrisDataUrl(
      staticString,
      parseInt(amount, 10) || 50123
    );

    const tags = qrisUtil.parseEmvTlvString(dynamicPayload);

    return res.json({
      success: true,
      dynamicPayload,
      dataUrl,
      tags
    });
  } catch (err) {
    return res.status(400).json({ success: false, error: err.message });
  }
});

/**
 * GET /dashboard/finance/categories/json
 * API JSON: Ambil daftar seluruh kategori biaya
 */
router.get('/dashboard/finance/categories/json', requireAuth, (req, res) => {
  try {
    const categories = db.prepare('SELECT * FROM fee_categories ORDER BY id ASC').all();
    return res.json({ success: true, data: categories });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /dashboard/finance/categories/save
 * Tambah / Edit Kategori Tagihan
 */
router.post('/dashboard/finance/categories/save', requireAuth, requireAdmin, (req, res) => {
  const returnTo = req.body.return_to || '/dashboard/finance/bills';
  try {
    const { id, code, name, default_amount, frequency, is_monthly } = req.body;
    const cleanCode = (code || '').toUpperCase().replace(/[^A-Z0-9_]/g, '').trim();
    const cleanName = (name || '').trim();

    if (!cleanCode || !cleanName) {
      return res.redirect(`${returnTo}?error=${encodeURIComponent('Kode dan nama kategori tagihan wajib diisi.')}`);
    }

    // Tentukan frekuensi: 'MONTHLY', 'WEEKLY', atau 'ONCE'
    let freq = 'ONCE';
    if (frequency === 'MONTHLY' || frequency === 'WEEKLY' || frequency === 'ONCE') {
      freq = frequency;
    } else if (Number(is_monthly) === 1) {
      freq = 'MONTHLY';
    } else if (Number(is_monthly) === 2) {
      freq = 'WEEKLY';
    }

    const isMonthlyVal = freq === 'MONTHLY' ? 1 : (freq === 'WEEKLY' ? 2 : 0);

    if (id) {
      db.prepare(`
        UPDATE fee_categories 
        SET code = ?, name = ?, default_amount = ?, frequency = ?, is_monthly = ?
        WHERE id = ?
      `).run(cleanCode, cleanName, parseInt(default_amount, 10) || 0, freq, isMonthlyVal, id);
    } else {
      // Cek apakah kode sudah ada
      const existing = db.prepare('SELECT id FROM fee_categories WHERE code = ?').get(cleanCode);
      if (existing) {
        return res.redirect(`${returnTo}?error=${encodeURIComponent(`Kode kategori "${cleanCode}" sudah digunakan. Gunakan kode lain.`)}`);
      }

      db.prepare(`
        INSERT INTO fee_categories (code, name, default_amount, frequency, is_monthly)
        VALUES (?, ?, ?, ?, ?)
      `).run(cleanCode, cleanName, parseInt(default_amount, 10) || 0, freq, isMonthlyVal);
    }

    return res.redirect(`${returnTo}?success=${encodeURIComponent(`Kategori biaya "${cleanName}" berhasil disimpan.`)}`);
  } catch (err) {
    return res.redirect(`${returnTo}?error=${encodeURIComponent(err.message)}`);
  }
});

/**
 * POST /dashboard/finance/categories/:id/delete
 * Hapus Kategori Tagihan
 */
router.post('/dashboard/finance/categories/:id/delete', requireAuth, requireAdmin, (req, res) => {
  const returnTo = req.body.return_to || '/dashboard/finance/bills';
  try {
    const catId = parseInt(req.params.id, 10);
    const category = db.prepare('SELECT * FROM fee_categories WHERE id = ?').get(catId);
    if (!category) {
      return res.redirect(`${returnTo}?error=${encodeURIComponent('Kategori biaya tidak ditemukan.')}`);
    }

    // Periksa apakah kategori ini sedang digunakan oleh data tagihan
    const billCountRow = db.prepare('SELECT COUNT(*) as count FROM student_bills WHERE category_id = ?').get(catId);
    const billCount = billCountRow?.count || 0;

    if (billCount > 0) {
      return res.redirect(`${returnTo}?error=${encodeURIComponent(`Kategori "${category.name}" tidak dapat dihapus karena sudah memiliki ${billCount} data tagihan siswa yang menggunakannya. Anda dapat mengedit nama atau tarifnya saja.`)}`);
    }

    db.prepare('DELETE FROM fee_categories WHERE id = ?').run(catId);
    return res.redirect(`${returnTo}?success=${encodeURIComponent(`Kategori "${category.name}" (${category.code}) berhasil dihapus.`)}`);
  } catch (err) {
    return res.redirect(`${returnTo}?error=${encodeURIComponent(err.message)}`);
  }
});

module.exports = router;
