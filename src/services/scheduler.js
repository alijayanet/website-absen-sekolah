const db = require('../database/db');
const queue = require('./queue');
const { generateTeacherSummary } = require('./summary');
const { getTodayWIB, getTimeStringWIB } = require('../utils/timeHelper');

class SchedulerService {
  constructor() {
    this.interval = null;
  }

  start() {
    if (this.interval) clearInterval(this.interval);

    console.log('[Scheduler] Background scheduler presensi aktif (mengecek jadwal setiap 30 detik)...');

    // Cek pertama kali setelah 5 detik sistem berjalan, kemudian setiap 30 detik
    setTimeout(() => this.check(), 5000);
    this.interval = setInterval(() => {
      this.check();
    }, 30000);
  }

  check() {
    try {
      // Selalu trigger antrean pesan jika ada pesan tertunda di wa_queue
      try {
        queue.trigger();
      } catch (_) {}

      // 1. Periksa apakah pengaturan auto-send aktif
      const autoSendSetting = db.prepare("SELECT value FROM settings WHERE key = 'wa_auto_teacher_summary'").get();
      const isAutoSend = autoSendSetting ? autoSendSetting.value === '1' : false;

      if (!isAutoSend) return;

      // 2. Ambil target jam pengiriman rekap guru
      const targetTimeSetting = db.prepare("SELECT value FROM settings WHERE key = 'jam_rekap_guru'").get();
      const targetTime = targetTimeSetting?.value || '09:00';

      const now = new Date();
      const currentTime = getTimeStringWIB();   // HH:MM dalam WIB
      const today = getTodayWIB();              // YYYY-MM-DD dalam WIB

      // 3. Periksa apakah hari ini sudah pernah dikirim otomatis
      const lastSentSetting = db.prepare("SELECT value FROM settings WHERE key = 'last_auto_teacher_summary_date'").get();
      const lastSentDate = lastSentSetting?.value || '';

      // Jika waktu sekarang sudah mencapai/melewati targetTime dan hari ini belum pernah dikirim
      if (currentTime >= targetTime && lastSentDate !== today) {
        console.log(`[Scheduler] Waktu saat ini (${currentTime} WIB) telah mencapai target kirim rekap guru (${targetTime} WIB). Memulai pengiriman otomatis...`);

        // Tandai tanggal hari ini sudah diproses agar tidak terduplikasi
        const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
        upsert.run('last_auto_teacher_summary_date', today);

        // Ambil seluruh kelas yang memiliki wali kelas dan memiliki nomor WhatsApp
        const classesWithTeachers = db.prepare(`
          SELECT c.id as class_id, c.name as class_name, u.name as teacher_name, u.phone as teacher_phone
          FROM classes c
          JOIN users u ON u.class_id = c.id
          WHERE u.role = 'guru' AND u.phone IS NOT NULL AND TRIM(u.phone) != ''
          ORDER BY c.name ASC
        `).all();

        if (classesWithTeachers.length === 0) {
          console.log('[Scheduler] Tidak ada wali kelas dengan nomor WhatsApp yang terdaftar.');
          return;
        }

        let totalQueued = 0;

        for (const ct of classesWithTeachers) {
          try {
            const summary = generateTeacherSummary(ct.class_id, today);
            if (summary && summary.message) {
              queue.enqueue({
                phone: ct.teacher_phone.trim(),
                message: summary.message.trim(),
                type: 'TEACHER_SUMMARY'
              });
              totalQueued++;
              console.log(`[Scheduler] Rekap otomatis kelas ${ct.class_name} dimasukkan ke antrean WA wali kelas ${ct.teacher_name} (${ct.teacher_phone})`);
            }
          } catch (err) {
            console.error(`[Scheduler] Gagal membuat rekap kelas ${ct.class_name}:`, err.message);
          }
        }

        console.log(`[Scheduler] Selesai: ${totalQueued} rekap presensi kelas otomatis berhasil dijadwalkan ke WhatsApp.`);
      }
    } catch (err) {
      console.error('[Scheduler] Error saat memeriksa jadwal pengiriman rekap:', err.message);
    }
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }
}

module.exports = new SchedulerService();
