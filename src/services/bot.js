const db = require('../database/db');
const { 
  generateTeacherSummary, 
  generateMonthlyStudentSummary, 
  generateMonthlyClassSummary 
} = require('./summary');
const financeService = require('./financeService');
const savingsService = require('./savingsService');
const leaveService = require('./leaveService');
const { getTodayWIB, getTimeStringWIB } = require('../utils/timeHelper');


class BotService {
  /**
   * Bersihkan nomor telepon untuk perbandingan database
   */
  cleanPhone(phone) {
    if (!phone) return '';
    return phone.replace(/\D/g, '');
  }

  /**
   * Format nomor ke bentuk 08xxx dan 628xxx
   */
  getPhoneVariants(senderPhone) {
    let clean = this.cleanPhone(senderPhone);
    // Jika format LID (biasanya 14-16 digit) atau jika ada di waLidStore
    if (clean.length > 13) {
      try {
        const { waLidStore } = require('./waLidStore');
        const mapped = waLidStore.get(clean) || waLidStore.get(`${clean}@lid`);
        if (mapped) clean = this.cleanPhone(mapped);
      } catch (_) {}
    }
    const with0 = '0' + (clean.startsWith('62') ? clean.slice(2) : clean);
    const with62 = clean.startsWith('0') ? '62' + clean.slice(1) : (clean.startsWith('62') ? clean : '62' + clean);
    return { clean, with0, with62 };
  }

  /**
   * Cari data Guru / Wali Kelas berdasarkan nomor WhatsApp pengirim
   */
  findTeacher(senderPhone) {
    const { with0, with62 } = this.getPhoneVariants(senderPhone);
    return db.prepare(`
      SELECT u.*, c.name as class_name, c.id as class_id
      FROM users u
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE u.role = 'guru' 
        AND u.phone IS NOT NULL AND TRIM(u.phone) != ''
        AND (
          REPLACE(REPLACE(u.phone, '-', ''), ' ', '') = ? 
          OR REPLACE(REPLACE(u.phone, '-', ''), ' ', '') = ?
          OR u.phone LIKE ?
        )
      LIMIT 1
    `).get(with0, with62, `%${with0.slice(2)}%`);
  }

  /**
   * Cari data Administrator berdasarkan nomor WhatsApp pengirim
   */
  findAdmin(senderPhone) {
    const { with0, with62 } = this.getPhoneVariants(senderPhone);
    return db.prepare(`
      SELECT * FROM users
      WHERE role = 'admin' 
        AND phone IS NOT NULL AND TRIM(phone) != ''
        AND (
          REPLACE(REPLACE(phone, '-', ''), ' ', '') = ? 
          OR REPLACE(REPLACE(phone, '-', ''), ' ', '') = ?
          OR phone LIKE ?
        )
      LIMIT 1
    `).get(with0, with62, `%${with0.slice(2)}%`);
  }


  /**
   * Cari daftar siswa yang terkait dengan nomor WhatsApp orang tua pengirim
   */
  findParentStudents(senderPhone) {
    const { with0, with62 } = this.getPhoneVariants(senderPhone);
    return db.prepare(`
      SELECT s.*, c.name as class_name
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE s.is_active = 1
        AND s.parent_phone IS NOT NULL AND TRIM(s.parent_phone) != ''
        AND (
          REPLACE(REPLACE(s.parent_phone, '-', ''), ' ', '') = ? 
          OR REPLACE(REPLACE(s.parent_phone, '-', ''), ' ', '') = ?
          OR s.parent_phone LIKE ?
        )
      ORDER BY s.name ASC
    `).all(with0, with62, `%${with0.slice(2)}%`);
  }

  /**
   * Ambil pengaturan sekolah ke bentuk object
   */
  getSettings() {
    const rows = db.prepare('SELECT key, value FROM settings').all();
    const settings = {};
    for (const r of rows) settings[r.key] = r.value;
    return settings;
  }

  /**
   * Susun pesan laporan kehadiran lengkap untuk seorang siswa
   */
  buildStudentAttendanceMessage(student) {
    const settings = this.getSettings();
    const schoolName = settings.school_name || 'Sekolah';
    const today = getTodayWIB(); // YYYY-MM-DD dalam WIB

    // 1. Cek Presensi Hari Ini
    const todayAtt = db.prepare(`
      SELECT * FROM attendances WHERE student_id = ? AND date = ?
    `).get(student.id, today);

    let todayStatusText = '⏳ *Belum Hadir / Belum Melakukan Presensi Hari Ini*';
    if (todayAtt) {
      const timeStr = todayAtt.time_in ? todayAtt.time_in.slice(0, 5) + ' WIB' : '';
      if (todayAtt.status === 'HADIR') {
        todayStatusText = `✅ *Hadir Tepat Waktu* (${timeStr})`;
      } else if (todayAtt.status === 'TERLAMBAT') {
        const lateInfo = todayAtt.late_minutes ? ` (Terlambat ${todayAtt.late_minutes} menit)` : '';
        todayStatusText = `⚠️ *Hadir Terlambat* (${timeStr}${lateInfo})`;
      } else if (todayAtt.status === 'SAKIT') {
        todayStatusText = `🏥 *Sakit* (${todayAtt.notes || 'Surat Dokter / Izin Sakit'})`;
      } else if (todayAtt.status === 'IZIN') {
        todayStatusText = `📝 *Izin* (${todayAtt.notes || 'Izin Keluarga'})`;
      } else {
        todayStatusText = `❌ *Alpa / Tidak Hadir*`;
      }
    }

    // 2. Rekapitulasi Bulan Berjalan (dalam WIB)
    const todayParts = today.split('-'); // ['2026', '09', '22']
    const currentMonthPrefix = `${todayParts[0]}-${todayParts[1]}`;
    const monthName = new Date(today + 'T12:00:00Z').toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

    const stats = db.prepare(`
      SELECT 
        SUM(CASE WHEN status = 'HADIR' THEN 1 ELSE 0 END) as hadir,
        SUM(CASE WHEN status = 'TERLAMBAT' THEN 1 ELSE 0 END) as terlambat,
        SUM(CASE WHEN status = 'SAKIT' THEN 1 ELSE 0 END) as sakit,
        SUM(CASE WHEN status = 'IZIN' THEN 1 ELSE 0 END) as izin,
        SUM(CASE WHEN status = 'ALPA' THEN 1 ELSE 0 END) as alpa,
        COUNT(*) as total
      FROM attendances 
      WHERE student_id = ? AND date LIKE ?
    `).get(student.id, `${currentMonthPrefix}%`);

    const countHadir = stats?.hadir || 0;
    const countTelat = stats?.terlambat || 0;
    const countSakit = stats?.sakit || 0;
    const countIzin = stats?.izin || 0;
    const countAlpa = stats?.alpa || 0;
    const totalDays = stats?.total || 0;
    const percentage = totalDays > 0 ? Math.round(((countHadir + countTelat) / totalDays) * 100) : 0;

    // 3. Riwayat 5 Hari Terakhir
    const recentAtts = db.prepare(`
      SELECT * FROM attendances 
      WHERE student_id = ? 
      ORDER BY date DESC 
      LIMIT 5
    `).all(student.id);

    let recentText = '';
    if (recentAtts.length === 0) {
      recentText = '_(Belum ada catatan presensi)_\n';
    } else {
      recentAtts.forEach(att => {
        const dObj = new Date(att.date + 'T00:00:00');
        const dFormatted = dObj.toLocaleDateString('id-ID', { weekday: 'short', day: 'numeric', month: 'short' });
        const time = att.time_in ? att.time_in.slice(0, 5) : '-';
        let desc = att.status;
        if (att.status === 'HADIR') desc = `Hadir (${time} WIB)`;
        else if (att.status === 'TERLAMBAT') desc = `Terlambat ${att.late_minutes || 0}m (${time} WIB)`;
        else if (att.status === 'SAKIT') desc = `Sakit`;
        else if (att.status === 'IZIN') desc = `Izin`;
        else if (att.status === 'ALPA') desc = `Alpa`;

        recentText += `• ${dFormatted}: ${desc}\n`;
      });
    }

    // 4. Wali Kelas Siswa
    const waliKelas = db.prepare(`
      SELECT name, phone FROM users WHERE role = 'guru' AND class_id = ? LIMIT 1
    `).get(student.class_id);

    // Susun Format Pesan WhatsApp
    let msg = `📋 *LAPORAN KEHADIRAN SISWA*\n`;
    msg += `🏫 *${schoolName}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `👤 *Nama:* ${student.name}\n`;
    msg += `🏷️ *Kelas:* ${student.class_name || '-'}\n`;
    msg += `🆔 *NIS:* ${student.nis} • *NISN:* ${student.nisn || '-'}\n`;
    if (waliKelas) {
      msg += `👨‍🏫 *Wali Kelas:* ${waliKelas.name}\n`;
    }
    msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    msg += `📌 *STATUS HARI INI:*\n`;
    msg += `${todayStatusText}\n\n`;

    msg += `📊 *REKAP BULAN ${monthName.toUpperCase()}:*\n`;
    msg += `✅ Hadir Tepat Waktu: ${countHadir} hari\n`;
    msg += `⚠️ Hadir Terlambat: ${countTelat} hari\n`;
    msg += `📝 Izin: ${countIzin} hari\n`;
    msg += `🏥 Sakit: ${countSakit} hari\n`;
    msg += `❌ Alpa / Belum Hadir: ${countAlpa} hari\n`;
    msg += `📈 *Persentase Kehadiran: ${percentage}%*\n\n`;

    msg += `📅 *RIWAYAT 5 HARI TERAKHIR:*\n`;
    msg += recentText;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `_Ketik *MENU* untuk melihat layanan informasi lainnya._`;

    return msg;
  }

  /**
   * Susun pesan laporan status tagihan & SPP untuk seorang siswa
   */
  buildStudentBillsMessage(student) {
    const settings = this.getSettings();
    const schoolName = settings.school_name || 'Sekolah';

    const bills = db.prepare(`
      SELECT b.*, cat.name as category_name
      FROM student_bills b
      JOIN fee_categories cat ON b.category_id = cat.id
      WHERE b.student_id = ? AND b.status != 'CANCELLED'
      ORDER BY b.status ASC, b.created_at DESC
      LIMIT 10
    `).all(student.id);

    const unpaid = bills.filter(b => b.status === 'UNPAID');
    const paid = bills.filter(b => b.status === 'PAID');

    let msg = `💰 *STATUS TAGIHAN & SPP SISWA*\n`;
    msg += `🏫 *${schoolName}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `👤 *Nama:* ${student.name}\n`;
    msg += `🏷️ *Kelas:* ${student.class_name || '-'}\n`;
    msg += `🆔 *NIS:* ${student.nis}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    if (unpaid.length === 0) {
      msg += `🎉 *Alhamdulillah, tidak ada tagihan tertunggak!*\n`;
      msg += `Seluruh kewajiban pembayaran ananda telah tercatat lunas.\n\n`;
    } else {
      let totalUnpaid = 0;
      msg += `📌 *TAGIHAN BELUM LUNAS (${unpaid.length}):*\n`;
      unpaid.forEach((b, idx) => {
        totalUnpaid += b.total_amount;
        const dueText = b.due_date ? ` (Jatuh tempo: ${b.due_date})` : '';
        msg += `${idx + 1}. *${b.title}*\n`;
        msg += `   • Total Bayar: *Rp ${b.total_amount.toLocaleString('id-ID')}*\n`;
        msg += `   • Tarif: Rp ${b.base_amount.toLocaleString('id-ID')} (Kode Unik: +${b.unique_code})\n`;
        msg += `   • ID Tagihan: *${b.id}*${dueText}\n`;
        msg += `   👉 Ketik: *BAYAR ${b.id}* untuk barcode QRIS\n\n`;
      });

      msg += `💵 *Total Seluruh Tagihan: Rp ${totalUnpaid.toLocaleString('id-ID')}*\n\n`;
      msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
      msg += `ℹ️ *CARA PEMBAYARAN CEPAT:*\n`;
      msg += `Balas dengan mengetik *BAYAR <ID>* (contoh: *BAYAR ${unpaid[0].id}*).\n`;
      msg += `Bot akan langsung mengirimkan barcode QRIS Dinamis ber-nominal tepat.\n\n`;
    }

    if (paid.length > 0) {
      msg += `✅ *RIWAYAT LUNAS TERAKHIR:*\n`;
      paid.slice(0, 3).forEach(b => {
        const paidDate = b.paid_at ? new Date(b.paid_at).toLocaleDateString('id-ID') : '-';
        msg += `• ${b.title}: Rp ${b.total_amount.toLocaleString('id-ID')} (${paidDate})\n`;
      });
      msg += `\n`;
    }

    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `_Ketik *MENU* untuk layanan informasi lainnya._`;

    return msg;
  }

  /**
   * Susun pesan laporan saldo & buku tabungan untuk seorang siswa
   */
  buildStudentSavingsMessage(student) {
    const settings = this.getSettings();
    const schoolName = settings.school_name || 'Sekolah';

    const savingsData = savingsService.getStudentSavings(student.id);
    if (!savingsData) {
      return `Data tabungan siswa *${student.name}* tidak ditemukan.`;
    }

    const { balance, teacher, transactions } = savingsData;

    // Rekapitulasi total setor & tarik untuk siswa ini
    const stats = db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'SETOR' THEN amount ELSE 0 END), 0) as total_deposit,
        COALESCE(SUM(CASE WHEN type = 'SETOR' THEN 1 ELSE 0 END), 0) as count_deposit,
        COALESCE(SUM(CASE WHEN type = 'TARIK' THEN amount ELSE 0 END), 0) as total_withdraw,
        COALESCE(SUM(CASE WHEN type = 'TARIK' THEN 1 ELSE 0 END), 0) as count_withdraw
      FROM student_savings
      WHERE student_id = ?
    `).get(student.id);

