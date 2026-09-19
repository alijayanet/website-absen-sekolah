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
