const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const db = require('../database/db');
const botService = require('./bot');

const { waLidStore } = require('./waLidStore');

class WhatsAppService {
  constructor() {
    this.sock = null;
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'qr_ready' | 'connected'
    this.qrCodeDataUrl = null;
    this.userJid = null;
    this.isInitializing = false;
    this.waLidStore = waLidStore;
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

  /**
   * Scan folder auth Baileys untuk mencocokkan session-LID dengan session-PHONE melalui remoteIdentityKey
   */
  findPhoneByLidInAuth(lidUser) {
    try {
      const authFolder = config.baileysAuthPath;
      if (!fs.existsSync(authFolder)) return null;

      const files = fs.readdirSync(authFolder);
      const lidFile = files.find(f => f.startsWith(`session-${lidUser}.`));
      if (!lidFile) return null;

      const lidContent = fs.readFileSync(path.join(authFolder, lidFile), 'utf8');
      const m = lidContent.match(/"remoteIdentityKey":"([^"]+)"/);
      if (!m) return null;
      const targetKey = m[1];

      for (const f of files) {
        if (f.startsWith(`session-${lidUser}.`)) continue;
        const phoneMatch = f.match(/^session-(\d+)\./);
        if (!phoneMatch) continue;
        const candidatePhone = phoneMatch[1];
        if (candidatePhone.length < 10) continue;

        const content = fs.readFileSync(path.join(authFolder, f), 'utf8');
        if (content.includes(`"remoteIdentityKey":"${targetKey}"`)) {
          return candidatePhone;
        }
      }
    } catch (e) {
      console.warn('[WhatsApp LID] findPhoneByLidInAuth warning:', e.message);
    }
    return null;
  }

  /**
   * Pre-resolve seluruh nomor Guru, Admin, dan Wali Murid yang ada di database ke bentuk LID
   */
  async preResolveAllLids(targetLidUser = null) {
    if (!this.sock || this.status !== 'connected') return null;

    try {
      const userRows = db.prepare("SELECT phone FROM users WHERE phone IS NOT NULL AND TRIM(phone) != ''").all();
      const studentRows = db.prepare("SELECT parent_phone as phone FROM students WHERE parent_phone IS NOT NULL AND TRIM(parent_phone) != ''").all();
      const allPhones = [...userRows, ...studentRows].map(r => r.phone);

      for (const rawPhone of allPhones) {
        const clean = String(rawPhone).replace(/\D/g, '');
        if (clean.length < 8) continue;
        const formatted = clean.startsWith('0') ? '62' + clean.slice(1) : clean.startsWith('62') ? clean : '62' + clean;
        const jid = `${formatted}@s.whatsapp.net`;

        const cachedLid = waLidStore.getByPhone(formatted);
        if (targetLidUser && cachedLid && cachedLid.includes(targetLidUser)) {
          return formatted;
        }

        try {
          const waCheck = await this.sock.onWhatsApp(jid);
          if (waCheck && waCheck.length > 0 && waCheck[0].exists && waCheck[0].lid) {
            const lidJid = waCheck[0].lid;
            const lidUser = lidJid.split('@')[0];
            waLidStore.set(lidJid, formatted);
            waLidStore.set(lidUser, formatted);
            console.log(`[WhatsApp LID] Terpetakan: ${formatted} -> ${lidJid}`);

            if (targetLidUser && (lidUser === targetLidUser || lidJid.includes(targetLidUser))) {
              return formatted;
            }
          }
        } catch (_) {}
      }
    } catch (err) {
      console.warn('[WhatsApp LID] Gagal pre-resolve nomor:', err.message);
    }

    return null;
  }

  /**
   * Resolusi nomor telepon pengirim dari JID (Mendukung standar @s.whatsapp.net, senderPn, dan @lid)
   */
  async resolvePhoneNumber(jid, msg = null) {
    if (!jid) return null;

    // 1. Jika PNJID standar (@s.whatsapp.net)
    if (jid.endsWith('@s.whatsapp.net')) {
      return jid.split('@')[0].replace(/\D/g, '');
    }

    // 2. Cek apakah ada senderPn di msg.key (fitur Baileys)
    if (msg?.key?.senderPn && msg.key.senderPn.endsWith('@s.whatsapp.net')) {
      const p = msg.key.senderPn.split('@')[0].replace(/\D/g, '');
      waLidStore.set(jid, p);
      return p;
    }
    if (msg?.key?.participantPn && msg.key.participantPn.endsWith('@s.whatsapp.net')) {
      const p = msg.key.participantPn.split('@')[0].replace(/\D/g, '');
      waLidStore.set(jid, p);
      return p;
    }
    if (msg?.key?.participant && msg.key.participant.endsWith('@s.whatsapp.net')) {
      const p = msg.key.participant.split('@')[0].replace(/\D/g, '');
      return p;
    }

    // 3. Jika JID adalah @lid
    if (jid.endsWith('@lid') || (msg?.key?.senderLid && msg.key.senderLid.endsWith('@lid'))) {
      const lidJid = jid.endsWith('@lid') ? jid : msg.key.senderLid;
      const lidUser = lidJid.split('@')[0];

      // 3a. Cek waLidStore cache
      const cached = waLidStore.get(lidJid) || waLidStore.get(lidUser);
      if (cached) {
        return cached.replace(/\D/g, '');
      }

      // 3b. Cek signalRepository jika ada (Baileys v7)
      if (this.sock?.signalRepository?.lidMapping?.getPNForLID) {
        try {
          const pnjid = await this.sock.signalRepository.lidMapping.getPNForLID(lidJid);
          if (pnjid && pnjid.endsWith('@s.whatsapp.net')) {
            const p = pnjid.split('@')[0].replace(/\D/g, '');
            waLidStore.set(lidJid, p);
            waLidStore.set(lidUser, p);
            return p;
          }
        } catch (e) {}
      }

      // 3c. Cek kecocokan session di auth folder (remoteIdentityKey)
      try {
        const matchPhone = this.findPhoneByLidInAuth(lidUser);
        if (matchPhone) {
          waLidStore.set(lidJid, matchPhone);
          waLidStore.set(lidUser, matchPhone);
          console.log(`[WhatsApp LID] Ditemukan dari Auth Session: ${lidUser} -> ${matchPhone}`);
          return matchPhone;
        }
      } catch (e) {}

      // 3d. Coba on-demand pre-resolve terhadap seluruh nomor di database
      try {
        const found = await this.preResolveAllLids(lidUser);
        if (found) {
          return found;
        }
      } catch (e) {}
    }

    // 4. Fallback: ambil string angka dari JID
    return jid.split('@')[0].replace(/\D/g, '');
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

          // Pre-resolve nomor Guru, Admin, dan Orang Tua ke format LID
          this.preResolveAllLids().catch(err => {
            console.warn('[WhatsApp LID] Pre-resolve warning:', err.message);
          });
        }
      });

      // Tangani Pesan Masuk via Bot Service
      this.sock.ev.on('messages.upsert', async (m) => {
        await botService.handleMessage(this, m);
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

  async sendImageMessage(to, imageBuffer, caption = '') {
    if (this.status !== 'connected' || !this.sock) {
      throw new Error('WhatsApp tidak terkoneksi saat ini');
    }

    const jid = to.includes('@') ? to : this.formatJid(to);
    if (!jid) throw new Error('Format nomor tujuan tidak valid');

    return await this.sock.sendMessage(jid, {
      image: imageBuffer,
      caption: caption || ''
    });
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