    let msg = `💰 *BUKU TABUNGAN DIGITAL SISWA*\n`;
    msg += `🏫 *${schoolName}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `👤 *Nama:* ${student.name}\n`;
    msg += `🏷️ *Kelas:* ${student.class_name || '-'}\n`;
    msg += `🆔 *NIS:* ${student.nis}\n`;
    if (teacher && teacher.name) {
      msg += `👨‍🏫 *Wali Kelas / Pengelola:* ${teacher.name}\n`;
      if (teacher.phone && teacher.phone !== '-') {
        msg += `📞 *Kontak WA Guru:* ${teacher.phone}\n`;
      }
    }
    msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    msg += `💵 *TOTAL SALDO TABUNGAN SAAT INI:*\n`;
    msg += `👉 *${savingsService.formatRupiah(balance)}*\n\n`;

    msg += `📊 *RINGKASAN TABUNGAN:*\n`;
    msg += `• Total Setoran: ${savingsService.formatRupiah(stats?.total_deposit || 0)} (${stats?.count_deposit || 0}x)\n`;
    msg += `• Total Penarikan: ${savingsService.formatRupiah(stats?.total_withdraw || 0)} (${stats?.count_withdraw || 0}x)\n\n`;

    msg += `📝 *MUTASI TERAKHIR:*\n`;
    const recentTx = (transactions || []).slice(0, 5);
    if (recentTx.length === 0) {
      msg += `_(Belum ada catatan mutasi tabungan)_\n`;
    } else {
      recentTx.forEach((tx) => {
        const icon = tx.type === 'SETOR' ? '🟢' : '🔴';
        const notesStr = tx.notes ? ` (${tx.notes})` : '';
        msg += `• ${tx.transaction_date}: ${icon} *${tx.type}* ${savingsService.formatRupiah(tx.amount)}${notesStr}\n`;
        msg += `  └ Saldo: ${savingsService.formatRupiah(tx.balance_after)}\n`;
      });
    }

    msg += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `ℹ️ Tabungan dipegang dan dikelola oleh Wali Kelas ananda. Untuk setoran atau penarikan dapat menghubungi Wali Kelas langsung.\n\n`;
    msg += `_Ketik *MENU* untuk layanan informasi lainnya._`;

    return msg;
  }

  /**
   * Susun pesan rekapitulasi total tabungan seluruh siswa di suatu rombel kelas (untuk Guru/Wali Kelas)
   */
  buildClassSavingsSummaryMessage(classId) {
    const settings = this.getSettings();
    const schoolName = settings.school_name || 'Sekolah';

    const classData = savingsService.getClassSavings(classId);
    if (!classData) {
      return `Data rombel kelas tidak ditemukan.`;
    }

    const { classInfo, teacher, students, stats } = classData;

    let msg = `📊 *REKAPITULASI TABUNGAN KELAS*\n`;
    msg += `🏫 *${schoolName}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🏷️ *Rombel Kelas:* ${classInfo.name}\n`;
    msg += `👨‍🏫 *Wali Kelas:* ${teacher.name}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    msg += `💰 *TOTAL SALDO KELAS SAAT INI:*\n`;
    msg += `👉 *${stats.formattedTotalBalance}*\n`;
    msg += `_(Total akumulasi tabungan yang Anda pegang)_\n\n`;

    msg += `📈 *STATISTIK TABUNGAN:*\n`;
    const percentage = stats.totalStudents > 0 ? Math.round((stats.activeSavers / stats.totalStudents) * 100) : 0;
    msg += `• Siswa Menabung: *${stats.activeSavers} dari ${stats.totalStudents} siswa* (${percentage}%)\n`;
    msg += `• Total Setoran Masuk: ${savingsService.formatRupiah(stats.totalDeposit)}\n`;
    msg += `• Total Penarikan Keluar: ${savingsService.formatRupiah(stats.totalWithdrawal)}\n`;
    msg += `• Total Transaksi Mutasi: ${stats.totalTxCount} kali\n\n`;

    msg += `📋 *DAFTAR SALDO SISWA (${students.length}):*\n`;
    if (students.length === 0) {
      msg += `_(Belum ada siswa di kelas ini)_\n`;
    } else {
      students.forEach((s, idx) => {
        const bal = Number(s.savings_balance) || 0;
        const icon = bal > 0 ? '🟢' : '⚪';
        msg += `${idx + 1}. ${icon} *${s.name}* (NIS: ${s.nis})\n`;
        msg += `   └ Saldo: *${savingsService.formatRupiah(bal)}* (${s.tx_count || 0}x mutasi)\n`;
      });
    }

    msg += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `💡 *PERINTAH CEPAT WALI KELAS:*\n`;
    msg += `• *TABUNGAN <NAMA/NIS>* : Cek mutasi buku tabungan murid\n`;
    msg += `• *SETOR <NAMA/NIS> <JUMLAH>* : Tambah setoran tabungan siswa\n`;
    msg += `• *TARIK <NAMA/NIS> <JUMLAH>* : Catat penarikan tabungan siswa\n`;
    msg += `_Contoh: *TABUNGAN Ahmad* atau *SETOR Ahmad 20rb*_`;

