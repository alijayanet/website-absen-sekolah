const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, Browsers } = require('@whiskeysockets/baileys');
const pino = require('pino');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const db = require('../database/db');
const botService = require('./bot');

const { waLidStore } = require('./waLidStore');

// Cache Store Berkinerja Tinggi untuk Baileys Signal Keys & Retries (Anti 'Waiting for this message')
class BaileysCacheStore {
  constructor(ttlMs = 600000, maxSize = 5000) {
    this.cache = new Map();
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
  }
  get(key) {
    const item = this.cache.get(key);
    if (!item) return undefined;
    if (Date.now() - item.time > this.ttlMs) {
      this.cache.delete(key);
      return undefined;
    }
    return item.val;
  }
  set(key, val) {
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    this.cache.set(key, { val, time: Date.now() });
  }
  del(key) {
    this.cache.delete(key);
  }
  flushAll() {
    this.cache.clear();
  }
}

// Multi-Layer Message Store (Memory LRU + Database Fallback) untuk menangani permintaan retry dekripsi WhatsApp
class MultiLayerMessageStore {
  constructor(maxSize = 5000) {
    this.store = new Map();
    this.maxSize = maxSize;
  }

  cache(key, message) {
    if (!key || !key.id || !message) return;
    const msgId = String(key.id);
    const remote = String(key.remoteJid || '');
    const combinedKey = `${remote}:${msgId}`;

    let protoMsg = message;
    if (message.message) protoMsg = message.message;

    this.store.set(combinedKey, protoMsg);
    this.store.set(msgId, protoMsg);

    if (this.store.size > this.maxSize * 2) {
      const keysToDelete = Array.from(this.store.keys()).slice(0, 500);
      for (const k of keysToDelete) this.store.delete(k);
    }
  }

  async get(key) {
    if (!key || !key.id) return undefined;
    const msgId = String(key.id);
    const remote = String(key.remoteJid || '');
    const combinedKey = `${remote}:${msgId}`;

    if (this.store.has(combinedKey)) {
      return this.store.get(combinedKey);
    }
    if (this.store.has(msgId)) {
      return this.store.get(msgId);
    }

    for (const [k, v] of this.store.entries()) {
      if (k.endsWith(`:${msgId}`) || k === msgId) {
        return v;
      }
    }

    // Database Fallback dari wa_queue jika ada
    try {
      const row = db.prepare('SELECT message FROM wa_queue WHERE phone LIKE ? ORDER BY id DESC LIMIT 1').get(`%${remote.split('@')[0]}%`);
      if (row && row.message) {
        return { conversation: row.message };
      }
    } catch (_) {}

    return undefined;
  }
}

/**
 * Membersihkan file session dan pre-key usang jika terjadi Bad MAC desync
 * tanpa menghapus creds.json (tidak perlu scan QR ulang)
 */
function cleanStaleSessionKeys(authFolder) {
  try {
    const folder = authFolder || config.baileysAuthPath;
    if (!fs.existsSync(folder)) return 0;
    const files = fs.readdirSync(folder);
    let cleaned = 0;
    for (const f of files) {
      if (f.startsWith('session-') || f.startsWith('pre-key-') || f.startsWith('sender-key-') || f.startsWith('app-state-sync-')) {
        try {
          fs.unlinkSync(path.join(folder, f));
          cleaned++;
        } catch (_) {}
      }
    }
    console.log(`[WA Session Auto-Repair] Membersihkan ${cleaned} session/pre-key usang (creds.json tetap dipertahankan).`);
    return cleaned;
  } catch (err) {
    console.warn(`[WA Session Auto-Repair] Gagal membersihkan session keys: ${err.message}`);
    return 0;
  }
}

let authLidReverse = new Map();

function loadAuthLidReverseMap(authFolder) {
  try {
    const folder = authFolder || config.baileysAuthPath;
    if (!fs.existsSync(folder)) return;
    const files = fs.readdirSync(folder);
    const next = new Map();
    for (const f of files) {
      const forward = /^lid-mapping-(\d+)\.json$/i.exec(f);
      const reverse = /^lid-mapping-(\d+)_reverse\.json$/i.exec(f);
      if (!forward && !reverse) continue;

      const raw = fs.readFileSync(path.join(folder, f), 'utf8');
      let value = null;
      try {
        value = JSON.parse(raw);
      } catch (e) {
        value = String(raw || '').trim().replace(/^"|"$/g, '');
      }

      if (forward) {
        let phoneDigits = forward[1].replace(/\D/g, '');
        if (phoneDigits.startsWith('0')) phoneDigits = '62' + phoneDigits.slice(1);
        else if (phoneDigits.startsWith('8')) phoneDigits = '62' + phoneDigits;
        const lidDigits = String(value || '').replace(/\D/g, '');
        if (!phoneDigits || !lidDigits) continue;
        next.set(lidDigits + '@lid', phoneDigits);
        next.set(lidDigits, phoneDigits);
        continue;
      }

      if (reverse) {
        const lidDigits = String(reverse[1] || '').replace(/\D/g, '');
        let phoneDigits = String(value || '').replace(/\D/g, '');
        if (phoneDigits.startsWith('0')) phoneDigits = '62' + phoneDigits.slice(1);
        else if (phoneDigits.startsWith('8')) phoneDigits = '62' + phoneDigits;
        if (!phoneDigits || !lidDigits) continue;
        next.set(lidDigits + '@lid', phoneDigits);
        next.set(lidDigits, phoneDigits);
        continue;
      }
    }
    authLidReverse = next;
    if (authLidReverse.size > 0) {
      console.log(`[WA LID Reverse Map] Memuat ${authLidReverse.size} pemetaan LID otomatis dari folder auth.`);
    }
  } catch (e) {
    console.warn(`[WA LID Reverse Map] Gagal memuat auth lid reverse map: ${e.message}`);
  }
}

