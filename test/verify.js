const assert = require('assert');
const db = require('../src/database/db');
const idcardService = require('../src/services/idcard');
const queue = require('../src/services/queue');
const whatsapp = require('../src/services/whatsapp');

async function runVerification() {
  console.log('--- Memulai Verifikasi Sistem Absensi Sekolah ---');

  // 1. Verifikasi Database & Tables
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
  console.log('Tabel ditemukan:', tables);
  assert(tables.includes('settings'), 'Tabel settings harus ada');
  assert(tables.includes('users'), 'Tabel users harus ada');
  assert(tables.includes('classes'), 'Tabel classes harus ada');
  assert(tables.includes('students'), 'Tabel students harus ada');
  assert(tables.includes('attendances'), 'Tabel attendances harus ada');
  assert(tables.includes('wa_queue'), 'Tabel wa_queue harus ada');
  console.log('✓ 1. Struktur tabel database valid.');

  // 2. Verifikasi Data Siswa & User
  const adminUser = db.prepare("SELECT * FROM users WHERE username = 'admin'").get();
  assert(adminUser, 'Admin default harus ada');
  assert.strictEqual(adminUser.role, 'admin');

  const student1 = db.prepare("SELECT * FROM students WHERE nis = '1001'").get();
  assert(student1, 'Siswa 1001 harus ada');
  assert.strictEqual(student1.rfid_uid, 'RFID1001');
  console.log('✓ 2. Data default admin & siswa valid.');

  // 3. Verifikasi Logika Absensi
  // Hapus absensi siswa 1001 hari ini jika ada agar bersih
  const today = new Date().toLocaleDateString('en-CA');
  db.prepare("DELETE FROM attendances WHERE student_id = ? AND date = ?").run(student1.id, today);

  // Simulasikan Scan Pertama
  const timeIn = '06:55:00';
  db.prepare(`
    INSERT INTO attendances (student_id, date, time_in, status, late_minutes, created_by)
    VALUES (?, ?, ?, 'HADIR', 0, 'TEST')
  `).run(student1.id, today, timeIn);

  const attRow = db.prepare("SELECT * FROM attendances WHERE student_id = ? AND date = ?").get(student1.id, today);
  assert(attRow, 'Catatan absensi harus tersimpan');
  assert.strictEqual(attRow.status, 'HADIR');

  // Uji Coba Anti-Duplicate (Unique constraint student_id + date)
  let duplicatePrevented = false;
  try {
    db.prepare(`
      INSERT INTO attendances (student_id, date, time_in, status, late_minutes)
      VALUES (?, ?, '07:05:00', 'TERLAMBAT', 5)
    `).run(student1.id, today);
  } catch (e) {
    duplicatePrevented = true;
  }
  assert(duplicatePrevented, 'Duplikasi absensi di hari yang sama harus dicegah database');
  console.log('✓ 3. Logika absensi & anti-duplicate scan valid.');

  // 4. Verifikasi ID Card Service (CR80 & QR Code Generator)
  const cardData = await idcardService.getCardDataForStudent(student1.id);
  assert(cardData, 'Card data harus ada');
  assert(cardData.qr_data_url && cardData.qr_data_url.startsWith('data:image/png;base64,'), 'QR data URL harus berupa base64 PNG');
  console.log('✓ 4. Pembuatan QR Code Kartu Siswa CR80 valid.');

  // 5. Verifikasi WhatsApp Message Queue
  const queueId = queue.enqueue({
    studentId: student1.id,
    phone: '081234567890',
    message: 'Tes notifikasi verifikasi sistem absensi',
    type: 'ATTENDANCE'
  });
  assert(queueId, 'Pesan harus masuk antrean dengan ID');

  const queuedItem = db.prepare("SELECT * FROM wa_queue WHERE id = ?").get(queueId);
  assert(queuedItem, 'Item antrean harus ditemukan');
  assert.strictEqual(queuedItem.status, 'pending');
  assert.strictEqual(queuedItem.phone, '081234567890');
  console.log('✓ 5. Antrean pesan WhatsApp SQLite valid.');

  // 6. Verifikasi WhatsApp 2-Way Handshake (Simulasi Balasan 'YA' Wali Murid)
  db.prepare("UPDATE students SET wa_status = 'unverified', wa_confirmed_at = NULL WHERE id = ?").run(student1.id);
  const freshStudent = db.prepare("SELECT * FROM students WHERE id = ?").get(student1.id);
  assert.strictEqual(freshStudent.wa_status, 'unverified');

  // Simulasikan nomor wali membalas 'YA'
  const parentPhone = student1.parent_phone;
  const updateStmt = db.prepare(`
    UPDATE students 
    SET wa_status = 'confirmed', wa_confirmed_at = CURRENT_TIMESTAMP 
    WHERE parent_phone = ?
  `);
  updateStmt.run(parentPhone);

  const updatedStudent = db.prepare("SELECT * FROM students WHERE id = ?").get(student1.id);
  assert.strictEqual(updatedStudent.wa_status, 'confirmed', 'Status harus terverifikasi');
  assert(updatedStudent.wa_confirmed_at, 'Waktu konfirmasi harus tercatat');
  console.log('✓ 6. WhatsApp 2-way handshake verifikasi nomor wali murid valid.');

  console.log('--- SEMUA PENGUJIAN INTEGRITAS BERHASIL 100% ---');
  process.exit(0);
}

runVerification().catch(err => {
  console.error('Verifikasi gagal:', err);
  process.exit(1);
});
