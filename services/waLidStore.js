const fs = require('fs');
const path = require('path');

/**
 * WaLidStore
 * Menyimpan pemetaan JID (@lid atau @s.whatsapp.net) -> Nomor HP WhatsApp resmi (format 628xxx).
 * Diadaptasi dari rujukan D:\billing-rtrw-radius\services\waLidStore.js
 * Diperlukan karena WhatsApp Privacy mode sering mengirimkan pengirim sebagai ...@lid bukan nomor HP asli.
 */
class WaLidStore {
  constructor(filePath) {
    this.filePath = filePath || path.join(__dirname, '../../data/wa-lid-map.json');
    this.map = Object.create(null);
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
        this.map = raw && typeof raw === 'object' ? raw : Object.create(null);
      }
    } catch (e) {
      this.map = Object.create(null);
    }
  }

  _save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.map, null, 2), 'utf8');
    } catch (e) {
      console.warn('[WaLidStore] Gagal menyimpan map ke disk:', e.message);
    }
  }

  get(jid) {
    if (!jid || typeof jid !== 'string') return null;
    const v = this.map[jid.toLowerCase()];
    return v != null ? String(v) : null;
  }

  set(jid, phone) {
    if (!jid || phone == null || phone === '') return;
    const cleanPhone = String(phone).replace(/\D/g, '');
    if (!cleanPhone) return;
    const normalized = cleanPhone.startsWith('0') ? '62' + cleanPhone.slice(1) : cleanPhone;
    
    this.map[jid.toLowerCase()] = normalized;
    // Simpan juga versi tanpa @lid jika ada @lid
    if (jid.includes('@')) {
      const userPart = jid.split('@')[0].toLowerCase();
      this.map[userPart] = normalized;
    }
    this._save();
  }

  /** Cari JID/LID berdasarkan nomor HP (reverse lookup) */
  getByPhone(phone) {
    if (!phone) return null;
    const clean = String(phone).replace(/\D/g, '');
    const norm = clean.startsWith('0') ? '62' + clean.slice(1) : clean;
    for (const [jid, val] of Object.entries(this.map)) {
      if (val === norm && jid.endsWith('@lid')) {
        return jid;
      }
    }
    for (const [jid, val] of Object.entries(this.map)) {
      if (val === norm) {
        return jid;
      }
    }
    return null;
  }
}

const defaultLidStore = new WaLidStore();

module.exports = {
  WaLidStore,
  waLidStore: defaultLidStore
};
