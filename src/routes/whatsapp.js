const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { isAuthenticated, isAdmin } = require('../middlewares/auth');
const whatsapp = require('../services/whatsapp');
const queue = require('../services/queue');

// Tampilan Manajemen WhatsApp Baileys
router.get('/dashboard/whatsapp', isAuthenticated, isAdmin, (req, res) => {
  const statusInfo = whatsapp.getStatus();

  // Ambil 50 log antrean pesan terakhir
  const queueLogs = db.prepare(`
    SELECT q.*, s.name as student_name, s.nis 
    FROM wa_queue q
    LEFT JOIN students s ON q.student_id = s.id
    ORDER BY q.id DESC 
    LIMIT 50
  `).all();

  // Statistik antrean
  const stats = db.prepare(`
    SELECT 
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'sending' THEN 1 ELSE 0 END) as sending,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      COUNT(*) as total
    FROM wa_queue
  `).get() || { pending: 0, sending: 0, sent: 0, failed: 0, total: 0 };

  res.render('dashboard/whatsapp', {
    statusInfo,
    queueLogs,
    stats,
    successMsg: req.query.success || null,
    errorMsg: req.query.error || null
  });
});

// JSON API Status Real-Time WhatsApp untuk Polling di Frontend
router.get('/api/whatsapp/status', isAuthenticated, (req, res) => {
  res.json(whatsapp.getStatus());
});

// Kirim Pesan Uji Coba (Test Send)
router.post('/dashboard/whatsapp/test', isAuthenticated, isAdmin, async (req, res) => {
  try {
    const { test_phone, test_message } = req.body;
    if (!test_phone || !test_message) {
      return res.redirect('/dashboard/whatsapp?error=Nomor tujuan dan pesan uji coba wajib diisi.');
    }

    if (whatsapp.status !== 'connected') {
      return res.redirect('/dashboard/whatsapp?error=WhatsApp belum terkoneksi. Silakan scan QR code terlebih dahulu.');
    }

    await whatsapp.sendTextMessage(test_phone.trim(), test_message.trim());
    res.redirect('/dashboard/whatsapp?success=Pesan uji coba berhasil terkirim!');
  } catch (err) {
    console.error('Error test send WA:', err);
    res.redirect(`/dashboard/whatsapp?error=${encodeURIComponent(err.message)}`);
  }
});

// Reconnect WhatsApp
router.post('/dashboard/whatsapp/reconnect', isAuthenticated, isAdmin, async (req, res) => {
  try {
    await whatsapp.reconnect();
    res.redirect('/dashboard/whatsapp?success=Memulai ulang koneksi WhatsApp...');
  } catch (err) {
    res.redirect(`/dashboard/whatsapp?error=${encodeURIComponent(err.message)}`);
  }
});

// Logout Sesi WhatsApp
router.post('/dashboard/whatsapp/logout', isAuthenticated, isAdmin, async (req, res) => {
  try {
    await whatsapp.logout();
    res.redirect('/dashboard/whatsapp?success=Sesi WhatsApp berhasil dikeluarkan.');
  } catch (err) {
    res.redirect(`/dashboard/whatsapp?error=${encodeURIComponent(err.message)}`);
  }
});

// Ulangi Antrean Pesan yang Gagal
router.post('/dashboard/whatsapp/retry-queue', isAuthenticated, isAdmin, (req, res) => {
  try {
    const retriedCount = queue.retryFailed();
    res.redirect(`/dashboard/whatsapp?success=${retriedCount} pesan gagal telah dimasukkan kembali ke antrean.`);
  } catch (err) {
    res.redirect(`/dashboard/whatsapp?error=${encodeURIComponent(err.message)}`);
  }
});

module.exports = router;