class WhatsAppService {
  constructor() {
    this.sock = null;
    this.status = 'disconnected'; // 'disconnected' | 'connecting' | 'qr_ready' | 'connected'
    this.qrCodeDataUrl = null;
    this.userJid = null;
    this.isInitializing = false;
    this.waLidStore = waLidStore;

    // Cache stores
    this.msgRetryCounterCache = new BaileysCacheStore(600000);
    this.userDevicesCache = new BaileysCacheStore(3600000);
    this.placeholderResendCache = new BaileysCacheStore(600000);
    this.messageStore = new MultiLayerMessageStore(5000);
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
            authLidReverse.set(lidJid, formatted);
            authLidReverse.set(lidUser, formatted);

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

      // 3a. Cek authLidReverse
      const fromAuth = authLidReverse.get(lidJid) || authLidReverse.get(lidUser);
      if (fromAuth) return fromAuth;

      // 3b. Cek waLidStore cache
      const cached = waLidStore.get(lidJid) || waLidStore.get(lidUser);
      if (cached) {
        return cached.replace(/\D/g, '');
      }

      // 3c. Cek signalRepository jika ada (Baileys v7)
      if (this.sock?.signalRepository?.lidMapping?.getPNForLID) {
        try {
          const pnjid = await this.sock.signalRepository.lidMapping.getPNForLID(lidJid);
          if (pnjid && pnjid.endsWith('@s.whatsapp.net')) {
            const p = pnjid.split('@')[0].replace(/\D/g, '');
            waLidStore.set(lidJid, p);
            waLidStore.set(lidUser, p);
            authLidReverse.set(lidJid, p);
            authLidReverse.set(lidUser, p);
            return p;
          }
        } catch (e) {}
      }

      // 3d. Cek kecocokan session di auth folder (remoteIdentityKey)
      try {
        const matchPhone = this.findPhoneByLidInAuth(lidUser);
        if (matchPhone) {
          waLidStore.set(lidJid, matchPhone);
          waLidStore.set(lidUser, matchPhone);
          authLidReverse.set(lidJid, matchPhone);
          authLidReverse.set(lidUser, matchPhone);
          console.log(`[WhatsApp LID] Ditemukan dari Auth Session: ${lidUser} -> ${matchPhone}`);
          return matchPhone;
        }
      } catch (e) {}

      // 3e. Coba on-demand pre-resolve terhadap seluruh nomor di database
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

  // Pembersihan manual session/pre-keys usang tanpa hapus creds.json
  cleanStaleSessionKeys(doReconnect = true) {
    const cleaned = cleanStaleSessionKeys(config.baileysAuthPath);
    if (doReconnect) {
      this.reconnect();
    }
    return cleaned;
  }

  async initWhatsApp() {
    if (this.isInitializing) return;
    this.isInitializing = true;
    this.status = 'connecting';

    try {
      const { state, saveCreds } = await useMultiFileAuthState(config.baileysAuthPath);
      loadAuthLidReverseMap(config.baileysAuthPath);

      let version = [2, 3000, 1043857760]; // Modern WhatsApp Web version fallback
      try {
        const latest = await fetchLatestBaileysVersion();
        if (latest && latest.version) {
          version = latest.version;
        }
      } catch (err) {
        console.warn(`[WhatsApp] Gagal mengambil versi terbaru Baileys (${err.message}). Menggunakan fallback.`);
      }

      this.sock = makeWASocket({
        version,
        auth: state,
        browser: Browsers.ubuntu('Chrome'),
        syncFullHistory: false,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: false,
        msgRetryCounterCache: this.msgRetryCounterCache,
        userDevicesCache: this.userDevicesCache,
        placeholderResendCache: this.placeholderResendCache,
        retryRequestDelayMs: 250,
        maxMsgRetryCount: 5,
        keepAliveIntervalMs: 30000,
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        appStateMacVerification: {
          patch: false,
          snapshot: false
        },
        patchMessageBeforeSending: (message) => {
          const requiresPatch = !!(
            message.buttonsMessage ||
            message.templateMessage ||
            message.listMessage
          );
          if (requiresPatch) {
            message = {
              viewOnceMessage: {
                message: {
                  messageContextInfo: {
                    deviceListMetadataVersion: 2,
                    deviceListMetadata: {},
                  },
                  ...message,
                },
              },
            };
          }
          return message;
        },
        getMessage: async (key) => {
          return await this.messageStore.get(key);
        },
        logger: pino({ level: 'silent' }),
        printQRInTerminal: false
      });

      this.sock.ev.on('creds.update', () => {
        saveCreds();
        loadAuthLidReverseMap(config.baileysAuthPath);
      });

      // Sinkronisasi Kontak Masuk untuk Pemetaan LID Real-Time
      this.sock.ev.on('contacts.upsert', (contacts) => {
        for (const contact of contacts) {
          if (contact.id && contact.id.endsWith('@lid') && contact.phoneNumber) {
            let digits = String(contact.phoneNumber).replace(/\D/g, '');
            if (digits.startsWith('0')) digits = '62' + digits.slice(1);
            else if (digits.startsWith('8')) digits = '62' + digits;
            this.waLidStore.set(contact.id, digits);
            authLidReverse.set(contact.id, digits);
            authLidReverse.set(contact.id.split('@')[0], digits);
          }
        }
      });

      this.sock.ev.on('messaging-history.set', ({ contacts }) => {
        if (contacts) {
          for (const contact of contacts) {
            if (contact.id && contact.id.endsWith('@lid') && contact.phoneNumber) {
              let digits = String(contact.phoneNumber).replace(/\D/g, '');
              if (digits.startsWith('0')) digits = '62' + digits.slice(1);
              else if (digits.startsWith('8')) digits = '62' + digits;
              this.waLidStore.set(contact.id, digits);
              authLidReverse.set(contact.id, digits);
              authLidReverse.set(contact.id.split('@')[0], digits);
            }
          }
        }
      });

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
          const errorMsg = lastDisconnect?.error?.message || '';
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
          this.status = 'disconnected';
          this.qrCodeDataUrl = null;
          this.userJid = null;

          // Auto-repair jika terjadi desinkronisasi sesi / Bad MAC
          const isBadMac = errorMsg.includes('Bad MAC') || errorMsg.includes('MAC mismatch') || statusCode === 401;
          if (isBadMac && statusCode !== DisconnectReason.loggedOut) {
            console.warn(`[WhatsApp Auto-Repair] Terdeteksi desinkronisasi sesi/Bad MAC (${errorMsg}). Membersihkan pre-key usang...`);
            cleanStaleSessionKeys(config.baileysAuthPath);
          }

          console.log(`[WhatsApp] Koneksi terputus (Status: ${statusCode}, Msg: ${errorMsg}). Reconnect: ${shouldReconnect}`);

          if (shouldReconnect) {
            const delay = statusCode === DisconnectReason.restartRequired ? 500 : 3000;
            setTimeout(() => {
              this.isInitializing = false;
              this.initWhatsApp();
            }, delay);
          } else {
            this.isInitializing = false;
            // Jika logout resmi, bersihkan direktori sesi
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

      // Tangani Pesan Masuk via Bot Service & Cache ke MessageStore
      this.sock.ev.on('messages.upsert', async (m) => {
        if (m.messages) {
          for (const msg of m.messages) {
            if (msg.key && msg.message) {
              this.messageStore.cache(msg.key, msg.message);
            }
          }
        }
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

    const result = await this.sock.sendMessage(jid, { text: message });
    if (result && result.key && result.message) {
      this.messageStore.cache(result.key, result.message);
    }
    return result;
  }

  async sendImageMessage(to, imageBuffer, caption = '') {
    if (this.status !== 'connected' || !this.sock) {
      throw new Error('WhatsApp tidak terkoneksi saat ini');
    }

    const jid = to.includes('@') ? to : this.formatJid(to);
    if (!jid) throw new Error('Format nomor tujuan tidak valid');

    const result = await this.sock.sendMessage(jid, {
      image: imageBuffer,
      caption: caption || ''
    });
    if (result && result.key && result.message) {
      this.messageStore.cache(result.key, result.message);
    }
    return result;
  }

  async sendDocumentMessage(to, documentBuffer, filename = 'Dokumen.pdf', caption = '', mimetype = 'application/pdf') {
    if (this.status !== 'connected' || !this.sock) {
      throw new Error('WhatsApp tidak terkoneksi saat ini');
    }

    const jid = to.includes('@') ? to : this.formatJid(to);
    if (!jid) throw new Error('Format nomor tujuan tidak valid');

    const result = await this.sock.sendMessage(jid, {
      document: documentBuffer,
      fileName: filename,
      mimetype: mimetype || 'application/pdf',
      caption: caption || ''
    });
    if (result && result.key && result.message) {
      this.messageStore.cache(result.key, result.message);
    }
    return result;
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