    return msg;
  }

  /**
   * Susun pesan rekapitulasi total tabungan seluruh sekolah (untuk Admin)
   */
  buildSchoolSavingsSummaryMessage() {
    const settings = this.getSettings();
    const schoolName = settings.school_name || 'Sekolah';

    const schoolStats = savingsService.getSchoolSavingsStats();
    const teacherSummary = savingsService.getTeacherSavingsSummary();

    let msg = `🏛️ *REKAPITULASI TABUNGAN SEKOLAH (ADMIN)*\n`;
    msg += `🏫 *${schoolName}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

    msg += `💰 *GRAND TOTAL SALDO SEKOLAH:*\n`;
    msg += `👉 *${schoolStats.formattedTotalBalance}*\n\n`;

    msg += `📈 *AKUMULASI SELURUH SEKOLAH:*\n`;
    msg += `• Penabung Aktif: *${schoolStats.activeSavers} dari ${schoolStats.totalStudents} siswa*\n`;
    msg += `• Total Uang Masuk: ${schoolStats.formattedTotalDeposit}\n`;
    msg += `• Total Uang Keluar: ${schoolStats.formattedTotalWithdrawal}\n`;
    msg += `• Total Aktivitas Mutasi: ${schoolStats.totalTransactions} transaksi\n\n`;

    msg += `👨‍🏫 *REKAP DANA DI TIAP GURU / ROMBEL:*\n`;
    teacherSummary.forEach((t, idx) => {
      msg += `${idx + 1}. *${t.teacherName}* (${t.className})\n`;
      msg += `   └ Saldo Dipegang: *${t.formattedTotalBalance}* (${t.activeSaverCount}/${t.studentCount} siswa)\n`;
    });

    return msg;
  }

  /**
   * Router Utama Pemroses Pesan Masuk WhatsApp
   */
  async processIncomingMessage(senderJid, text, resolvedPhone = null) {
    const rawText = (text || '').trim();
    if (!rawText) return null;

    // Gunakan nomor telepon teresolusi jika ada, atau fallback ekstrak dari senderJid / waLidStore
    let senderPhone = resolvedPhone;
    if (!senderPhone && senderJid) {
      try {
        const { waLidStore } = require('./waLidStore');
        senderPhone = waLidStore.get(senderJid) || waLidStore.get(senderJid.split('@')[0]);
      } catch (_) {}
      if (!senderPhone) {
        senderPhone = senderJid.split('@')[0].replace(/\D/g, '');
      }
    }

    const settings = this.getSettings();
    const schoolName = settings.school_name || 'Sekolah';

    // Identifikasi Profil Pengirim
    const teacher = this.findTeacher(senderPhone);
    const admin = this.findAdmin(senderPhone);
    const parentStudents = this.findParentStudents(senderPhone);


    const tokens = rawText.split(/\s+/);
    const firstWord = tokens[0].toUpperCase();

    // ==========================================
    // 1. HANDSHAKE VERIFIKASI: "YA" / "IYA"
    // ==========================================
    if (/^YA$|^IYA$|^YA!$/i.test(rawText.trim())) {
      if (parentStudents.length > 0) {
        const updateStmt = db.prepare("UPDATE students SET wa_status = 'confirmed', wa_confirmed_at = CURRENT_TIMESTAMP WHERE id = ?");
        for (const s of parentStudents) updateStmt.run(s.id);

        const studentList = parentStudents.map(s => `• *${s.name}* (Kelas ${s.class_name})`).join('\n');
        return `Assalamu’alaikum Wr. Wb.\n\nTerima kasih, nomor WhatsApp Anda telah *BERHASIL TERVERIFIKASI* di sistem absensi *${schoolName}* untuk ananda:\n${studentList}\n\nLaporan kehadiran harian ananda akan otomatis kami kirimkan ke nomor ini.\n\n_Ketik *MENU* untuk melihat perintah bantuan yang dapat digunakan._`;
      } else {
        // Jangan balas pesan 'YA' jika pengirim bukan orang tua murid terdaftar
        console.log(`[WhatsApp Bot] Pesan 'YA' diabaikan karena nomor ${senderPhone || senderJid} bukan orang tua terdaftar.`);
        return null;
      }
    }

    // ==========================================
    // 2. PERINTAH: CEK PRESENSI (ORANG TUA)
    // ==========================================
    if (firstWord === 'CEK' || firstWord === 'PRESENSI' || firstWord === 'ABSEN') {
      // Kasus A: Jika orang tua menyertakan argumen (misal: CEK 1001 atau CEK 1)
      if (tokens.length > 1) {
        const arg = tokens[1].trim();

        // Cek jika argumen adalah indeks urutan anak (1, 2, 3...)
        const childIdx = parseInt(arg, 10);
        if (!isNaN(childIdx) && childIdx >= 1 && childIdx <= parentStudents.length) {
          const selectedStudent = parentStudents[childIdx - 1];
          return this.buildStudentAttendanceMessage(selectedStudent);
        }

        // Cek jika argumen adalah NIS atau NISN siswa
        const studentByNis = db.prepare(`
          SELECT s.*, c.name as class_name 
          FROM students s 
          LEFT JOIN classes c ON s.class_id = c.id 
          WHERE (s.nis = ? OR s.nisn = ?) AND s.is_active = 1
        `).get(arg, arg);

        if (!studentByNis) {
          return `Siswa dengan NIS/NISN *"${arg}"* tidak ditemukan. Pastikan nomor yang dimasukkan sudah sesuai.`;
        }

        // Proteksi Privasi Siswa:
        // Pengecekan hanya diizinkan jika pengirim adalah wali murid dari siswa tersebut, ATAU guru sekolah
        const isParentOfThisStudent = parentStudents.some(s => s.id === studentByNis.id);
        if (!isParentOfThisStudent && !teacher) {
          return `⚠️ *Akses Terbatas:*\nDemi keamanan dan privasi data siswa, pengecekan kehadiran hanya dapat diakses oleh nomor WhatsApp orang tua/wali murid yang terdaftar resmi di sekolah.\n\nJika ini adalah putra/putri Anda, silakan hubungi bagian Tata Usaha sekolah untuk mendaftarkan nomor ini.`;
        }

        return this.buildStudentAttendanceMessage(studentByNis);
      }

      // Kasus B: Tanpa argumen (Hanya ketik "CEK")
      if (parentStudents.length === 1) {
        // Otomatis tampilkan ananda jika hanya 1 anak terdaftar
        return this.buildStudentAttendanceMessage(parentStudents[0]);
      } else if (parentStudents.length > 1) {
        // Jika memiliki lebih dari 1 anak, tampilkan pilihan
        let listMsg = `Ditemukan *${parentStudents.length} siswa* yang terdaftar dengan nomor WhatsApp ini:\n\n`;
        parentStudents.forEach((s, idx) => {
          listMsg += `${idx + 1}. *${s.name}* (Kelas ${s.class_name || '-'} • NIS ${s.nis})\n`;
        });
        listMsg += `\nSilakan balas dengan mengetik:\n`;
        parentStudents.forEach((s, idx) => {
          listMsg += `👉 Ketik *CEK ${idx + 1}* untuk ${s.name.split(' ')[0]}\n`;
        });
        return listMsg;
      } else {
        return `Nomor WhatsApp Anda (*${senderPhone}*) belum terdaftar sebagai wali murid di sistem absensi *${schoolName}*.\n\nUntuk memeriksa kehadiran, Anda dapat memasukkan NIS/NISN siswa:\n👉 Ketik: *CEK <NIS_SISWA>*\nContoh: *CEK 1001*\n\n_Atau hubungi pihak sekolah untuk mendaftarkan nomor Anda._`;
      }
    }

    // ==========================================
    // 2.1 PERINTAH: CEK TAGIHAN / SPP SISWA
    // ==========================================
    if (firstWord === 'SPP' || firstWord === 'TAGIHAN' || firstWord === 'BIAYA') {
      // Kasus A: Jika disertai argumen (misal: SPP 1001 atau SPP 1)
      if (tokens.length > 1) {
        const arg = tokens[1].trim();

        const childIdx = parseInt(arg, 10);
        if (!isNaN(childIdx) && childIdx >= 1 && childIdx <= parentStudents.length) {
          const selectedStudent = parentStudents[childIdx - 1];
          return this.buildStudentBillsMessage(selectedStudent);
        }

        const studentByNis = db.prepare(`
          SELECT s.*, c.name as class_name 
          FROM students s 
          LEFT JOIN classes c ON s.class_id = c.id 
          WHERE (s.nis = ? OR s.nisn = ?) AND s.is_active = 1
        `).get(arg, arg);

        if (!studentByNis) {
          return `Siswa dengan NIS/NISN *"${arg}"* tidak ditemukan. Pastikan nomor yang dimasukkan sudah sesuai.`;
        }

        const isParentOfThisStudent = parentStudents.some(s => s.id === studentByNis.id);
        if (!isParentOfThisStudent && !teacher) {
          return `⚠️ *Akses Terbatas:*\nInformasi rincian tagihan keuangan hanya dapat diakses oleh nomor WhatsApp orang tua/wali murid resmi yang terdaftar di sekolah.`;
        }

        return this.buildStudentBillsMessage(studentByNis);
      }

      // Kasus B: Tanpa argumen (Hanya ketik "SPP")
      if (parentStudents.length === 1) {
        return this.buildStudentBillsMessage(parentStudents[0]);
      } else if (parentStudents.length > 1) {
        let listMsg = `Ditemukan *${parentStudents.length} siswa* yang terdaftar dengan nomor WhatsApp ini:\n\n`;
        parentStudents.forEach((s, idx) => {
          listMsg += `${idx + 1}. *${s.name}* (Kelas ${s.class_name || '-'} • NIS ${s.nis})\n`;
        });
        listMsg += `\nSilakan balas dengan mengetik:\n`;
        parentStudents.forEach((s, idx) => {
          listMsg += `👉 Ketik *SPP ${idx + 1}* untuk tagihan ${s.name.split(' ')[0]}\n`;
        });
        return listMsg;
      } else {
        return `Nomor WhatsApp Anda (*${senderPhone}*) belum terdaftar sebagai wali murid di sistem absensi *${schoolName}*.\n\nUntuk memeriksa tagihan, ketik:\n👉 *SPP <NIS_SISWA>*\nContoh: *SPP 1001*`;
      }
    }

    // ==========================================
    // 2.2 PERINTAH: BAYAR & GENERATE QRIS DINAMIS
    // ==========================================
    if (firstWord === 'BAYAR') {
      let targetBillId = null;

      if (tokens.length > 1) {
        const idArg = parseInt(tokens[1], 10);
        if (!isNaN(idArg) && idArg > 0) {
          targetBillId = idArg;
        }
      }

      // Jika tanpa argumen ID tagihan (misal hanya ketik "BAYAR" atau "BAYAR SPP")
      if (!targetBillId) {
        // Cari tagihan unpaid milik anak-anak orang tua ini
        const studentIds = parentStudents.map(s => s.id);
        if (studentIds.length === 0) {
          return `Silakan tentukan nomor ID tagihan yang ingin dibayar.\nContoh: *BAYAR 5*\n\n_Ketik *SPP* untuk melihat daftar ID tagihan ananda._`;
        }

        const placeholders = studentIds.map(() => '?').join(',');
        const unpaidBills = db.prepare(`
          SELECT b.*, s.name as student_name
          FROM student_bills b
          JOIN students s ON b.student_id = s.id
          WHERE b.student_id IN (${placeholders}) AND b.status = 'UNPAID'
          ORDER BY b.created_at DESC
        `).all(...studentIds);

        if (unpaidBills.length === 0) {
          return `🎉 *Alhamdulillah!* Tidak ada tagihan yang belum dibayar untuk ananda saat ini. Seluruh kewajiban telah lunas.`;
        } else if (unpaidBills.length === 1) {
          targetBillId = unpaidBills[0].id;
        } else {
          let chooseMsg = `Ditemukan *${unpaidBills.length} tagihan belum lunas*:\n\n`;
          unpaidBills.forEach((b, idx) => {
            chooseMsg += `${idx + 1}. *${b.title}* (${b.student_name})\n`;
            chooseMsg += `   • Total: *Rp ${b.total_amount.toLocaleString('id-ID')}*\n`;
            chooseMsg += `   • ID Tagihan: *${b.id}*\n\n`;
          });
          chooseMsg += `Silakan ketik *BAYAR <ID>* sesuai tagihan yang ingin dibayar:\nContoh: *BAYAR ${unpaidBills[0].id}*`;
          return chooseMsg;
        }
      }

      // Ambil detail tagihan yang dipilih
      const bill = db.prepare(`
        SELECT b.*, s.name as student_name, s.nis, s.parent_phone, c.name as class_name, cat.name as category_name
        FROM student_bills b
        JOIN students s ON b.student_id = s.id
        JOIN fee_categories cat ON b.category_id = cat.id
        LEFT JOIN classes c ON s.class_id = c.id
        WHERE b.id = ?
      `).get(targetBillId);

      if (!bill) {
        return `Tagihan dengan ID *#${targetBillId}* tidak ditemukan. Pastikan nomor ID tagihan benar. Ketik *SPP* untuk melihat daftar tagihan.`;
      }

      if (bill.status === 'PAID') {
        const paidDate = bill.paid_at ? new Date(bill.paid_at).toLocaleString('id-ID') : '';
        return `✅ Tagihan *${bill.bill_code}* (${bill.title}) atas nama *${bill.student_name}* sudah *LUNAS* pada ${paidDate}.\n\nTerima kasih!`;
      }

      if (bill.status === 'CANCELLED') {
        return `Tagihan *${bill.bill_code}* telah dibatalkan oleh pihak sekolah.`;
      }

      // Proteksi Privasi
      const isParentOfThisStudent = parentStudents.some(s => s.id === bill.student_id);
      if (!isParentOfThisStudent && !teacher) {
        return `⚠️ Akses terbatas: Anda hanya dapat melakukan pembayaran untuk siswa yang terdaftar dengan nomor WhatsApp ini.`;
      }

      // Generate Barcode QRIS Dinamis
      try {
        const qrisData = await financeService.getDynamicQrisBufferForBill(bill.id);

        let caption = `💳 *QRIS PEMBAYARAN TAGIHAN SEKOLAH*\n`;
        caption += `🏫 *${schoolName}*\n`;
        caption += `━━━━━━━━━━━━━━━━━━━━━\n`;
        caption += `🧾 *No. Tagihan:* ${bill.bill_code}\n`;
        caption += `👤 *Siswa:* ${bill.student_name} (${bill.class_name || '-'})\n`;
        caption += `📋 *Tagihan:* ${bill.title}\n`;
        caption += `━━━━━━━━━━━━━━━━━━━━━\n`;
        caption += `💰 *TOTAL TRANSFER TEPAT:* \n`;
        caption += `👉 *Rp ${bill.total_amount.toLocaleString('id-ID')}*\n`;
        caption += `_(Tarif Pokok Rp ${bill.base_amount.toLocaleString('id-ID')} + Kode Unik +${bill.unique_code})_\n`;
        caption += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
        caption += `⚠️ *PETUNJUK PEMBAYARAN:* \n`;
        caption += `1. Buka aplikasi Bank (BCA, BRI, Mandiri, BNI, BSI, Jatim, dll) atau E-Wallet (Dana, Gopay, OVO, ShopeePay).\n`;
        caption += `2. Pilih menu *Scan QRIS* (atau simpan gambar ini lalu unggah dari galeri HP).\n`;
        caption += `3. Pastikan nominal pembayaran *PERSIS Rp ${bill.total_amount.toLocaleString('id-ID')}* (jangan dibulatkan).\n`;
        caption += `4. Kode unik 3 digit (+${bill.unique_code}) berfungsi sebagai identifikasi otomatis pembayaran Anda.\n`;
        caption += `5. Setelah transfer berhasil, sistem akan otomatis mencatat lunas dan mengirimkan *Bukti Kuitansi Lunas* ke nomor ini dalam beberapa detik!\n\n`;
        caption += `_Semoga berkah & bermanfaat._`;

        return {
          type: 'image',
          buffer: qrisData.buffer,
          caption
        };
      } catch (err) {
        console.error('[BotService] Gagal membuat gambar QRIS Dinamis:', err);
        return `Mohon maaf, terjadi kendala saat menyiapkan QRIS: ${err.message}.\nSilakan hubungi bagian Tata Usaha sekolah.`;
      }
    }

    // ==========================================
    // 2.25 PERINTAH: REKAP TOTAL TABUNGAN KELAS / SEKOLAH
    // ==========================================
    const isTotalSavingsQuery = /^(TOTAL\s+TABUNGAN|TABUNGAN\s+TOTAL|TABUNGAN\s+KELAS|REKAP\s+TABUNGAN|SALDO\s+KELAS|SALDO\s+TOTAL|SEMUA\s+TABUNGAN|TABUNGAN\s+SEMUA)$/i.test(rawText);
    if (isTotalSavingsQuery) {
      if (teacher && teacher.class_id) {
        return this.buildClassSavingsSummaryMessage(teacher.class_id);
      }
      if (admin) {
        return this.buildSchoolSavingsSummaryMessage();
      }
      return `⚠️ Perintah rekap tabungan kelas khusus untuk Guru / Wali Kelas *${schoolName}*.`;
    }

    // ==========================================
    // 2.3 PERINTAH: CEK TABUNGAN SISWA / SALDO
    // ==========================================
    if (firstWord === 'TABUNGAN' || firstWord === 'SALDO') {
      // Kasus A: Jika disertai argumen (misal: TABUNGAN 1, TABUNGAN Ahmad, TABUNGAN 1001, TABUNGAN KELAS)
      if (tokens.length > 1) {
        const arg = tokens.slice(1).join(' ').trim();
        const upperArg = arg.toUpperCase();

        // Subkasus A.0: Jika argumen adalah "KELAS" / "TOTAL" / "SEMUA" / "REKAP"
        if (upperArg === 'KELAS' || upperArg === 'TOTAL' || upperArg === 'SEMUA' || upperArg === 'REKAP') {
          if (teacher && teacher.class_id) {
            return this.buildClassSavingsSummaryMessage(teacher.class_id);
          }
          if (admin) {
            return this.buildSchoolSavingsSummaryMessage();
          }
          return `⚠️ Perintah rekap tabungan kelas khusus untuk Guru / Wali Kelas *${schoolName}*.`;
        }

        // Subkasus A.1: Jika pengirim adalah orang tua dan memilih nomor urut anak (1, 2, 3...)
        const childIdx = parseInt(arg, 10);
        if (!isNaN(childIdx) && childIdx >= 1 && childIdx <= parentStudents.length) {
          const selectedStudent = parentStudents[childIdx - 1];
          return this.buildStudentSavingsMessage(selectedStudent);
        }

        // Subkasus A.2: Cek berdasarkan nomor NIS atau NISN
        const studentByNis = db.prepare(`
          SELECT s.*, c.name as class_name 
          FROM students s 
          LEFT JOIN classes c ON s.class_id = c.id 
          WHERE (s.nis = ? OR s.nisn = ?) AND s.is_active = 1
        `).get(arg, arg);

        if (studentByNis) {
          const isParentOfThisStudent = parentStudents.some(s => s.id === studentByNis.id);
          if (!isParentOfThisStudent && !teacher && !admin) {
            return `⚠️ *Akses Terbatas:*\nInformasi tabungan siswa hanya dapat diakses oleh orang tua/wali murid resmi yang terdaftar di sekolah atau oleh Dewan Guru.`;
          }
          return this.buildStudentSavingsMessage(studentByNis);
        }

        // Subkasus A.3: Jika BUKAN nomor NIS, cari berdasarkan NAMA SISWA (khususnya untuk Guru atau Wali Murid)
        if (teacher && teacher.class_id) {
          // Cari di kelas yang diampu guru ini terlebih dahulu
          const foundInClass = db.prepare(`
            SELECT s.*, c.name as class_name 
            FROM students s 
            LEFT JOIN classes c ON s.class_id = c.id 
            WHERE s.class_id = ? AND s.is_active = 1 AND s.name LIKE ?
            ORDER BY s.name ASC
          `).all(teacher.class_id, `%${arg}%`);

          if (foundInClass.length === 1) {
            return this.buildStudentSavingsMessage(foundInClass[0]);
          } else if (foundInClass.length > 1) {
            let listMsg = `Ditemukan *${foundInClass.length} siswa* dengan nama "${arg}" di kelas ${teacher.class_name}:\n\n`;
            foundInClass.forEach((s, idx) => {
              listMsg += `${idx + 1}. *${s.name}* (NIS: ${s.nis} • Saldo: ${savingsService.formatRupiah(s.savings_balance || 0)})\n`;
            });
            listMsg += `\nSilakan ketik nomor NIS siswa agar lebih spesifik:\nContoh: *TABUNGAN ${foundInClass[0].nis}*`;
            return listMsg;
          }

          // Jika tidak ada di kelasnya, coba cari di kelas lain
          const foundSchool = db.prepare(`
            SELECT s.*, c.name as class_name 
            FROM students s 
            LEFT JOIN classes c ON s.class_id = c.id 
            WHERE s.is_active = 1 AND s.name LIKE ?
            ORDER BY s.name ASC
          `).all(`%${arg}%`);

          if (foundSchool.length === 1) {
            return this.buildStudentSavingsMessage(foundSchool[0]);
          } else if (foundSchool.length > 1) {
            let listMsg = `Ditemukan beberapa siswa bernama "${arg}" di sekolah:\n\n`;
            foundSchool.slice(0, 5).forEach((s, idx) => {
              listMsg += `${idx + 1}. *${s.name}* (Kelas ${s.class_name || '-'} • NIS: ${s.nis})\n`;
            });
            listMsg += `\nSilakan ketik dengan NIS siswa: *TABUNGAN <NIS>*`;
            return listMsg;
          }

          return `Siswa dengan nama atau NIS *"${arg}"* tidak ditemukan di kelas *${teacher.class_name}*. Pastikan ejaan nama atau gunakan nomor NIS siswa.`;
        }

        return `Siswa dengan NIS/NISN atau nama *"${arg}"* tidak ditemukan. Pastikan nomor/nama yang dimasukkan sudah sesuai.`;
      }

      // Kasus B: Tanpa argumen (Hanya ketik "TABUNGAN" atau "SALDO")
      // B.1: Jika pengirim adalah Guru
      if (teacher && teacher.class_id) {
        if (parentStudents.length === 0) {
          // Guru murni: langsung tampilkan Rekapitulasi Total Tabungan Kelasnya!
          return this.buildClassSavingsSummaryMessage(teacher.class_id);
        } else {
          // Guru sekaligus Wali Murid: tampilkan pilihan
          let chooseMsg = `👋 Halo Bapak/Ibu Guru *${teacher.name}*!\n\n`;
          chooseMsg += `Silakan pilih informasi tabungan yang ingin dilihat:\n`;
          chooseMsg += `👉 Ketik *TABUNGAN KELAS* : Rekap total tabungan seluruh murid rombel ${teacher.class_name}\n`;
          parentStudents.forEach((s, idx) => {
            chooseMsg += `👉 Ketik *TABUNGAN ${idx + 1}* : Buku tabungan ananda ${s.name.split(' ')[0]}\n`;
          });
          chooseMsg += `\n_Atau ketik *TABUNGAN <NAMA/NIS>* untuk memeriksa siswa tertentu._`;
          return chooseMsg;
        }
      }

      // B.2: Jika pengirim adalah Admin
      if (admin) {
        return this.buildSchoolSavingsSummaryMessage();
      }

      // B.3: Jika pengirim adalah Orang Tua dengan 1 anak
      if (parentStudents.length === 1) {
        return this.buildStudentSavingsMessage(parentStudents[0]);
      } else if (parentStudents.length > 1) {
        // Orang tua dengan lebih dari 1 anak
        let listMsg = `Ditemukan *${parentStudents.length} siswa* yang terdaftar dengan nomor WhatsApp ini:\n\n`;
        parentStudents.forEach((s, idx) => {
          listMsg += `${idx + 1}. *${s.name}* (Kelas ${s.class_name || '-'} • NIS ${s.nis})\n`;
        });
        listMsg += `\nSilakan balas dengan mengetik:\n`;
        parentStudents.forEach((s, idx) => {
          listMsg += `👉 Ketik *TABUNGAN ${idx + 1}* untuk ${s.name.split(' ')[0]}\n`;
        });
        return listMsg;
      } else {
        return `Nomor WhatsApp Anda (*${senderPhone}*) belum terdaftar sebagai wali murid di sistem absensi *${schoolName}*.\n\nUntuk memeriksa tabungan siswa, ketik:\n👉 *TABUNGAN <NIS_SISWA>*\nContoh: *TABUNGAN 1001*`;
      }
    }


    // ==========================================
    // 3. PERINTAH: REKAP BULANAN (GURU & ORANG TUA)
    // ==========================================
    const isMonthlySummary = firstWord === 'BULANAN' || 
      (firstWord === 'REKAP' && /\bBULAN\b|\bBULANAN\b/i.test(rawText)) ||
      (firstWord === 'REKAP' && parentStudents && parentStudents.length > 0 && !teacher && !admin);

    if (isMonthlySummary) {
      // -------------------------------------------------------------
      // KASUS A: PENGIRIM ADALAH ORANG TUA MURID
      // -------------------------------------------------------------
      if (parentStudents && parentStudents.length > 0) {
        // Ekstrak token setelah perintah
        let remainingTokens = tokens.slice(1);
        if (remainingTokens.length > 0 && remainingTokens[0].toUpperCase() === 'BULANAN') {
          remainingTokens = remainingTokens.slice(1);
        } else if (remainingTokens.length > 0 && remainingTokens[0].toUpperCase() === 'BULAN') {
          remainingTokens = remainingTokens.slice(1);
        }

        let targetStudent = null;

        if (parentStudents.length === 1) {
          targetStudent = parentStudents[0];
        } else {
          // Jika memiliki lebih dari 1 anak, cek apakah menyebut nomor urut atau nama/NIS
          if (remainingTokens.length > 0) {
            const firstArg = remainingTokens[0];
            const childIdx = parseInt(firstArg, 10);
            if (!isNaN(childIdx) && childIdx >= 1 && childIdx <= parentStudents.length) {
              targetStudent = parentStudents[childIdx - 1];
              remainingTokens = remainingTokens.slice(1);
            } else {
              // Cek kecocokan nama atau NIS
              for (const s of parentStudents) {
                const firstName = s.name.split(' ')[0].toLowerCase();
                if (firstArg.toLowerCase() === firstName || s.nis === firstArg || s.name.toLowerCase().startsWith(firstArg.toLowerCase())) {
                  targetStudent = s;
                  remainingTokens = remainingTokens.slice(1);
                  break;
                }
              }
            }
          }

          // Jika belum ditentukan, tampilkan pilihan anak
          if (!targetStudent) {
            let chooseMsg = `Ditemukan *${parentStudents.length} siswa* yang terdaftar dengan nomor WhatsApp ini:\n\n`;
            parentStudents.forEach((s, idx) => {
              chooseMsg += `${idx + 1}. *${s.name}* (Kelas ${s.class_name || '-'} • NIS ${s.nis})\n`;
            });
            chooseMsg += `\nSilakan balas dengan mengetik:\n`;
            parentStudents.forEach((s, idx) => {
              chooseMsg += `👉 Ketik *BULANAN ${idx + 1}* untuk ${s.name.split(' ')[0]}\n`;
            });
            chooseMsg += `\n_Atau sebutkan bulan, contoh: *BULANAN 1 Agustus*_`;
            return chooseMsg;
          }
        }

        const monthParam = remainingTokens.join(' ').trim();
        try {
          const summaryObj = generateMonthlyStudentSummary(targetStudent.id, monthParam);
          return summaryObj.message;
        } catch (err) {
          return `Gagal memuat rekap kehadiran: ${err.message}`;
        }
      }

      // -------------------------------------------------------------
      // KASUS B: PENGIRIM ADALAH GURU / WALI KELAS
      // -------------------------------------------------------------
      if (teacher) {
        if (!teacher.class_id) {
          return `Halo ${teacher.name}, akun Guru Anda belum ditugaskan sebagai Wali Kelas dari rombel tertentu di sistem.`;
        }

        let remainingTokens = tokens.slice(1);
        if (remainingTokens.length > 0 && remainingTokens[0].toUpperCase() === 'BULANAN') {
          remainingTokens = remainingTokens.slice(1);
        } else if (remainingTokens.length > 0 && remainingTokens[0].toUpperCase() === 'BULAN') {
          remainingTokens = remainingTokens.slice(1);
        }

        // Cek apakah ada argumen nama siswa atau NIS siswa
        let targetStudent = null;
        let monthTokens = [];

        if (remainingTokens.length > 0) {
          const firstArg = remainingTokens[0];
          // Cek apakah firstArg adalah nama atau NIS siswa di kelasnya
          const studentByNis = db.prepare(`
            SELECT * FROM students WHERE (nis = ? OR nisn = ?) AND class_id = ? AND is_active = 1
          `).get(firstArg, firstArg, teacher.class_id);

          if (studentByNis) {
            targetStudent = studentByNis;
            monthTokens = remainingTokens.slice(1);
          } else {
            // Cek pencarian nama di kelas
            const foundInClass = db.prepare(`
              SELECT * FROM students 
              WHERE class_id = ? AND is_active = 1 AND name LIKE ?
              ORDER BY name ASC
            `).all(teacher.class_id, `%${firstArg}%`);

            if (foundInClass.length === 1) {
              targetStudent = foundInClass[0];
              monthTokens = remainingTokens.slice(1);
            } else if (foundInClass.length > 1) {
              let listMsg = `Ditemukan *${foundInClass.length} siswa* dengan nama "${firstArg}" di kelas Anda:\n\n`;
              foundInClass.forEach((s, idx) => {
                listMsg += `${idx + 1}. *${s.name}* (NIS: ${s.nis})\n`;
              });
              listMsg += `\nSilakan ketik dengan menyertakan NIS siswa:\nContoh: *REKAP BULANAN ${foundInClass[0].nis}*`;
              return listMsg;
            } else {
              // Bukan nama siswa, mungkin nama bulan (misal: "Agustus" atau "2026-08")
              monthTokens = remainingTokens;
            }
          }
        }

        const monthParam = monthTokens.join(' ').trim();

        try {
          if (targetStudent) {
            // Rekap per siswa untuk guru
            const studentSummary = generateMonthlyStudentSummary(targetStudent.id, monthParam);
            return studentSummary.message;
          } else {
            // Rekap seluruh rombel kelas untuk guru
            const classSummary = generateMonthlyClassSummary(teacher.class_id, monthParam);
            return classSummary.message;
          }
        } catch (err) {
          return `Gagal memuat rekap bulanan: ${err.message}`;
        }
      }

      // -------------------------------------------------------------
      // KASUS C: PENGIRIM ADALAH ADMINISTRATOR
      // -------------------------------------------------------------
      if (admin) {
        return `Halo Admin, silakan gunakan menu Dashboard Web untuk rekapitulasi seluruh kelas sekolah, atau ketik *REKAP BULANAN <NIS>* untuk memeriksa siswa tertentu.`;
      }

      return `Nomor WhatsApp Anda belum terdaftar sebagai wali murid atau dewan guru di sistem absensi *${schoolName}*.`;
    }

    // ==========================================
    // 3.1 PERINTAH KHUSUS GURU: REKAP PRESENSI HARIAN KELAS
    // ==========================================
    if (firstWord === 'REKAP' || firstWord === 'URUTAN') {
      if (!teacher) {
        return `⚠️ Perintah *REKAP* presensi harian khusus untuk Guru / Wali Kelas *${schoolName}*.\n\nUntuk wali murid, silakan ketik *CEK* atau *BULANAN* untuk melihat kehadiran ananda.`;
      }

      if (!teacher.class_id) {
        return `Halo ${teacher.name}, akun Guru Anda belum ditugaskan sebagai Wali Kelas dari rombel tertentu di sistem.`;
      }

      // Jika guru mengetik "REKAP MENU" atau "REKAP PANDUAN", berikan panduan menu rekap lengkap
      if (tokens.length > 1 && /^(MENU|BANTUAN|PANDUAN|HELP)$/i.test(tokens[1])) {
        let menuResp = `📋 *PANDUAN MENU REKAP WALI KELAS*\n`;
        menuResp += `🏫 *${schoolName}*\n`;
        menuResp += `🏷️ *Kelas:* ${teacher.class_name}\n`;
        menuResp += `━━━━━━━━━━━━━━━━━━━━━\n\n`;
        menuResp += `Berikut perintah rekap kehadiran yang dapat Anda gunakan:\n\n`;
        menuResp += `👉 *REKAP* : Rekap urutan presensi kelas Anda hari ini\n`;
        menuResp += `👉 *REKAP BULANAN* : Rekapitulasi kehadiran satu kelas selama 1 bulan berjalan\n`;
        menuResp += `👉 *REKAP BULANAN <BULAN>* : Rekap kehadiran bulan tertentu (Contoh: *REKAP BULANAN Agustus*)\n`;
        menuResp += `👉 *REKAP BULANAN <NIS/NAMA>* : Rekap 1 bulan untuk siswa tertentu (Contoh: *REKAP BULANAN Ahmad*)\n`;
        menuResp += `👉 *BELUM* : Cek siswa yang belum hadir / alpa hari ini\n`;
        menuResp += `👉 *PENDING* : Cek permohonan izin/sakit siswa yang butuh respon\n`;
        menuResp += `👉 *TABUNGAN* : Cek rekap buku tabungan murid kelas Anda\n\n`;
        menuResp += `━━━━━━━━━━━━━━━━━━━━━\n`;
        menuResp += `_Ketik *MENU* untuk melihat seluruh fitur layanan bot sekolah._`;
        return menuResp;
      }

      try {
        const today = getTodayWIB();
        const summary = generateTeacherSummary(teacher.class_id, today);
        let resp = summary.message;
        resp += `\n\n💡 _Tips: Ketik *REKAP BULANAN* untuk melihat rekap kehadiran seluruh murid kelas Anda selama 1 bulan._`;
        return resp;
      } catch (err) {
        return `Gagal membuat rekap kelas: ${err.message}`;
      }
    }

    // ==========================================
    // 4. PERINTAH KHUSUS GURU: BELUM HADIR / ALPA
    // ==========================================
    const isAbsentQuery = /^(BELUM|ALPA|BELUM\s*HADIR|SISWA\s*BELUM)$/i.test(rawText.trim()) || 
                          ((firstWord === 'BELUM' || firstWord === 'ALPA') && tokens.length === 1);
    if (isAbsentQuery) {
      if (!teacher) {
        return `⚠️ Perintah *BELUM* khusus untuk Guru / Wali Kelas *${schoolName}*.`;
      }

      if (!teacher.class_id) {
        return `Halo ${teacher.name}, akun Guru Anda belum ditugaskan sebagai Wali Kelas dari rombel tertentu di sistem.`;
      }

      const today = getTodayWIB();
      const absentStudents = db.prepare(`
        SELECT s.*, c.name as class_name
        FROM students s
        LEFT JOIN classes c ON s.class_id = c.id
        WHERE s.is_active = 1 AND s.class_id = ?
          AND s.id NOT IN (SELECT student_id FROM attendances WHERE date = ?)
        ORDER BY s.name ASC
      `).all(teacher.class_id, today);

      const timeNow = getTimeStringWIB(); // HH:MM dalam WIB

      let resp = `📋 *DAFTAR SISWA BELUM HADIR HARI INI*\n`;
      resp += `🏫 *${schoolName}*\n`;
      resp += `🏷️ *Kelas:* ${teacher.class_name}\n`;
      resp += `⏰ *Waktu:* ${timeNow} WIB\n`;
      resp += `━━━━━━━━━━━━━━━━━━━━━\n`;

      if (absentStudents.length === 0) {
        resp += `🎉 *Luar biasa!* Seluruh siswa kelas ${teacher.class_name} telah tercatat hadir hari ini.`;
      } else {
        resp += `Total: *${absentStudents.length} siswa* belum melakukan tap presensi:\n\n`;
        absentStudents.forEach((s, idx) => {
          const phoneInfo = s.parent_phone ? ` (WA Ortu: ${s.parent_phone})` : ' (No WA -)';
          resp += `${idx + 1}. ${s.name}${phoneInfo}\n`;
        });
      }
      resp += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
      resp += `_Ketik *REKAP* untuk urutan kehadiran kronologis lengkap._`;
      return resp;
    }

    // ==========================================
    // 4.1 PERINTAH KHUSUS GURU: SETOR TABUNGAN SISWA
    // ==========================================
    if (firstWord === 'SETOR' || firstWord === 'MENABUNG') {
      if (!teacher) {
        return `⚠️ Perintah *SETOR* khusus untuk Guru / Wali Kelas *${schoolName}*.\n\nUntuk wali murid, ketik *TABUNGAN* untuk melihat saldo tabungan ananda.`;
      }

      if (!teacher.class_id) {
        return `Halo ${teacher.name}, akun Guru Anda belum ditugaskan sebagai Wali Kelas dari rombel tertentu di sistem.`;
      }

      // Syntax: SETOR <NAMA/NIS> <JUMLAH> [CATATAN]
      if (tokens.length < 2) {
        return `ℹ️ *PANDUAN SETOR TABUNGAN SISWA*\n` +
          `━━━━━━━━━━━━━━━━━━━━━\n` +
          `Format:\n` +
          `👉 *SETOR <NAMA/NIS> <JUMLAH> [CATATAN]*\n\n` +
          `Contoh:\n` +
          `• *SETOR Ahmad 20000*\n` +
          `• *SETOR Ahmad Fauzi 50k Saku senin*\n` +
          `• *SETOR 1001 25.000 Tabungan harian*\n\n` +
          `_Ketik *TABUNGAN <NIS>* untuk memeriksa saldo siswa._`;
      }

      const cmdArgs = tokens.slice(1);
      let targetStudent = null;
      let parsedAmount = 0;
      let notes = '';

      // 1. Cek apakah token pertama adalah NIS siswa di kelas guru ini
      const studentByNis = db.prepare(`
        SELECT * FROM students 
        WHERE class_id = ? AND is_active = 1 AND nis = ?
      `).get(teacher.class_id, cmdArgs[0]);

      if (studentByNis && cmdArgs.length >= 2) {
        targetStudent = studentByNis;
        parsedAmount = savingsService.parseAmount(cmdArgs[1]);
        notes = cmdArgs.slice(2).join(' ').trim();
      } else {
        // 2. Jika bukan NIS, cari token nominal dari kiri ke kanan (mulai index 1)
        let amountIdx = -1;
        for (let i = 1; i < cmdArgs.length; i++) {
          const amt = savingsService.parseAmount(cmdArgs[i]);
          if (amt >= 500) {
            amountIdx = i;
            parsedAmount = amt;
            break;
          }
        }

        // Fallback: apabila guru mengetik nominal di posisi pertama (contoh: SETOR 20000 Ahmad)
        if (amountIdx === -1 && cmdArgs.length >= 2) {
          const firstAmt = savingsService.parseAmount(cmdArgs[0]);
          if (firstAmt >= 500) {
            parsedAmount = firstAmt;
            const ident = cmdArgs.slice(1).join(' ').trim();
            const found = db.prepare(`
              SELECT * FROM students 
              WHERE class_id = ? AND is_active = 1 AND (nis = ? OR name LIKE ?)
              ORDER BY name ASC
            `).all(teacher.class_id, ident, `%${ident}%`);
            if (found.length === 1) {
              targetStudent = found[0];
            } else if (found.length > 1) {
              let listStr = found.map((s, idx) => `${idx + 1}. *${s.name}* (NIS: ${s.nis})`).join('\n');
              return `Ditemukan *${found.length} siswa* dengan nama serupa di kelas ${teacher.class_name}:\n${listStr}\n\nSilakan ulangi dengan NIS siswa:\nContoh: *SETOR ${found[0].nis} ${parsedAmount}*`;
            }
          }
        }

        if (!targetStudent && amountIdx !== -1) {
          const identifier = cmdArgs.slice(0, amountIdx).join(' ').trim();
          notes = cmdArgs.slice(amountIdx + 1).join(' ').trim();

          const found = db.prepare(`
            SELECT * FROM students 
            WHERE class_id = ? AND is_active = 1 AND (nis = ? OR name LIKE ?)
            ORDER BY name ASC
          `).all(teacher.class_id, identifier, `%${identifier}%`);

          if (found.length === 0) {
            return `Siswa dengan nama atau NIS *"${identifier}"* tidak ditemukan di kelas *${teacher.class_name}*.\nPastikan penulisan nama atau gunakan nomor NIS siswa.`;
          } else if (found.length > 1) {
            let listStr = found.map((s, idx) => `${idx + 1}. *${s.name}* (NIS: ${s.nis})`).join('\n');
            return `Ditemukan *${found.length} siswa* dengan nama serupa di kelas ${teacher.class_name}:\n${listStr}\n\nSilakan ulangi perintah dengan menyertakan NIS siswa:\nContoh: *SETOR ${found[0].nis} ${parsedAmount}*`;
          } else {
            targetStudent = found[0];
          }
        }
      }

      if (!targetStudent || parsedAmount <= 0) {
        return `⚠️ Format setoran tidak valid atau nominal belum dicantumkan.\n\nContoh yang benar:\n👉 *SETOR Ahmad 20000*\n👉 *SETOR 1001 50k Saku hari ini*`;
      }

      try {
        const tx = savingsService.deposit({
          studentId: targetStudent.id,
          teacherId: teacher.id,
          amount: parsedAmount,
          notes: notes || 'Setoran via WhatsApp Bot'
        });

        // Kirim notifikasi otomatis ke WhatsApp Orang Tua jika tersedia
        if (targetStudent.parent_phone) {
          try {
            const queueService = require('./queue');
            const parentMsg = `🔔 *NOTIFIKASI SETORAN TABUNGAN*\n` +
              `🏫 *${schoolName}*\n` +
              `━━━━━━━━━━━━━━━━━━━━━\n` +
              `Yth. Orang Tua / Wali dari ananda *${targetStudent.name}*,\n\n` +
              `Telah diterima setoran tabungan siswa:\n` +
              `🟢 *Jumlah Setor:* ${savingsService.formatRupiah(parsedAmount)}\n` +
              `💵 *Saldo Saat Ini:* *${savingsService.formatRupiah(tx.balance_after)}*\n` +
              `📅 *Tanggal:* ${tx.transaction_date}\n` +
              `👨‍🏫 *Wali Kelas:* ${teacher.name}\n` +
              (notes ? `📝 *Catatan:* ${notes}\n` : '') +
              `━━━━━━━━━━━━━━━━━━━━━\n` +
              `_Ketik *TABUNGAN* untuk mengecek rincian saldo ananda._`;

            queueService.enqueue({
              studentId: targetStudent.id,
              phone: targetStudent.parent_phone,
              message: parentMsg,
              type: 'SAVINGS'
            });
          } catch (waErr) {
            console.warn('[BotService] Gagal antrekan notif WA ortu:', waErr.message);
          }
        }

        let resp = `✅ *SETORAN TABUNGAN BERHASIL DICATAT*\n`;
        resp += `🏫 *${schoolName}*\n`;
        resp += `━━━━━━━━━━━━━━━━━━━━━\n`;
        resp += `👤 *Siswa:* ${targetStudent.name}\n`;
        resp += `🆔 *NIS:* ${targetStudent.nis}\n`;
        resp += `🏷️ *Kelas:* ${teacher.class_name}\n`;
        resp += `━━━━━━━━━━━━━━━━━━━━━\n`;
        resp += `🟢 *Jumlah Setor:* *${savingsService.formatRupiah(parsedAmount)}*\n`;
        resp += `💵 *Saldo Sekarang:* *${savingsService.formatRupiah(tx.balance_after)}*\n`;
        if (notes) resp += `📝 *Catatan:* ${notes}\n`;
        resp += `━━━━━━━━━━━━━━━━━━━━━\n`;
        if (targetStudent.parent_phone) {
          resp += `📲 _Notifikasi otomatis telah dikirimkan ke WhatsApp Wali Murid (${targetStudent.parent_phone})._`;
        } else {
          resp += `⚠️ _Nomor WhatsApp orang tua belum terdaftar di profil siswa._`;
        }

        return resp;
      } catch (err) {
        return `Gagal mencatat setoran tabungan: ${err.message}`;
      }
    }

    // ==========================================
    // 4.2 PERINTAH KHUSUS GURU: TARIK TABUNGAN SISWA
    // ==========================================
    if (firstWord === 'TARIK' || firstWord === 'AMBIL') {
      if (!teacher) {
        return `⚠️ Perintah *TARIK* khusus untuk Guru / Wali Kelas *${schoolName}*.`;
      }

      if (!teacher.class_id) {
        return `Halo ${teacher.name}, akun Anda belum ditugaskan sebagai Wali Kelas dari rombel tertentu di sistem.`;
      }

      // Syntax: TARIK <NAMA/NIS> <JUMLAH> [CATATAN]
      if (tokens.length < 2) {
        return `ℹ️ *PANDUAN PENARIKAN TABUNGAN SISWA*\n` +
          `━━━━━━━━━━━━━━━━━━━━━\n` +
          `Format:\n` +
          `👉 *TARIK <NAMA/NIS> <JUMLAH> [CATATAN]*\n\n` +
          `Contoh:\n` +
          `• *TARIK Ahmad 10000*\n` +
          `• *TARIK 1001 20k Keperluan buku*\n\n` +
          `_Jumlah penarikan tidak boleh melebihi saldo tabungan siswa._`;
      }

      const cmdArgs = tokens.slice(1);
      let targetStudent = null;
      let parsedAmount = 0;
      let notes = '';

      const studentByNis = db.prepare(`
        SELECT * FROM students 
        WHERE class_id = ? AND is_active = 1 AND nis = ?
      `).get(teacher.class_id, cmdArgs[0]);

      if (studentByNis && cmdArgs.length >= 2) {
        targetStudent = studentByNis;
        parsedAmount = savingsService.parseAmount(cmdArgs[1]);
        notes = cmdArgs.slice(2).join(' ').trim();
      } else {
        let amountIdx = -1;
        for (let i = 1; i < cmdArgs.length; i++) {
          const amt = savingsService.parseAmount(cmdArgs[i]);
          if (amt >= 500) {
            amountIdx = i;
            parsedAmount = amt;
            break;
          }
        }

        if (!targetStudent && amountIdx !== -1) {
          const identifier = cmdArgs.slice(0, amountIdx).join(' ').trim();
          notes = cmdArgs.slice(amountIdx + 1).join(' ').trim();

          const found = db.prepare(`
            SELECT * FROM students 
            WHERE class_id = ? AND is_active = 1 AND (nis = ? OR name LIKE ?)
            ORDER BY name ASC
          `).all(teacher.class_id, identifier, `%${identifier}%`);

          if (found.length === 0) {
            return `Siswa dengan nama atau NIS *"${identifier}"* tidak ditemukan di kelas *${teacher.class_name}*.`;
          } else if (found.length > 1) {
            let listStr = found.map((s, idx) => `${idx + 1}. *${s.name}* (NIS: ${s.nis})`).join('\n');
            return `Ditemukan *${found.length} siswa* dengan nama serupa di kelas ${teacher.class_name}:\n${listStr}\n\nSilakan ulangi dengan NIS:\nContoh: *TARIK ${found[0].nis} ${parsedAmount}*`;
          } else {
            targetStudent = found[0];
          }
        }
      }

      if (!targetStudent || parsedAmount <= 0) {
        return `⚠️ Format penarikan tidak valid atau nominal belum dicantumkan.\nContoh: *TARIK Ahmad 10000* atau *TARIK 1001 20rb*`;
      }

      const currentBalance = Number(targetStudent.savings_balance) || 0;
      if (currentBalance < parsedAmount) {
        return `⚠️ *Penarikan Ditolak: Saldo Tidak Mencukupi*\n\n` +
          `👤 Siswa: *${targetStudent.name}* (${targetStudent.nis})\n` +
          `💵 Saldo Saat Ini: *${savingsService.formatRupiah(currentBalance)}*\n` +
          `🔴 Ingin Ditarik: *${savingsService.formatRupiah(parsedAmount)}*\n\n` +
          `Jumlah penarikan melebihi saldo tabungan siswa.`;
      }

      try {
        const tx = savingsService.withdraw({
          studentId: targetStudent.id,
          teacherId: teacher.id,
          amount: parsedAmount,
          notes: notes || 'Penarikan via WhatsApp Bot'
        });

        // Notifikasi ke Orang Tua
        if (targetStudent.parent_phone) {
          try {
            const queueService = require('./queue');
            const parentMsg = `🔔 *NOTIFIKASI PENARIKAN TABUNGAN*\n` +
              `🏫 *${schoolName}*\n` +
              `━━━━━━━━━━━━━━━━━━━━━\n` +
              `Yth. Orang Tua / Wali dari ananda *${targetStudent.name}*,\n\n` +
              `Telah dilakukan penarikan saldo tabungan siswa:\n` +
              `🔴 *Jumlah Tarik:* ${savingsService.formatRupiah(parsedAmount)}\n` +
              `💵 *Sisa Saldo Tabungan:* *${savingsService.formatRupiah(tx.balance_after)}*\n` +
              `📅 *Tanggal:* ${tx.transaction_date}\n` +
              `👨‍🏫 *Wali Kelas:* ${teacher.name}\n` +
              (notes ? `📝 *Keperluan/Catatan:* ${notes}\n` : '') +
              `━━━━━━━━━━━━━━━━━━━━━\n` +
              `_Ketik *TABUNGAN* untuk mengecek rincian buku tabungan ananda._`;

            queueService.enqueue({
              studentId: targetStudent.id,
              phone: targetStudent.parent_phone,
              message: parentMsg,
              type: 'SAVINGS'
            });
          } catch (waErr) {
            console.warn('[BotService] Gagal antrekan notif WA ortu:', waErr.message);
          }
        }

        let resp = `✅ *PENARIKAN TABUNGAN BERHASIL DICATAT*\n`;
        resp += `🏫 *${schoolName}*\n`;
        resp += `━━━━━━━━━━━━━━━━━━━━━\n`;
        resp += `👤 *Siswa:* ${targetStudent.name}\n`;
        resp += `🆔 *NIS:* ${targetStudent.nis}\n`;
        resp += `🏷️ *Kelas:* ${teacher.class_name}\n`;
        resp += `━━━━━━━━━━━━━━━━━━━━━\n`;
        resp += `🔴 *Jumlah Ditarik:* *${savingsService.formatRupiah(parsedAmount)}*\n`;
        resp += `💵 *Sisa Saldo:* *${savingsService.formatRupiah(tx.balance_after)}*\n`;
        if (notes) resp += `📝 *Catatan:* ${notes}\n`;
        resp += `━━━━━━━━━━━━━━━━━━━━━\n`;
        if (targetStudent.parent_phone) {
          resp += `📲 _Notifikasi otomatis telah dikirimkan ke WhatsApp Wali Murid (${targetStudent.parent_phone})._`;
        }

        return resp;
      } catch (err) {
        return `Gagal mencatat penarikan tabungan: ${err.message}`;
      }
    }

    // ==========================================
    // 5. PERINTAH: JADWAL & OPERASIONAL SEKOLAH
    // ==========================================
    const isScheduleQuery = /^(JADWAL|JAM\s*MASUK|TATA\s*TERTIB|JADWAL\s*SEKOLAH)$/i.test(rawText.trim()) || 
                            firstWord === 'JADWAL';
    if (isScheduleQuery) {
      const jamMasuk = settings.jam_masuk || '07:00';
      const toleransi = settings.toleransi_telat || '07:15';
      const hariAktif = settings.hari_aktif || 'Senin – Jumat';
      const pengumumanJudul = settings.announcement_title || 'Tata Tertib Kehadiran';
      const pengumumanIsi = settings.announcement_content || '';

      let resp = `⏰ *JADWAL OPERASIONAL & TATA TERTIB*\n`;
      resp += `🏫 *${schoolName}*\n`;
      resp += `━━━━━━━━━━━━━━━━━━━━━\n`;
      resp += `📅 *Hari Aktif Sekolah:* ${hariAktif}\n`;
      resp += `🔔 *Jam Masuk:* Pukul ${jamMasuk} WIB\n`;
      resp += `🚪 *Pintu Gerbang Ditutup:* Pukul ${toleransi} WIB\n\n`;
      resp += `📌 *Ketentuan Kedisiplinan:*\n`;
      resp += `• Siswa yang hadir setelah pukul ${jamMasuk} WIB dicatat *Terlambat*.\n`;
      resp += `• Gerbang ditutup pukul ${toleransi} WIB.\n`;
      if (pengumumanIsi) {
        resp += `\n📢 *Catatan Sekolah:*\n_${pengumumanIsi}_\n`;
      }
      resp += `━━━━━━━━━━━━━━━━━━━━━\n`;
      resp += `_Ketik *MENU* untuk layanan lainnya._`;
      return resp;
    }

    // ==========================================
    // 6. PERINTAH: KONTAK WALI KELAS
    // ==========================================
    const isWaliQuery = /^(WALI|WALIKELAS|WALI\s*KELAS|KONTAK\s*WALI)$/i.test(rawText.trim()) || 
                        firstWord === 'WALI' || firstWord === 'WALIKELAS';
    if (isWaliQuery) {
      if (parentStudents.length > 0) {
        let resp = `👨‍🏫 *KONTAK WALI KELAS ANANDA*\n`;
        resp += `🏫 *${schoolName}*\n`;
        resp += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

        parentStudents.forEach(s => {
          const wk = db.prepare("SELECT name, phone FROM users WHERE role = 'guru' AND class_id = ? LIMIT 1").get(s.class_id);
          resp += `👤 *Siswa:* ${s.name} (Kelas ${s.class_name})\n`;
          if (wk) {
            resp += `• Wali Kelas: *${wk.name}*\n`;
            resp += `• Kontak WhatsApp: ${wk.phone ? `*${wk.phone}* (https://wa.me/${wk.phone.replace(/\D/g, '')})` : '_Belum ada nomor tercatat_'}\n\n`;
          } else {
            resp += `• Wali Kelas: _Belum ditentukan_\n\n`;
          }
        });

        resp += `Silakan hubungi Wali Kelas apabila ananda berhalangan hadir atau membutuhkan konsultasi pendidikan.`;
        return resp;
      } else {
        return `Untuk melihat kontak Wali Kelas ananda, pastikan nomor Anda terdaftar di sekolah atau tanyakan langsung melalui nomor resmi sekolah di *${settings.school_phone || '-'}*.`;
      }
    }

    // ==========================================
    // 7. PERINTAH KHUSUS GURU/ADMIN: SETUJU / TOLAK IZIN SISWA & CEK PENDING
    // ==========================================
    if (firstWord === 'SETUJU' || firstWord === 'APPROVE') {
      const reviewer = teacher || admin;
      if (!reviewer) {
        return `⚠️ *Akses Terbatas:*\nPerintah persetujuan izin hanya dapat dilakukan oleh Wali Kelas / Dewan Guru dan Administrator sekolah.`;
      }
      const leaveId = tokens[1];
      if (!leaveId) {
        return `Silakan tentukan nomor ID permohonan yang ingin disetujui.\nContoh: *SETUJU 12*\n\n_Ketik *PENDING* untuk melihat daftar permohonan yang menunggu respon._`;
      }
      return leaveService.processTeacherDecision(reviewer, 'APPROVE', leaveId);
    }

    if (firstWord === 'TOLAK' || firstWord === 'REJECT') {
      const reviewer = teacher || admin;
      if (!reviewer) {
        return `⚠️ *Akses Terbatas:*\nPerintah penolakan izin hanya dapat dilakukan oleh Wali Kelas / Dewan Guru dan Administrator sekolah.`;
      }
      const leaveId = tokens[1];
      if (!leaveId) {
        return `Silakan tentukan nomor ID permohonan yang ingin ditolak.\nContoh: *TOLAK 12 surat dokter belum ada*\n\n_Ketik *PENDING* untuk melihat daftar permohonan yang menunggu respon._`;
      }
      const rejectionNotes = tokens.slice(2).join(' ');
      return leaveService.processTeacherDecision(reviewer, 'REJECT', leaveId, rejectionNotes);
    }

    if (firstWord === 'PENDING') {
      const reviewer = teacher || admin;
      if (!reviewer) {
        return `⚠️ *Akses Terbatas:*\nPerintah *PENDING* khusus untuk Wali Kelas / Dewan Guru dan Administrator sekolah.`;
      }
      return leaveService.getPendingLeavesMessage(reviewer);
    }

    // ==========================================
    // 8. PERINTAH ORANG TUA: LAPORAN IZIN / SAKIT SISWA
    // ==========================================
    if (firstWord === 'IZIN' || firstWord === 'SAKIT') {
      // Periksa apakah guru/admin mengetik "IZIN PENDING"
      if (tokens.length > 1 && tokens[1].toUpperCase() === 'PENDING') {
        const reviewer = teacher || admin;
        if (reviewer) {
          return leaveService.getPendingLeavesMessage(reviewer);
        }
      }

      // Parsing laporan dari orang tua
      const parsed = leaveService.parseLeaveMessage(rawText, parentStudents);

      if (parsed.error === 'NOMOR_TIDAK_TERDAFTAR') {
        return `Nomor WhatsApp Anda (*${senderPhone}*) belum terdaftar sebagai wali murid di sistem absensi *${schoolName}*.\n\nUntuk pelaporan izin/sakit, silakan hubungi pihak sekolah atau gunakan menu izin mandiri di website resmi sekolah: http://localhost:3000/#cek-kehadiran`;
      }

      if (parsed.error === 'HARI_LIBUR') {
        return parsed.message;
      }

      if (parsed.needChildSelection) {
        let chooseMsg = `Ditemukan *${parentStudents.length} siswa* yang terdaftar dengan nomor WhatsApp ini:\n\n`;
        parentStudents.forEach((s, idx) => {
          chooseMsg += `${idx + 1}. *${s.name}* (Kelas ${s.class_name || '-'} • NIS ${s.nis})\n`;
        });
        chooseMsg += `\nSilakan balas dengan format:\n`;
        parentStudents.forEach((s, idx) => {
          chooseMsg += `👉 Ketik *${parsed.type} ${idx + 1} [alasan]* untuk ${s.name.split(' ')[0]}\n`;
        });
        chooseMsg += `\n_Contoh: *${parsed.type} 1 ${parsed.type === 'SAKIT' ? 'demam dan batuk' : 'ada acara keluarga'}*_`;
        return chooseMsg;
      }

      if (parsed.success) {
        const submitRes = leaveService.submitLeaveRequest({
          student: parsed.student,
          type: parsed.type,
          startDate: parsed.startDate,
          endDate: parsed.endDate,
          reason: parsed.reason,
          parentPhone: senderPhone,
          parentName: parsed.student.parent_name
        });

        return submitRes.message;
      }

      return `Format laporan izin/sakit tidak sesuai. Contoh: *SAKIT demam tinggi* atau *IZIN BESOK ada acara keluarga*.`;
    }

    // ==========================================
    // 8. PERINTAH: PROFIL & INFORMASI SEKOLAH
    // ==========================================
    const isInfoQuery = /^(INFO|PROFIL|KONTAK)(\s+SEKOLAH|\s+RESMI)?$/i.test(rawText.trim()) ||
                        ((firstWord === 'INFO' || firstWord === 'PROFIL' || firstWord === 'KONTAK') && tokens.length <= 2);
    if (isInfoQuery) {
      let resp = `🏫 *PROFIL RESMI SEKOLAH*\n`;
      resp += `*${schoolName}*\n`;
      if (settings.school_tagline) resp += `_${settings.school_tagline}_\n`;
      resp += `━━━━━━━━━━━━━━━━━━━━━\n`;
      if (settings.school_accreditation) resp += `🏅 *Akreditasi:* ${settings.school_accreditation}\n`;
      if (settings.school_address) resp += `📍 *Alamat:* ${settings.school_address}\n`;
      if (settings.school_phone) resp += `📞 *Telepon/WA:* ${settings.school_phone}\n`;
      if (settings.school_email) resp += `✉️ *Email:* ${settings.school_email}\n`;
      resp += `🌐 *Website:* http://localhost:3000\n`;
      resp += `━━━━━━━━━━━━━━━━━━━━━\n`;
      resp += `_Ketik *MENU* untuk melihat daftar perintah bantuan._`;
      return resp;
    }

    // ==========================================
    // 9. PERINTAH: MENU / BANTUAN RESMI
    // ==========================================
    const isMenuCommand = /^([!/#]?(MENU|BANTUAN|HELP|PANDUAN))$/i.test(firstWord);

    // Selain perintah resmi bot di atas, pesan masuk TIDAK BOLEH dibalas oleh bot (100% silent)
    if (!isMenuCommand) {
      console.log(`[WhatsApp Bot] Pesan diabaikan (bukan perintah bot resmi): "${rawText}" dari ${senderPhone || senderJid}`);
      return null;
    }

    let greetingTitle = 'Halo!';
    if (teacher) {
      greetingTitle = `Halo Bapak/Ibu Guru *${teacher.name}* (${teacher.class_name ? 'Wali Kelas ' + teacher.class_name : 'Dewan Guru'})!`;
    } else if (parentStudents.length > 0) {
      const pName = parentStudents[0].parent_name ? `Bapak/Ibu ${parentStudents[0].parent_name}` : 'Bapak/Ibu Wali Murid';
      greetingTitle = `Halo ${pName}!`;
    } else if (admin) {
      greetingTitle = `Halo Administrator *${admin.name}*!`;
    }

    let menuMsg = `👋 *${greetingTitle}*\n`;
    menuMsg += `Selamat datang di Layanan Otomatis WhatsApp Bot *${schoolName}*.\n\n`;
    menuMsg += `Berikut daftar perintah yang dapat Anda kirimkan:\n`;
    menuMsg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    menuMsg += `📌 *LAYANAN WALI MURID:*\n`;
    menuMsg += `• *CEK* : Cek kehadiran hari ini & rekap berjalan ananda\n`;
    menuMsg += `• *BULANAN* : Rekapitulasi kehadiran bulanan ananda (Contoh: *BULANAN* atau *BULANAN Agustus*)\n`;
    menuMsg += `• *SAKIT <alasan>* : Lapor ananda sakit (Contoh: *SAKIT demam flu*)\n`;
    menuMsg += `• *IZIN <alasan>* : Lapor izin siswa (Contoh: *IZIN acara keluarga*)\n`;
    menuMsg += `• *SPP* : Cek tagihan SPP & status pembayaran ananda\n`;
    menuMsg += `• *BAYAR <ID>* : Dapatkan barcode QRIS bayar otomatis\n`;
    menuMsg += `• *TABUNGAN* : Cek saldo & mutasi buku tabungan ananda\n`;
    menuMsg += `• *JADWAL* : Jam masuk & tata tertib gerbang\n`;
    menuMsg += `• *WALI* : Kontak Wali Kelas ananda\n`;
    menuMsg += `• *INFO* : Kontak & profil resmi sekolah\n`;

    if (teacher) {
      menuMsg += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
      menuMsg += `📌 *MENU KHUSUS WALI KELAS:*\n`;
      menuMsg += `• *REKAP* : Rekap urutan presensi kelas Anda hari ini\n`;
      menuMsg += `• *REKAP BULANAN* : Rekapitulasi kehadiran satu kelas selama 1 bulan\n`;
      menuMsg += `• *REKAP BULANAN <NIS/NAMA>* : Rincian bulanan siswa tertentu (Contoh: *REKAP BULANAN Ahmad*)\n`;
      menuMsg += `• *BELUM* : Daftar siswa yang belum tap presensi hari ini\n`;
      menuMsg += `• *PENDING* : Cek permohonan izin/sakit yang menunggu respon\n`;
      menuMsg += `• *SETUJU <ID>* : Setujui permohonan izin siswa (Contoh: *SETUJU 12*)\n`;
      menuMsg += `• *TOLAK <ID> <alasan>* : Tolak izin siswa (Contoh: *TOLAK 12 surat belum ada*)\n`;
      menuMsg += `• *TABUNGAN* / *TOTAL TABUNGAN* : Cek rekap & total saldo seluruh murid kelas Anda\n`;
      menuMsg += `• *TABUNGAN <NAMA/NIS>* : Cek saldo & mutasi murid tertentu (Contoh: *TABUNGAN Ahmad*)\n`;
      menuMsg += `• *SETOR <NAMA/NIS> <JUMLAH>* : Tambah tabungan siswa (Contoh: *SETOR Ahmad 20rb*)\n`;
      menuMsg += `• *TARIK <NAMA/NIS> <JUMLAH>* : Catat penarikan tabungan (Contoh: *TARIK Ahmad 10rb*)\n`;
    }

    if (admin) {
      menuMsg += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
      menuMsg += `📌 *MENU KHUSUS ADMINISTRATOR:*\n`;
      menuMsg += `• *PENDING* : Cek seluruh permohonan izin/sakit yang menunggu respon\n`;
      menuMsg += `• *SETUJU <ID>* / *TOLAK <ID>* : Setujui atau tolak izin siswa\n`;
      menuMsg += `• *TABUNGAN* / *TOTAL TABUNGAN* : Cek rekapitulasi & grand total tabungan sekolah\n`;
      menuMsg += `• *INFO* : Kontak & profil resmi sekolah\n`;
    }

    menuMsg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    menuMsg += `_Cukup ketik salah satu kata di atas (contoh: *CEK*, *SPP*, *TABUNGAN*, atau *SETOR*) untuk respon otomatis._`;

    return menuMsg;
  }

  /**
   * Handler Event Pesan Masuk dari Baileys
   */
  async handleMessage(whatsappService, m) {
    try {
      if (!m.messages || m.messages.length === 0) return;

      for (const msg of m.messages) {
        if (!msg.message) continue;

        // Filter bot self-chat kecuali jika remoteJid berbeda
        const sockUser = whatsappService.sock?.user;
        const selfPn = sockUser?.id ? sockUser.id.split(':')[0].split('@')[0] : null;
        const selfLid = sockUser?.lid ? sockUser.lid.split('@')[0] : null;
        const remoteUser = msg.key.remoteJid ? msg.key.remoteJid.split('@')[0] : null;
        const isSelf = msg.key.fromMe && (remoteUser === selfPn || (selfLid && remoteUser === selfLid));
        if (msg.key.fromMe && !isSelf) continue;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid || remoteJid.includes('@g.us') || remoteJid.includes('status@broadcast')) {
          continue; // Abaikan pesan grup dan status WhatsApp
        }

        // Ekstrak isi teks (mendukung format standar, pesan sementara/ephemeral, view once, caption media, dan tombol interaktif)
        let rawMsg = msg.message;
        if (rawMsg?.ephemeralMessage?.message) rawMsg = rawMsg.ephemeralMessage.message;
        if (rawMsg?.viewOnceMessage?.message) rawMsg = rawMsg.viewOnceMessage.message;
        if (rawMsg?.viewOnceMessageV2?.message) rawMsg = rawMsg.viewOnceMessageV2.message;
        if (rawMsg?.documentWithCaptionMessage?.message) rawMsg = rawMsg.documentWithCaptionMessage.message;

        const text = (
          rawMsg?.conversation ||
          rawMsg?.extendedTextMessage?.text ||
          rawMsg?.imageMessage?.caption ||
          rawMsg?.videoMessage?.caption ||
          rawMsg?.documentMessage?.caption ||
          rawMsg?.buttonsResponseMessage?.selectedButtonId ||
          rawMsg?.templateButtonReplyMessage?.selectedId ||
          rawMsg?.listResponseMessage?.singleSelectReply?.selectedRowId ||
          ''
        ).trim();

        if (!text) continue;

        // Resolusi nomor telepon menggunakan metode dari whatsappService
        let resolvedPhone = null;
        if (whatsappService && typeof whatsappService.getPhoneFromKey === 'function') {
          resolvedPhone = whatsappService.getPhoneFromKey(msg.key);
        } else if (whatsappService && typeof whatsappService.resolvePhoneNumber === 'function') {
          resolvedPhone = await whatsappService.resolvePhoneNumber(remoteJid, msg);
        }

        console.log(`[WhatsApp Bot] Pesan diterima dari ${remoteJid} (Phone: ${resolvedPhone || '-'}): "${text}"`);

        // Proses pesan melalui bot router
        const reply = await this.processIncomingMessage(remoteJid, text, resolvedPhone);

        if (reply) {
          // Pengiriman balasan:
          // Jika pesan masuk dari @lid, kirim ke remoteJid (@lid) terlebih dahulu agar langsung muncul di jendela obrolan pengguna
          // Fallback ke ${resolvedPhone}@s.whatsapp.net jika diperlukan
          const primaryJid = remoteJid;
          const fallbackJid = (resolvedPhone && resolvedPhone.length >= 8) ? `${resolvedPhone}@s.whatsapp.net` : null;

          let sent = false;
          // Coba kirim langsung, dengan retry singkat jika soket sedang reconnecting
          for (let attempt = 1; attempt <= 3; attempt++) {
            try {
              if (whatsappService.status === 'connected' && whatsappService.sock) {
                try {
                  if (typeof reply === 'object' && reply.type === 'image') {
                    await whatsappService.sendImageMessage(primaryJid, reply.buffer, reply.caption);
                    console.log(`[WhatsApp Bot] Barcode QRIS terkirim ke ${primaryJid} (dari ${remoteJid})`);
                  } else {
                    await whatsappService.sendTextMessage(primaryJid, reply);
                    console.log(`[WhatsApp Bot] Balasan otomatis terkirim ke ${primaryJid} (dari ${remoteJid})`);
                  }
                  sent = true;
                  break;
                } catch (primErr) {
                  console.warn(`[WhatsApp Bot] Percobaan ${attempt} gagal kirim ke primary JID ${primaryJid}: ${primErr.message}`);
                  if (fallbackJid && fallbackJid !== primaryJid) {
                    if (typeof reply === 'object' && reply.type === 'image') {
                      await whatsappService.sendImageMessage(fallbackJid, reply.buffer, reply.caption);
                      console.log(`[WhatsApp Bot] Barcode QRIS terkirim via fallback ${fallbackJid}`);
                    } else {
                      await whatsappService.sendTextMessage(fallbackJid, reply);
                      console.log(`[WhatsApp Bot] Balasan otomatis terkirim via fallback ${fallbackJid}`);
                    }
                    sent = true;
                    break;
                  }
                  throw primErr;
                }
              }
            } catch (sendErr) {
              console.warn(`[WhatsApp Bot] Percobaan ${attempt} gagal kirim balasan: ${sendErr.message}`);
            }
            if (attempt < 3) {
              await new Promise(r => setTimeout(r, 1000));
            }
          }

          // Fallback: jika tetap belum terkirim setelah 3 kali, masukkan ke antrean wa_queue
          if (!sent && typeof reply === 'string') {
            try {
              const queueService = require('./queue');
              const cleanPhone = (resolvedPhone || remoteJid.split('@')[0]).replace(/\D/g, '');
              queueService.enqueue({
                studentId: null,
                phone: cleanPhone,
                message: reply,
                type: 'BOT_REPLY'
              });
              console.log(`[WhatsApp Bot] Balasan dimasukkan ke antrean wa_queue untuk ${cleanPhone} (akan otomatis terkirim saat tersambung)`);
            } catch (qErr) {
              console.error('[WhatsApp Bot] Gagal memasukkan balasan ke antrean wa_queue:', qErr);
            }
          }
        }
      }
    } catch (err) {
      console.error('[WhatsApp Bot] Error handling message:', err);
    }
  }
}

module.exports = new BotService();
