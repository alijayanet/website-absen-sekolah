-- Skema Database SQLite untuk Sistem Absensi Sekolah

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  level TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT,
  role TEXT NOT NULL CHECK(role IN ('admin', 'guru')),
  class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nis TEXT UNIQUE NOT NULL,
  nisn TEXT,
  rfid_uid TEXT,
  qr_code_token TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  gender TEXT CHECK(gender IN ('L', 'P')),
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  parent_name TEXT,
  parent_phone TEXT,
  photo TEXT,
  wa_status TEXT DEFAULT 'unverified' CHECK(wa_status IN ('unverified', 'intro_sent', 'confirmed')),
  wa_intro_sent_at DATETIME,
  wa_confirmed_at DATETIME,
  savings_balance INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_students_nis ON students(nis);
CREATE INDEX IF NOT EXISTS idx_students_nisn ON students(nisn);
CREATE INDEX IF NOT EXISTS idx_students_rfid ON students(rfid_uid);
CREATE INDEX IF NOT EXISTS idx_students_qr ON students(qr_code_token);
CREATE INDEX IF NOT EXISTS idx_students_parent_phone ON students(parent_phone);

CREATE TABLE IF NOT EXISTS attendances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  date TEXT NOT NULL, -- Format: YYYY-MM-DD
  time_in TEXT NOT NULL, -- Format: HH:mm:ss
  status TEXT NOT NULL CHECK(status IN ('HADIR', 'TERLAMBAT', 'IZIN', 'SAKIT', 'ALPA')),
  late_minutes INTEGER DEFAULT 0,
  notes TEXT,
  created_by TEXT DEFAULT 'SYSTEM',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(student_id, date)
);

CREATE INDEX IF NOT EXISTS idx_attendances_date ON attendances(date);
CREATE INDEX IF NOT EXISTS idx_attendances_student_date ON attendances(student_id, date);

CREATE TABLE IF NOT EXISTS wa_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
  type TEXT DEFAULT 'ATTENDANCE', -- 'ATTENDANCE', 'INTRO', 'ALPA', 'CUSTOM'
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'sending', 'sent', 'failed')),
  attempts INTEGER DEFAULT 0,
  error_message TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_wa_queue_status ON wa_queue(status);

CREATE TABLE IF NOT EXISTS school_gallery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  category TEXT DEFAULT 'Fasilitas', -- 'Fasilitas', 'Kegiatan', 'Prestasi'
  image_url TEXT NOT NULL,
  description TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('SAKIT', 'IZIN')),
  start_date TEXT NOT NULL, -- Format: YYYY-MM-DD
  end_date TEXT NOT NULL,   -- Format: YYYY-MM-DD
  reason TEXT NOT NULL,
  attachment TEXT,          -- Path file surat dokter / bukti izin (/uploads/letters/...)
  parent_phone_last4 TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'APPROVED', 'REJECTED')),
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at DATETIME,
  rejection_note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_student ON leave_requests(student_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_date ON leave_requests(start_date, end_date);

-- Modul Keuangan, Tagihan SPP & Integrasi QRIS Dinamis

CREATE TABLE IF NOT EXISTS fee_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,       -- 'SPP', 'GEDUNG', 'UJIAN', 'DAFTAR_ULANG', 'SERAGAM', 'LAINNYA', 'KAS_MINGGUAN'
  name TEXT NOT NULL,              -- 'SPP Bulanan', 'Uang Gedung', dll
  default_amount INTEGER DEFAULT 0,
  frequency TEXT DEFAULT 'ONCE',   -- 'MONTHLY' (Bulanan), 'WEEKLY' (Mingguan), 'ONCE' (Sekali Bayar)
  is_monthly INTEGER DEFAULT 0,    -- 1 jika bulanan, 2 jika mingguan, 0 jika sekali bayar (kompatibilitas)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS student_bills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bill_code TEXT UNIQUE NOT NULL,  -- 'INV-202609-0001'
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  category_id INTEGER NOT NULL REFERENCES fee_categories(id) ON DELETE CASCADE,
  title TEXT NOT NULL,             -- 'SPP September 2026'
  period TEXT,                     -- '2026-09' untuk bulanan, NULL untuk non-bulanan
  base_amount INTEGER NOT NULL,    -- Contoh: 150000
  unique_code INTEGER DEFAULT 0,   -- Contoh: 247
  total_amount INTEGER NOT NULL,   -- Contoh: 150247
  status TEXT DEFAULT 'UNPAID' CHECK(status IN ('UNPAID', 'PAID', 'CANCELLED')),
  due_date TEXT,                   -- 'YYYY-MM-DD'
  notes TEXT,
  paid_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_student_bills_student ON student_bills(student_id);
CREATE INDEX IF NOT EXISTS idx_student_bills_status ON student_bills(status);
CREATE INDEX IF NOT EXISTS idx_student_bills_total ON student_bills(total_amount);
CREATE INDEX IF NOT EXISTS idx_student_bills_period ON student_bills(period);

CREATE TABLE IF NOT EXISTS payment_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no TEXT UNIQUE NOT NULL, -- 'RCP-20260920-0001'
  bill_id INTEGER NOT NULL REFERENCES student_bills(id) ON DELETE CASCADE,
  amount_paid INTEGER NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'QRIS' CHECK(payment_method IN ('QRIS', 'CASH', 'TRANSFER')),
  payment_channel TEXT,            -- 'BCA / Gopay / MacroDroid Webhook' atau 'Kasir TU'
  reference_note TEXT,
  received_by TEXT DEFAULT 'SYSTEM',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_receipts_bill ON payment_receipts(bill_id);
CREATE INDEX IF NOT EXISTS idx_payment_receipts_date ON payment_receipts(created_at);

CREATE TABLE IF NOT EXISTS webhook_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT,
  ref_id TEXT,
  status TEXT,
  payload TEXT,
  ip TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_webhook_logs_created ON webhook_logs(created_at);

-- Modul Tabungan Siswa (Student Savings) per Guru & Rombel
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
