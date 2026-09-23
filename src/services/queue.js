const db = require('../database/db');

function getWhatsAppService() {
  return require('./whatsapp');
}

class QueueService {
  constructor() {
    this.isProcessing = false;
    this.timer = null;
  }

  // Tambahkan pesan ke antrean database
  enqueue({ studentId = null, phone, message, type = 'ATTENDANCE' }) {
    if (!phone || !message) return null;

    const stmt = db.prepare(`
      INSERT INTO wa_queue (student_id, type, phone, message, status)
      VALUES (?, ?, ?, ?, 'pending')
    `);
    const info = stmt.run(studentId, type, phone, message);
    this.trigger();
    return info.lastInsertRowid;
  }

  // Trigger antrean agar memproses jika belum berjalan
  trigger() {
    if (this.isProcessing) return;
    this.processNext();
  }

  async processNext() {
    this.isProcessing = true;

    try {
      // Cek apakah toggle notifikasi WA aktif
      const enabledSetting = db.prepare("SELECT value FROM settings WHERE key = 'wa_enabled'").get();
      const isEnabled = enabledSetting ? enabledSetting.value === '1' : true;

      if (!isEnabled) {
        this.isProcessing = false;
        return;
      }

      // Cek apakah WhatsApp terkoneksi
      const whatsapp = getWhatsAppService();
      if (!whatsapp || whatsapp.status !== 'connected') {
        // Jika belum terkoneksi, coba cek kembali dalam 5 detik
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.processNext(), 5000);
        this.isProcessing = false;
        return;
      }

      // Ambil 1 antrean pending terlama
      const item = db.prepare(`
        SELECT * FROM wa_queue 
        WHERE status = 'pending' 
        ORDER BY id ASC 
        LIMIT 1
      `).get();

      if (!item) {
        // Tidak ada antrean, berhenti
        this.isProcessing = false;
        return;
      }

      // Tandai sedang dikirim
      db.prepare("UPDATE wa_queue SET status = 'sending' WHERE id = ?").run(item.id);

      try {
        await whatsapp.sendTextMessage(item.phone, item.message);

        // Tandai sukses terkirim
        db.prepare(`
          UPDATE wa_queue 
          SET status = 'sent', sent_at = CURRENT_TIMESTAMP 
          WHERE id = ?
        `).run(item.id);

        console.log(`[Queue] Pesan terkirim ke: ${item.phone} (ID: ${item.id})`);
      } catch (err) {
        console.error(`[Queue] Gagal kirim ke ${item.phone}:`, err.message);

        const newAttempts = (item.attempts || 0) + 1;
        const newStatus = newAttempts >= 3 ? 'failed' : 'pending';

        db.prepare(`
          UPDATE wa_queue 
          SET status = ?, attempts = ?, error_message = ? 
          WHERE id = ?
        `).run(newStatus, newAttempts, err.message || 'Unknown error', item.id);
      }

      // Jeda acak 1.5 - 3 detik antar pesan agar aman dari rate limiting / anti-spam WhatsApp
      const randomDelay = Math.floor(Math.random() * 1500) + 1500;
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.processNext(), randomDelay);

    } catch (globalErr) {
      console.error('[Queue] Error worker:', globalErr);
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.processNext(), 5000);
      this.isProcessing = false;
    }
  }

  // Bersihkan antrean yang gagal agar bisa dicoba lagi
  retryFailed() {
    const stmt = db.prepare(`
      UPDATE wa_queue 
      SET status = 'pending', attempts = 0, error_message = NULL 
      WHERE status = 'failed'
    `);
    const res = stmt.run();
    this.trigger();
    return res.changes;
  }
}

module.exports = new QueueService();
