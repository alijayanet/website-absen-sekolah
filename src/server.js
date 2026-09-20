const express = require('express');
const session = require('express-session');
const path = require('path');
const config = require('./config');
const db = require('./database/db');
const { attachGlobalData } = require('./middlewares/auth');

// Services
const whatsapp = require('./services/whatsapp');
const queue = require('./services/queue');
const scheduler = require('./services/scheduler');

// Routes
const landingRoute = require('./routes/landing');
const authRoute = require('./routes/auth');
const kioskRoute = require('./routes/kiosk');
const dashboardRoute = require('./routes/dashboard');
const studentsRoute = require('./routes/students');
const classesRoute = require('./routes/classes');
const attendancesRoute = require('./routes/attendances');
const cmsRoute = require('./routes/cms');
const whatsappRoute = require('./routes/whatsapp');
const idcardRoute = require('./routes/idcard');
const teachersRoute = require('./routes/teachers');
const leavesRoute = require('./routes/leaves');
const financeRoute = require('./routes/finance');
const savingsRoute = require('./routes/savings');
const paymentNotifRoute = require('./routes/api/paymentNotif');

const app = express();

// Konfigurasi View Engine EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Parsing Body & Data Statis
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));
app.use('/public', express.static(path.join(__dirname, '../public')));
app.use('/uploads', express.static(config.uploadPath));

// Konfigurasi Sesi Pengguna
app.use(session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 7, // 7 hari
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// Global Middleware untuk Templating
app.use(attachGlobalData);

// Daftarkan Rute Aplikasi
app.use('/', landingRoute);
app.use('/', authRoute);
app.use('/', kioskRoute);
app.use('/', dashboardRoute);
app.use('/', studentsRoute);
app.use('/', classesRoute);
app.use('/', attendancesRoute);
app.use('/', cmsRoute);
app.use('/', whatsappRoute);
app.use('/', idcardRoute);
app.use('/', teachersRoute);
app.use('/', leavesRoute);
app.use('/', financeRoute);
app.use('/', savingsRoute);
app.use('/api/webhook', paymentNotifRoute);

// Handler 404
app.use((req, res) => {
  res.status(404).send('Halaman tidak ditemukan (404)');
});

// Jalankan Server
const PORT = config.port;
app.listen(PORT, async () => {
  console.log(`=======================================================`);
  console.log(`🚀 Server Absensi Sekolah Aktif di http://localhost:${PORT}`);
  console.log(`📍 Kiosk Gerbang:  http://localhost:${PORT}/kiosk`);
  console.log(`📍 Login Portal:   http://localhost:${PORT}/login`);
  console.log(`=======================================================`);

  // Inisialisasi Baileys WhatsApp di latar belakang
  console.log('[WhatsApp] Menghubungkan ke WhatsApp Baileys...');
  whatsapp.initWhatsApp().catch(err => {
    console.error('[WhatsApp] Gagal inisialisasi awal:', err.message);
  });

  // Jalankan queue worker
  queue.trigger();

  // Jalankan background scheduler untuk rekap harian otomatis
  scheduler.start();
});
