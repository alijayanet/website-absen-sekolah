const express = require('express');
const router = express.Router();
const db = require('../database/db');
const queue = require('../services/queue');
const { getTodayWIB, getTimeSecondWIB, getTimeStringWIB, formatDateIndonesia } = require('../utils/timeHelper');

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

    // Waktu hari ini dalam WIB
    const dateStr = getTodayWIB();          // YYYY-MM-DD
    const timeIn = getTimeSecondWIB();       // HH:MM:SS
    const jamStr = timeIn.slice(0, 5);       // HH:MM WIB

    // Ambil konfigurasi fitur Absen Pulang (Opsional)
    const enablePulangSetting = db.prepare("SELECT value FROM settings WHERE key = 'enable_absen_pulang'").get()?.value === '1';
    const jamPulangSetting = db.prepare("SELECT value FROM settings WHERE key = 'jam_pulang'").get()?.value || '14:00';

    // Cek apakah siswa sudah melakukan absensi hari ini
    const existing = db.prepare('SELECT * FROM attendances WHERE student_id = ? AND date = ?').get(student.id, dateStr);

    if (existing) {
      // JIKA FITUR ABSEN PULANG TIDAK AKTIF (DEFAULT)
      if (!enablePulangSetting) {
        return res.status(200).json({
          success: false,
          code: 'ALREADY_ATTENDED',
          message: `Siswa ${student.name} sudah melakukan absensi hari ini pada pukul ${existing.time_in.slice(0, 5)} WIB.`,
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

      // JIKA FITUR ABSEN PULANG AKTIF
      // 1. Cek apakah sudah pernah absen pulang hari ini
      if (existing.time_out) {
        return res.status(200).json({
          success: false,
          code: 'ALREADY_CHECKED_OUT',
          message: `Siswa ${student.name} sudah melakukan absensi pulang hari ini pada pukul ${existing.time_out.slice(0, 5)} WIB.`,
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

      // 2. Proteksi Double Tap Tidak Sengaja (< 5 menit dari jam masuk)
      const [timeH, timeM] = timeIn.split(':').map(Number);
      const [inH, inM] = existing.time_in.split(':').map(Number);
      const totalMinutesNow = timeH * 60 + timeM;
      const totalMinutesIn = inH * 60 + inM;
      if (totalMinutesNow - totalMinutesIn < 5 && totalMinutesNow >= totalMinutesIn) {
        return res.status(200).json({
          success: false,
          code: 'ALREADY_ATTENDED',
          message: `Siswa ${student.name} baru saja melakukan absensi masuk pada pukul ${existing.time_in.slice(0, 5)} WIB. Harap scan kembali saat jam kepulangan sekolah.`,
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

      // 3. Cek apakah sudah memasuki jam pulang sekolah
      const [pulangH, pulangM] = jamPulangSetting.split(':').map(Number);
      const totalMinutesPulang = pulangH * 60 + pulangM;

      if (totalMinutesNow < totalMinutesPulang) {
        return res.status(200).json({
          success: false,
          code: 'TOO_EARLY_FOR_CHECKOUT',
          message: `Belum memasuki jam pulang sekolah (Jam Buka Pulang: ${jamPulangSetting} WIB). Siswa ${student.name} sudah tercatat masuk pukul ${existing.time_in.slice(0, 5)} WIB.`,
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

      // 4. Update data absensi: catat time_out (Jam Pulang)
      db.prepare('UPDATE attendances SET time_out = ? WHERE id = ?').run(timeIn, existing.id);

      // 5. Kirim notifikasi WhatsApp kepulangan ke orang tua jika ada nomor HP
      if (student.parent_phone) {
        const templateSetting = db.prepare("SELECT value FROM settings WHERE key = 'wa_template_pulang'").get()?.value;
        const schoolNameSetting = db.prepare("SELECT value FROM settings WHERE key = 'school_name'").get()?.value || 'Sekolah';
        const indoDate = formatDateIndonesia(dateStr);

        let template = templateSetting || 'Assalamu’alaikum Wr. Wb.\nYth. Bapak/Ibu Wali Murid dari *{nama_siswa}* (Kelas {kelas}),\n\nDiberitahukan bahwa ananda telah selesai kegiatan belajar dan melakukan absensi PULANG dari sekolah pada pukul {jam} WIB ({tanggal}).\n\nTerima kasih.\n_Sistem Absensi {nama_sekolah}_';

        const message = template
          .replace(/{nama_siswa}/g, student.name)
          .replace(/{kelas}/g, student.class_name || '-')
          .replace(/{tanggal}/g, indoDate)
          .replace(/{jam}/g, jamStr)
          .replace(/{nama_sekolah}/g, schoolNameSetting);

        queue.enqueue({
          studentId: student.id,
          phone: student.parent_phone,
          message,
          type: 'ATTENDANCE_OUT'
        });
      }

      return res.status(200).json({
        success: true,
        code: 'SUCCESS_CHECKOUT',
        type: 'OUT',
        message: `Absensi Pulang Berhasil: Siswa ${student.name} telah tercatat pulang sekolah pada pukul ${jamStr} WIB.`,
        timeOut: jamStr,
        student: {
          id: student.id,
          name: student.name,
          nis: student.nis,
          nisn: student.nisn,
          class_name: student.class_name,
          photo: student.photo
        }
      });
    }

    // Ambil konfigurasi jam sekolah
    const jamMasukSetting = db.prepare("SELECT value FROM settings WHERE key = 'jam_masuk'").get()?.value || '07:00';
    const toleransiSetting = db.prepare("SELECT value FROM settings WHERE key = 'toleransi_telat'").get()?.value || '07:15';

    // Konversi jam ke total menit
    const [masukH, masukM] = jamMasukSetting.split(':').map(Number);
    const [toleransiH, toleransiM] = toleransiSetting.split(':').map(Number);
    const [timeH, timeM] = timeIn.split(':').map(Number); // gunakan WIB dari timeIn
    const totalMinutesNow = timeH * 60 + timeM;
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
      const indoDate = formatDateIndonesia(dateStr);
      const jamStr = timeIn.slice(0, 5); // Format HH:MM WIB

      const statusIndo = status === 'HADIR' ? 'Hadir Tepat Waktu' : 'Terlambat';
      const ketTelat = status === 'TERLAMBAT' ? `\n⚠️ *Keterlambatan:* ${lateMinutes} menit` : '';

      const message = template
        .replace(/{nama_siswa}/g, student.name)
        .replace(/{kelas}/g, student.class_name || '-')
        .replace(/{tanggal}/g, indoDate)
        .replace(/{jam}/g, jamStr)
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
