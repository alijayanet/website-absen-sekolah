const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const db = require('../database/db');

class WhatsAppService {
  constructor() {
    this.sock = null;
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'qr_ready' | 'connected'
    this.qrCodeDataUrl = null;
    this.userJid = null;
    this.isInitializing = false;
  }

  // Format nomor HP Indonesia (08... / +62... -> 628...@s.whatsapp.net)
  formatJid(phone) {
    if (!phone) return null;
    let cleaned = phone.replace(/[^0-9]/g, '');
    if (cleaned.startsWith('0')) {
      cleaned = '62' + cleaned.slice(1);
    } else if (cleaned.startsWith('8')) {
      cleaned = '62' + cleaned;
    }
    return `${cleaned}@s.whatsapp.net`;
  }

  // Bersihkan format nomor untuk perbandingan database
  cleanPhone(phone) {
    if (!phone) return '';
    let cleaned = phone.replace(/[^0-9]/g, '');
    if (cleaned.startsWith('62')) {
      return '0' + cleaned.slice(2);
    }
    return cleaned;
  }

  async initWhatsApp() {
    if (this.isInitializing) return;
    this.isInitializing = true;
    this.status = 'connecting';

    try {
      const { state, saveCreds } = await useMultiFileAuthState(config.baileysAuthPath);
      const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: [2, 3000, 1015901307] }));

      this.sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false,
        auth: state,
        browser: ['Absensi Sekolah Bot', 'Chrome', '1.0.0'],
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000
      });

      this.sock.ev.on('creds.update', saveCreds);

      this.sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qrCodeDataUrl = await QRCode.toDataURL(qr);
            this.status = 'qr_ready';
            console.log('[WhatsApp] QR Code baru siap discan.');
          } catch (err) {
            console.error('[WhatsApp] Gagal generate QR data URL:', err);
          }
        }

        if (connection === 'close') {
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          this.status = 'disconnected';
          this.qrCodeDataUrl = null;
          this.userJid = null;
          console.log(`[WhatsApp] Koneksi terputus (Status: ${statusCode}). Reconnect: ${shouldReconnect}`);

          if (shouldReconnect) {
            setTimeout(() => {
              this.isInitializing = false;
              this.initWhatsApp();
            }, 3000);
          } else {
            this.isInitializing = false;
            // Jika logout, bersihkan direktori sesi
            try {
              fs.rmSync(config.baileysAuthPath, { recursive: true, force: true });
              fs.mkdirSync(config.baileysAuthPath, { recursive: true });
            } catch (e) {}
          }
        } else if (connection === 'open') {
          this.status = 'connected';
          this.qrCodeDataUrl = null;
          this.userJid = this.sock.user?.id || 'Connected';
          this.isInitializing = false;
          console.log(`[WhatsApp] Terkoneksi berhasil sebagai: ${this.userJid}`);
        }
      });

      // Tangani Pesan Masuk (2-Way Handshake: Simpan Kontak & Balas "YA")
      this.sock.ev.on('messages.upsert', async (m) => {
        try {
          if (!m.messages || m.messages.length === 0) return;
          const msg = m.messages[0];
          if (msg.key.fromMe) return; // Abaikan pesan dari bot sendiri

          const remoteJid = msg.key.remoteJid;
          if (!remoteJid || remoteJid.includes('@g.us')) return; // Abaikan pesan grup

          // Ekstrak teks pesan
          const text = (
            msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            ''
          ).trim();

          if (!text) return;

          const senderPhone = remoteJid.split('@')[0];
          const localPhone0 = '0' + (senderPhone.startsWith('62') ? senderPhone.slice(2) : senderPhone);
          const localPhone62 = senderPhone;

          // Cek apakah wali membalas "YA"
          if (/^ya\b|^ya!|^iya\b/i.test(text)) {
            console.log(`[WhatsApp] Balasan 'YA' diterima dari: ${remoteJid}`);

            // Cari siswa terkait berdasarkan nomor HP wali
            const students = db.prepare(`
              SELECT s.*, c.name as class_name 
              FROM students s
              LEFT JOIN classes c ON s.class_id = c.id
              WHERE s.parent_phone = ? OR s.parent_phone = ? OR s.parent_phone LIKE ?
            `).all(localPhone0, localPhone62, `%${localPhone0.slice(2)}%`);

            if (students.length > 0) {
              // Update status siswa menjadi confirmed
              const updateStmt = db.prepare(`
                UPDATE students 
                SET wa_status = 'confirmed', wa_confirmed_at = CURRENT_TIMESTAMP 
                WHERE id = ?
              `);

              const schoolNameSetting = db.prepare("SELECT value FROM settings WHERE key = 'school_name'").get();
              const schoolName = schoolNameSetting?.value || 'Sekolah';

              for (const student of students) {
                updateStmt.run(student.id);
              }

              const studentNames = students.map(s => `*${s.name}* (Kelas ${s.class_name})`).join(', ');
              const parentName = students[0].parent_name ? `Bapak/Ibu ${students[0].parent_name}` : 'Bapak/Ibu Wali Murid';

              const replyMessage = `Terima kasih ${parentName}.\n\nNomor Anda telah *BERHASIL TERVERIFIKASI* di sistem absensi *${schoolName}* untuk ananda:\n${studentNames}\n\nLaporan kehadiran harian ananda akan otomatis dikirimkan ke nomor ini saat ananda melakukan absensi di sekolah.\n\n_Sistem Absensi ${schoolName}_`;

              await this.sendTextMessage(remoteJid, replyMessage);
              console.log(`[WhatsApp] Konfirmasi terverifikasi terkirim ke: ${remoteJid}`);
            }
          }
        } catch (err) {
          console.error('[WhatsApp] Error pada handler pesan masuk:', err);
        }
      });

    } catch (err) {
      this.isInitializing = false;
      this.status = 'disconnected';
      console.error('[WhatsApp] Gagal inisialisasi Baileys:', err);
    }
  }

  async sendTextMessage(to, message) {
    if (this.status !== 'connected' || !this.sock) {
      throw new Error('WhatsApp tidak terkoneksi saat ini');
    }

    const jid = to.includes('@') ? to : this.formatJid(to);
    if (!jid) throw new Error('Format nomor tujuan tidak valid');

    return await this.sock.sendMessage(jid, { text: message });
  }

  getStatus() {
    return {
      status: this.status,
      userJid: this.userJid,
      qrCodeDataUrl: this.qrCodeDataUrl
    };
  }

  async logout() {
    try {
      if (this.sock) {
        await this.sock.logout();
      }
    } catch (e) {}
    this.status = 'disconnected';
    this.qrCodeDataUrl = null;
    this.userJid = null;
    try {
      fs.rmSync(config.baileysAuthPath, { recursive: true, force: true });
      fs.mkdirSync(config.baileysAuthPath, { recursive: true });
    } catch (e) {}
    this.initWhatsApp();
  }

  async reconnect() {
    if (this.sock) {
      try {
        this.sock.end();
      } catch (e) {}
    }
    this.isInitializing = false;
    await this.initWhatsApp();
  }
}

// Export singleton instance
module.exports = new WhatsAppService();
