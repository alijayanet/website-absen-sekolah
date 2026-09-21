const bcrypt = require('bcryptjs');
const db = require('./db');

function seedDatabase() {
  console.log('Seeding database...');

  // 1. Default Settings
  const defaultSettings = [
    ['school_name', 'SMA Negeri 1 Prestasi'],
    ['school_tagline', 'Membentuk Generasi Unggul, Cerdas, dan Berakhlak Mulia'],
    ['school_description', 'Sistem Informasi & Absensi Kehadiran Siswa Real-Time Terintegrasi Notifikasi WhatsApp dan Kartu Pintar RFID/QR.'],
    ['school_address', 'Jl. Pendidikan No. 45, Kota Harapan Bangsa'],
    ['school_phone', '0812-3456-7890'],
    ['school_email', 'info@sman1prestasi.sch.id'],
    ['school_logo', ''],
    ['school_hero_image', ''],
    ['school_accreditation', 'Terakreditasi A (Unggul)'],
    ['school_principal_name', 'Drs. H. Mulyadi, M.Pd'],
    ['school_principal_nip', '19720315 199802 1 002'],
    ['school_principal_welcome', 'Selamat datang di website resmi SMA Negeri 1 Prestasi. Kami berkomitmen menyelenggarakan pendidikan berkualitas yang memadukan keunggulan akademik, pembentukan karakter luhur, dan pemanfaatan teknologi digital modern. Melalui portal ini, kami membuka pintu transparansi dan kolaborasi yang erat antara sekolah dan seluruh orang tua/wali murid demi masa depan gemilang putra-putri kita.'],
    ['school_principal_photo', ''],
    ['school_principal_signature', ''],
    ['school_principal_stamp', ''],
    ['card_issue_city', 'Cirebon'],
    ['card_issue_date', '15 Juli 2026'],
    ['school_vision', 'Mewujudkan insan cendekia yang beriman, berakhlak mulia, berprestasi unggul di tingkat nasional, serta adaptif terhadap perkembangan teknologi modern.'],
    ['school_mission', '1. Menyelenggarakan proses pembelajaran inovatif berbasis teknologi digital.\n2. Menumbuhkan nilai integritas, kedisiplinan, dan budi pekerti luhur.\n3. Mengembangkan sarana prasarana sekolah pintar (Smart School) ramah lingkungan.\n4. Membangun kemitraan harmonis dan transparan dengan orang tua siswa.'],
    ['school_stats_teachers', '48 Guru & Staf'],
    ['school_stats_graduates', '100% Lulusan'],
    ['announcement_title', 'Kedisiplinan Kehadiran & Tata Tertib Sekolah'],
    ['announcement_content', 'Pintu gerbang sekolah ditutup pada pukul 07.15 WIB. Siswa yang hadir setelah pukul 07.00 WIB tercatat terlambat. Wali murid dimohon menyimpan kontak WhatsApp sekolah agar notifikasi harian dapat diterima.'],
    ['jam_masuk', '07:00'],
    ['toleransi_telat', '07:15'],
    ['jam_cutoff_alpa', '07:30'],
    ['hari_aktif', 'Senin – Jumat'],
    ['wa_auto_teacher_summary', '0'],
    ['jam_rekap_guru', '09:00'],
    ['last_auto_teacher_summary_date', ''],
    ['wa_enabled', '1'],
    ['wa_template_absen', 'Assalamu’alaikum Wr. Wb.\nYth. Bapak/Ibu Wali Murid dari *{nama_siswa}* (Kelas {kelas}),\n\nDiberitahukan bahwa ananda telah melakukan absensi di sekolah:\n📅 Tanggal: {tanggal}\n⏰ Pukul: {jam} WIB\n📌 Status: *{status}*{keterangan_telat}\n\nTerima kasih atas kerja samanya.\n_Sistem Absensi {nama_sekolah}_'],
    ['wa_template_intro', 'Assalamu’alaikum Wr. Wb.\nYth. Bapak/Ibu Wali Murid dari *{nama_siswa}* (Kelas {kelas}),\n\nIni adalah nomor layanan resmi bot absensi & informasi kehadiran dari *{nama_sekolah}*.\n\n⚠️ *MOHON LAKUKAN LANGKAH BERIKUT:*\n1. *SIMPAN NOMOR INI* di kontak HP Anda (beri nama: *Absensi {nama_sekolah}*).\n2. *BALAS PESAN INI* dengan mengetik kata *YA* agar nomor Anda terverifikasi di sistem kami dan laporan kehadiran harian ananda dapat otomatis terkirim.\n\nTerima kasih atas kerja samanya.\nWassalamu’alaikum Wr. Wb.'],
    ['wa_template_alpa', 'Assalamu’alaikum Wr. Wb.\nYth. Bapak/Ibu Wali Murid dari *{nama_siswa}* (Kelas {kelas}),\n\nHingga pukul {jam} WIB hari ini ({tanggal}), ananda *belum tercatat melakukan absensi masuk* di sekolah (Status: *ALPA / Belum Hadir*).\n\nApabila ananda berhalangan hadir dikarenakan sakit atau izin keluarga, mohon segera konfirmasi kepada Wali Kelas.\n\nTerima kasih.\n_Sistem Absensi {nama_sekolah}_']
  ];

  const insertSetting = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  const setMany = db.transaction((settings) => {
    for (const [key, val] of settings) {
      insertSetting.run(key, val);
    }
  });
  setMany(defaultSettings);

  // Default Gallery items jika belum ada
  const galleryCount = db.prepare('SELECT COUNT(*) as c FROM school_gallery').get()?.c || 0;
  if (galleryCount === 0) {
    const insertGallery = db.prepare('INSERT INTO school_gallery (title, category, image_url, description) VALUES (?, ?, ?, ?)');
    insertGallery.run('Gedung & Lapangan Utama Sekolah', 'Fasilitas', '', 'Lingkungan belajar yang asri, hijau, dan representatif untuk mendukung kenyamanan belajar siswa.');
    insertGallery.run('Laboratorium Komputer & Riset IT', 'Fasilitas', '', 'Dilengkapi komputer modern dan koneksi internet cepat untuk pembelajaran informatika.');
    insertGallery.run('Perpustakaan & Ruang Baca Digital', 'Fasilitas', '', 'Koleksi buku lengkap serta akses e-book untuk menumbuhkan minat literasi peserta didik.');
    insertGallery.run('Kegiatan Ekstrakurikuler & Pembinaan Bakat', 'Kegiatan', '', 'Pengembangan potensi siswa di bidang sains, olahraga, seni budaya, dan kepemimpinan.');
  }

  // 2. Default Classes
  const defaultClasses = [
    { name: 'X IPA 1', level: '10' },
    { name: 'X IPA 2', level: '10' },
    { name: 'XI IPA 1', level: '11' },
    { name: 'XII IPA 1', level: '12' }
  ];

  const insertClass = db.prepare('INSERT OR IGNORE INTO classes (name, level) VALUES (?, ?)');
  for (const c of defaultClasses) {
    insertClass.run(c.name, c.level);
  }

  // 3. Default Users (Admin & Guru)
  const salt = bcrypt.genSaltSync(10);
  const adminPassword = bcrypt.hashSync('admin123', salt);
  const guruPassword = bcrypt.hashSync('guru123', salt);

  const insertUser = db.prepare('INSERT OR IGNORE INTO users (username, password_hash, name, phone, role, class_id) VALUES (?, ?, ?, ?, ?, ?)');
  insertUser.run('admin', adminPassword, 'Administrator Sekolah', '081234567890', 'admin', null);
  
  const classRow = db.prepare('SELECT id FROM classes WHERE name = ?').get('X IPA 1');
  const classId = classRow ? classRow.id : null;
  insertUser.run('guru_ipa1', guruPassword, 'Budi Santoso, S.Pd', '081947215703', 'guru', classId);

  // 4. Sample Students
  if (classId) {
    const sampleStudents = [
      {
        nis: '1001',
        nisn: '0051234501',
        rfid_uid: 'RFID1001',
        qr_code_token: 'QR-1001-XIPA1',
        name: 'Ahmad Fauzi',
        gender: 'L',
        class_id: classId,
        parent_name: 'H. Suryanto',
        parent_phone: '081234567890'
      },
      {
        nis: '1002',
        nisn: '0051234502',
        rfid_uid: 'RFID1002',
        qr_code_token: 'QR-1002-XIPA1',
        name: 'Siti Nurhaliza',
        gender: 'P',
        class_id: classId,
        parent_name: 'Ibu Rahmawati',
        parent_phone: '081234567891'
      },
      {
        nis: '1003',
        nisn: '0051234503',
        rfid_uid: 'RFID1003',
        qr_code_token: 'QR-1003-XIPA1',
        name: 'Dimas Aditya',
        gender: 'L',
        class_id: classId,
        parent_name: 'Bapak Gunawan',
        parent_phone: '081234567892'
      }
    ];

    const insertStudent = db.prepare(`
      INSERT OR IGNORE INTO students 
      (nis, nisn, rfid_uid, qr_code_token, name, gender, class_id, parent_name, parent_phone, wa_status) 
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unverified')
    `);

    for (const s of sampleStudents) {
      insertStudent.run(s.nis, s.nisn, s.rfid_uid, s.qr_code_token, s.name, s.gender, s.class_id, s.parent_name, s.parent_phone);
    }
  }

  console.log('Database seeded successfully!');
  console.log('Login default:');
  console.log('Admin: username = admin, password = admin123');
  console.log('Guru:  username = guru_ipa1, password = guru123');
}

if (require.main === module) {
  seedDatabase();
}

module.exports = seedDatabase;
