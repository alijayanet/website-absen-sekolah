const express = require('express');
const router = express.Router();
const db = require('../database/db');
const queue = require('../services/queue');

// Halaman Kiosk Scanner Gerbang Sekolah
router.get('/kiosk', (req, res) => {
  const settingsRows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of settingsRows) {
    settings[row.key] = row.value;
  }
  res.render('kiosk', { settings });
});

// Endpoint API Pencatatan Absensi (RFID & QR Code)
router.post('/api/attendance/scan', (req, res) => {
  try {
    const rawCode = (req.body.code || '').trim();

    if (!rawCode) {
      return res.status(400).json({
        success: false,
        code: 'EMPTY_CODE',
        message: 'Kode RFID atau QR Code tidak boleh kosong.'
      });
    }

    // Cari data siswa berdasarkan rfid_uid, qr_code_token, nis, atau nisn
    const student = db.prepare(`
      SELECT s.*, c.name as class_name 
      FROM students s 
      LEFT JOIN classes c ON s.class_id = c.id 
      WHERE (s.rfid_uid = ? OR s.qr_code_token = ? OR s.nis = ? OR s.nisn = ?) 
        AND s.is_active = 1
    `).get(rawCode, rawCode, rawCode, rawCode);

    if (!student) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Kartu atau kode QR tidak terdaftar di sistem.'
      });
    }

    // Waktu hari ini
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-CA'); // YYYY-MM-DD
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    const timeIn = `${hours}:${minutes}:${seconds}`;

    // Cek apakah siswa sudah melakukan absensi hari ini
    const existing = db.prepare('SELECT * FROM attendances WHERE student_id = ? AND date = ?').get(student.id, dateStr);

    if (existing) {
      return res.status(200).json({
        success: false,
        code: 'ALREADY_ATTENDED',
        message: `Siswa ${student.name} sudah melakukan absensi hari ini pada pukul ${existing.time_in} WIB.`,
        student: {
          id: student.id,
          name: student.name,
          nis: student.nis,
          class_name: student.class_name,
          photo: student.photo
        },
        attendance: existing
      });
    }

    // Ambil konfigurasi jam sekolah
    const jamMasukSetting = db.prepare("SELECT value FROM settings WHERE key = 'jam_masuk'").get()?.value || '07:00';
    const toleransiSetting = db.prepare("SELECT value FROM settings WHERE key = 'toleransi_telat'").get()?.value || '07:15';

    // Konversi jam ke total menit
    const [masukH, masukM] = jamMasukSetting.split(':').map(Number);
    const [toleransiH, toleransiM] = toleransiSetting.split(':').map(Number);
    const totalMinutesNow = now.getHours() * 60 + now.getMinutes();
    const totalMinutesMasuk = masukH * 60 + masukM;
    const totalMinutesToleransi = toleransiH * 60 + toleransiM;

    let status = 'HADIR';
    let lateMinutes = 0;

    if (totalMinutesNow > totalMinutesToleransi) {
      status = 'TERLAMBAT';
      lateMinutes = totalMinutesNow - totalMinutesMasuk;
    }

    // Simpan data absensi
    const insertAttendance = db.prepare(`
      INSERT INTO attendances (student_id, date, time_in, status, late_minutes, created_by)
      VALUES (?, ?, ?, ?, ?, 'KIOSK')
    `);
    const insertResult = insertAttendance.run(student.id, dateStr, timeIn, status, lateMinutes);

    // Kirim notifikasi WhatsApp jika nomor wali murid tersedia
    if (student.parent_phone) {
      const templateSetting = db.prepare("SELECT value FROM settings WHERE key = 'wa_template_absen'").get()?.value;
      const schoolNameSetting = db.prepare("SELECT value FROM settings WHERE key = 'school_name'").get()?.value || 'Sekolah';

      let template = templateSetting || 'Siswa {nama_siswa} telah hadir di sekolah pada {jam} ({status}).';

      // Format tanggal Indonesia
      const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      const indoDate = now.toLocaleDateString('id-ID', options);

      const statusIndo = status === 'HADIR' ? 'Hadir Tepat Waktu' : 'Terlambat';
      const ketTelat = status === 'TERLAMBAT' ? `\n⚠️ *Keterlambatan:* ${lateMinutes} menit` : '';

      const message = template
        .replace(/{nama_siswa}/g, student.name)
        .replace(/{kelas}/g, student.class_name || '-')
        .replace(/{tanggal}/g, indoDate)
        .replace(/{jam}/g, `${hours}:${minutes}`)
        .replace(/{status}/g, statusIndo)
        .replace(/{keterangan_telat}/g, ketTelat)
        .replace(/{nama_sekolah}/g, schoolNameSetting);

      queue.enqueue({
        studentId: student.id,
        phone: student.parent_phone,
        message,
        type: 'ATTENDANCE'
      });
    }

    return res.status(200).json({
      success: true,
      code: 'SUCCESS',
      message: status === 'HADIR' ? 'Absensi Berhasil: Hadir Tepat Waktu' : `Absensi Berhasil: Terlambat ${lateMinutes} Menit`,
      status,
      lateMinutes,
      timeIn,
      student: {
        id: student.id,
        name: student.name,
        nis: student.nis,
        nisn: student.nisn,
        class_name: student.class_name,
        photo: student.photo
      }
    });

  } catch (err) {
    console.error('Error saat proses scan absensi:', err);
    return res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: 'Terjadi kesalahan sistem saat mencatat absensi.'
    });
  }
});

module.exports = router;
