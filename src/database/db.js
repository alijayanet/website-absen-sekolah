const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('../config');

// Pastikan direktori data & uploads tersedia
const dataDir = path.dirname(config.dbPath);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(config.baileysAuthPath)) fs.mkdirSync(config.baileysAuthPath, { recursive: true });
if (!fs.existsSync(config.photosPath)) fs.mkdirSync(config.photosPath, { recursive: true });
if (!fs.existsSync(config.logosPath)) fs.mkdirSync(config.logosPath, { recursive: true });
if (!fs.existsSync(config.galleryPath)) fs.mkdirSync(config.galleryPath, { recursive: true });
if (!fs.existsSync(config.bannersPath)) fs.mkdirSync(config.bannersPath, { recursive: true });
if (!fs.existsSync(config.lettersPath)) fs.mkdirSync(config.lettersPath, { recursive: true });
if (!fs.existsSync(config.qrisPath)) fs.mkdirSync(config.qrisPath, { recursive: true });

// Buka koneksi database SQLite dengan better-sqlite3
const db = new Database(config.dbPath);

// Konfigurasi performa tinggi WAL mode
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('cache_size = -16000'); // 16MB cache

// Inisialisasi skema tabel jika belum ada
const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

// Migrasi skema: Tambah kolom phone pada users jika belum ada
try {
  db.prepare('ALTER TABLE users ADD COLUMN phone TEXT').run();
} catch (e) {
  // Kolom sudah ada
}

// Migrasi skema: Tambah kolom frequency pada fee_categories jika belum ada
try {
  db.prepare("ALTER TABLE fee_categories ADD COLUMN frequency TEXT DEFAULT 'ONCE'").run();
} catch (e) {
  // Kolom sudah ada
}

// Sinkronisasi data frekuensi kategori
try {
  db.prepare("UPDATE fee_categories SET frequency = 'MONTHLY' WHERE is_monthly = 1 AND (frequency IS NULL OR frequency = 'ONCE')").run();
  db.prepare("UPDATE fee_categories SET frequency = 'WEEKLY' WHERE is_monthly = 2").run();
} catch (e) {
  // Abaikan
}

// Migrasi skema: Tambah kolom savings_balance pada students jika belum ada
try {
  db.prepare('ALTER TABLE students ADD COLUMN savings_balance INTEGER DEFAULT 0').run();
} catch (e) {
  // Kolom sudah ada
}

// Migrasi skema: Buat tabel student_savings jika belum ada
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS student_savings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
      teacher_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
      type TEXT NOT NULL CHECK(type IN ('SETOR', 'TARIK')),
      amount INTEGER NOT NULL CHECK(amount > 0),
      balance_after INTEGER NOT NULL DEFAULT 0,
      transaction_date DATE NOT NULL DEFAULT CURRENT_DATE,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_savings_student ON student_savings(student_id);
    CREATE INDEX IF NOT EXISTS idx_savings_teacher ON student_savings(teacher_id);
    CREATE INDEX IF NOT EXISTS idx_savings_class ON student_savings(class_id);
    CREATE INDEX IF NOT EXISTS idx_savings_date ON student_savings(transaction_date);
  `);
} catch (e) {
  // Abaikan jika sudah ada
}

// Inisialisasi Kategori Tagihan Default jika belum ada
const defaultCategories = [
  { code: 'SPP', name: 'SPP Bulanan', default_amount: 150000, frequency: 'MONTHLY', is_monthly: 1 },
  { code: 'KAS_MINGGUAN', name: 'Uang Kas Mingguan', default_amount: 5000, frequency: 'WEEKLY', is_monthly: 2 },
  { code: 'GEDUNG', name: 'Uang Pangkal / Sarana Gedung', default_amount: 1000000, frequency: 'ONCE', is_monthly: 0 },
  { code: 'UJIAN', name: 'Biaya Ujian Semester (PAS/PTS)', default_amount: 100000, frequency: 'ONCE', is_monthly: 0 },
  { code: 'DAFTAR_ULANG', name: 'Daftar Ulang Tahun Ajaran Baru', default_amount: 250000, frequency: 'ONCE', is_monthly: 0 },
  { code: 'SERAGAM', name: 'Seragam & Atribut Sekolah', default_amount: 350000, frequency: 'ONCE', is_monthly: 0 },
  { code: 'LAINNYA', name: 'Biaya Khusus / Ekstrakurikuler', default_amount: 50000, frequency: 'ONCE', is_monthly: 0 }
];

const checkCategory = db.prepare('SELECT id FROM fee_categories WHERE code = ?');
const insertCategory = db.prepare('INSERT INTO fee_categories (code, name, default_amount, frequency, is_monthly) VALUES (?, ?, ?, ?, ?)');
for (const cat of defaultCategories) {
  if (!checkCategory.get(cat.code)) {
    insertCategory.run(cat.code, cat.name, cat.default_amount, cat.frequency || 'ONCE', cat.is_monthly);
  }
}

// Inisialisasi Pengaturan Keuangan Default
const defaultSettings = [
  { key: 'qris_static_payload', value: '00020101021126570011ID.DANA.WWW011893600915346519740402094651974040303UMI51440014ID.CO.QRIS.WWW0215ID10232708012520303UMI5204549953033605802ID5907ALIJAYA6014Kab. Indramayu6105452576304E962' },
  { key: 'qris_merchant_name', value: 'SMK Teladan Jakarta' },
  { key: 'qris_static_enabled', value: '1' },
  { key: 'payment_gateway_secret', value: 'absensi-sekolah-gateway-secret' }
];

const checkSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
const upsertSetting = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE value = \'\' OR value IS NULL');
for (const set of defaultSettings) {
  upsertSetting.run(set.key, set.value);
}

module.exports = db;
