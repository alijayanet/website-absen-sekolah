const db = require('../database/db');
const { getTodayWIB, getTimeStringWIB, formatDateIndonesia } = require('../utils/timeHelper');

/**
 * Menghasilkan objek rekap urutan presensi siswa secara kronologis untuk sebuah kelas pada tanggal tertentu.
 * @param {number|string} classId ID Kelas
 * @param {string} date Tanggal format YYYY-MM-DD
 * @returns {object} Data rekapitulasi dan teks pesan WhatsApp
 */
function generateTeacherSummary(classId, date) {
  const today = getTodayWIB();
  const targetDate = date || today;

  const targetClass = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  if (!targetClass) {
    throw new Error(`Kelas dengan ID ${classId} tidak ditemukan`);
  }

  // Cari akun wali kelas untuk kelas ini
  const waliKelas = db.prepare(`
    SELECT id, name, username, phone 
    FROM users 
    WHERE role = 'guru' AND class_id = ? 
    LIMIT 1
  `).get(classId);

  // Ambil data presensi yang terurut kronologis dari waktu tap in pertama sampai terakhir
  const attendances = db.prepare(`
    SELECT a.*, s.name as student_name, s.nis, s.nisn, c.name as class_name
    FROM attendances a
    JOIN students s ON a.student_id = s.id
    LEFT JOIN classes c ON s.class_id = c.id
    WHERE a.date = ? AND s.class_id = ?
    ORDER BY a.time_in ASC, a.created_at ASC
  `).all(targetDate, classId);

  // Ambil siswa yang belum hadir pada tanggal ini
  const absentStudents = db.prepare(`
    SELECT s.*, c.name as class_name
    FROM students s
    LEFT JOIN classes c ON s.class_id = c.id
    WHERE s.is_active = 1 AND s.class_id = ?
      AND s.id NOT IN (SELECT student_id FROM attendances WHERE date = ?)
    ORDER BY s.name ASC
  `).all(classId, targetDate);

  const schoolNameSetting = db.prepare("SELECT value FROM settings WHERE key = 'school_name'").get();
  const schoolName = schoolNameSetting?.value || 'Sekolah';

  // Format tanggal bahasa Indonesia (timezone-safe)
  const formattedDate = formatDateIndonesia(targetDate);

  const timeNow = getTimeStringWIB(); // HH:MM dalam WIB

  // Susun teks pesan WhatsApp
  let message = `📋 *REKAP URUTAN PRESENSI SISWA*\n`;
  message += `🏫 *${schoolName}*\n\n`;
  message += `📅 *Hari / Tanggal:* ${formattedDate}\n`;
  message += `🏷️ *Kelas:* ${targetClass.name}\n`;
  message += `👤 *Wali Kelas:* ${waliKelas ? waliKelas.name : '-'}\n`;
  message += `⏰ *Waktu Rekap:* ${timeNow} WIB\n\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `*URUTAN KEHADIRAN SISWA:*\n`;

  const hadirTerlambat = attendances.filter(a => a.status === 'HADIR' || a.status === 'TERLAMBAT');
  const izinSakit = attendances.filter(a => a.status === 'IZIN' || a.status === 'SAKIT');

  if (hadirTerlambat.length === 0) {
    message += `_(Belum ada siswa yang hadir)_\n`;
  } else {
    hadirTerlambat.forEach((a, idx) => {
      const time = a.time_in ? a.time_in.slice(0, 5) : '-';
      let statusDesc = 'Tepat Waktu';
      if (a.status === 'TERLAMBAT') {
        statusDesc = a.late_minutes ? `Terlambat ${a.late_minutes} mnt` : 'Terlambat';
      }
      message += `${idx + 1}. ${a.student_name} (${time} WIB - ${statusDesc})\n`;
    });
  }

  if (izinSakit.length > 0) {
    message += `\n*KETERANGAN IZIN / SAKIT:*\n`;
    izinSakit.forEach(a => {
      const notes = a.notes ? `: ${a.notes}` : '';
      message += `• ${a.student_name} (${a.status}${notes})\n`;
    });
  }

  if (absentStudents.length > 0) {
    message += `\n*BELUM HADIR / ALPA (${absentStudents.length} Siswa):*\n`;
    const absentNames = absentStudents.map(s => s.name).join(', ');
    message += `• ${absentNames}\n`;
  }

  const countHadir = attendances.filter(a => a.status === 'HADIR').length;
  const countTelat = attendances.filter(a => a.status === 'TERLAMBAT').length;
  const countIzin = attendances.filter(a => a.status === 'IZIN').length;
  const countSakit = attendances.filter(a => a.status === 'SAKIT').length;
  const countBelumHadir = absentStudents.length;
  const totalStudents = countHadir + countTelat + countIzin + countSakit + countBelumHadir;

  message += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `📊 *RINGKASAN KEHADIRAN:*\n`;
  message += `✅ Tepat Waktu: ${countHadir} siswa\n`;
  message += `⚠️ Terlambat: ${countTelat} siswa\n`;
  if (countIzin > 0) message += `📝 Izin: ${countIzin} siswa\n`;
  if (countSakit > 0) message += `🏥 Sakit: ${countSakit} siswa\n`;
  message += `❌ Belum Hadir / Alpa: ${countBelumHadir} siswa\n`;
  message += `👥 Total Siswa: ${totalStudents} siswa\n`;
  message += `━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `_Laporan otomatis Sistem Absensi ${schoolName}_`;

  return {
    success: true,
    classId: targetClass.id,
    className: targetClass.name,
    teacherName: waliKelas ? waliKelas.name : null,
    teacherPhone: waliKelas ? (waliKelas.phone || '') : '',
    date: targetDate,
    formattedDate,
    attendancesCount: attendances.length,
    absentCount: absentStudents.length,
    totalStudents,
    message
  };
}

/**
 * Standarisasi input bulan/tahun menjadi format YYYY-MM
 * @param {string} input Misal: '2026-08', '08-2026', 'agustus', '8', 'september'
 * @returns {{ monthPrefix: string, monthName: string, year: string }}
 */
function parseMonthParam(input) {
  const today = getTodayWIB(); // e.g. "2026-09-22"
  const defaultYear = today.slice(0, 4);
  const defaultMonth = today.slice(5, 7);

  if (!input || !input.trim()) {
    const d = new Date(`${defaultYear}-${defaultMonth}-01T12:00:00Z`);
    const monthName = d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    return { monthPrefix: `${defaultYear}-${defaultMonth}`, monthName, year: defaultYear };
  }

  const str = input.trim().toLowerCase();

  // Pola YYYY-MM (misal: 2026-08)
  const yyyyMm = str.match(/^(\d{4})[-/](\d{1,2})$/);
  if (yyyyMm) {
    const y = yyyyMm[1];
    const m = String(yyyyMm[2]).padStart(2, '0');
    const d = new Date(`${y}-${m}-01T12:00:00Z`);
    const monthName = d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    return { monthPrefix: `${y}-${m}`, monthName, year: y };
  }

  // Pola MM-YYYY (misal: 08-2026 atau 8/2026)
  const mmYyyy = str.match(/^(\d{1,2})[-/](\d{4})$/);
  if (mmYyyy) {
    const m = String(mmYyyy[1]).padStart(2, '0');
    const y = mmYyyy[2];
    const d = new Date(`${y}-${m}-01T12:00:00Z`);
    const monthName = d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    return { monthPrefix: `${y}-${m}`, monthName, year: y };
  }

  // Pola nama bulan teks (misal: "agustus" atau "agustus 2026" atau "8")
  const monthsMap = {
    '1': '01', 'jan': '01', 'januari': '01',
    '2': '02', 'feb': '02', 'februari': '02',
    '3': '03', 'mar': '03', 'maret': '03',
    '4': '04', 'apr': '04', 'april': '04',
    '5': '05', 'mei': '05',
    '6': '06', 'jun': '06', 'juni': '06',
    '7': '07', 'jul': '07', 'juli': '07',
    '8': '08', 'agu': '08', 'agustus': '08',
    '9': '09', 'sep': '09', 'september': '09',
    '10': '10', 'okt': '10', 'oktober': '10',
    '11': '11', 'nov': '11', 'nop': '11', 'november': '11',
    '12': '12', 'des': '12', 'desember': '12'
  };

  const tokens = str.split(/\s+/);
  let detectedMonth = null;
  let detectedYear = defaultYear;

  for (const t of tokens) {
    if (/^\d{4}$/.test(t)) {
      detectedYear = t;
    } else if (monthsMap[t]) {
      detectedMonth = monthsMap[t];
    }
  }

  if (detectedMonth) {
    const d = new Date(`${detectedYear}-${detectedMonth}-01T12:00:00Z`);
    const monthName = d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
    return { monthPrefix: `${detectedYear}-${detectedMonth}`, monthName, year: detectedYear };
  }

  // Fallback bulan berjalan
  const d = new Date(`${defaultYear}-${defaultMonth}-01T12:00:00Z`);
  const monthName = d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
  return { monthPrefix: `${defaultYear}-${defaultMonth}`, monthName, year: defaultYear };
}

/**
 * Menghasilkan objek rekapitulasi kehadiran bulanan seorang siswa
 * @param {number|string} studentId 
 * @param {string} [monthParam] 
 * @returns {object}
 */
function generateMonthlyStudentSummary(studentId, monthParam) {
  const { monthPrefix, monthName } = parseMonthParam(monthParam);

  const student = db.prepare(`
    SELECT s.*, c.name as class_name
    FROM students s
    LEFT JOIN classes c ON s.class_id = c.id
    WHERE s.id = ?
  `).get(studentId);

  if (!student) {
    throw new Error('Data siswa tidak ditemukan.');
  }

  const schoolNameSetting = db.prepare("SELECT value FROM settings WHERE key = 'school_name'").get();
  const schoolName = schoolNameSetting?.value || 'Sekolah';

  const waliKelas = db.prepare(`
    SELECT name, phone FROM users WHERE role = 'guru' AND class_id = ? LIMIT 1
  `).get(student.class_id);

  // Statistik kehadiran
  const stats = db.prepare(`
    SELECT 
      SUM(CASE WHEN status = 'HADIR' THEN 1 ELSE 0 END) as hadir,
      SUM(CASE WHEN status = 'TERLAMBAT' THEN 1 ELSE 0 END) as terlambat,
      SUM(CASE WHEN status = 'TERLAMBAT' THEN COALESCE(late_minutes, 0) ELSE 0 END) as total_late_minutes,
      SUM(CASE WHEN status = 'SAKIT' THEN 1 ELSE 0 END) as sakit,
      SUM(CASE WHEN status = 'IZIN' THEN 1 ELSE 0 END) as izin,
      SUM(CASE WHEN status = 'ALPA' THEN 1 ELSE 0 END) as alpa,
      COUNT(*) as total_recorded
    FROM attendances 
    WHERE student_id = ? AND date LIKE ?
  `).get(student.id, `${monthPrefix}%`);

  const countHadir = stats?.hadir || 0;
  const countTelat = stats?.terlambat || 0;
  const countSakit = stats?.sakit || 0;
  const countIzin = stats?.izin || 0;
  const countAlpa = stats?.alpa || 0;
  const totalLateMin = stats?.total_late_minutes || 0;
  const totalEffectiveDays = countHadir + countTelat + countSakit + countIzin + countAlpa;
  const percentage = totalEffectiveDays > 0 ? Math.round(((countHadir + countTelat) / totalEffectiveDays) * 100) : 0;

  // Catatan keterlambatan / izin / sakit / alpa
  const noteRecords = db.prepare(`
    SELECT date, status, time_in, late_minutes, notes
    FROM attendances
    WHERE student_id = ? AND date LIKE ? AND status IN ('TERLAMBAT', 'SAKIT', 'IZIN', 'ALPA')
    ORDER BY date ASC
  `).all(student.id, `${monthPrefix}%`);

  let detailsText = '';
  if (noteRecords.length === 0) {
    if (countHadir > 0) {
      detailsText = '🌟 *Catatan Disiplin:* Luar biasa! Ananda selalu hadir tepat waktu tanpa ada keterlambatan maupun ketidakhadiran pada bulan ini.\n';
    } else {
      detailsText = '_(Belum ada catatan presensi pada periode ini)_\n';
    }
  } else {
    detailsText = '*RINCIAN KETERLAMBATAN & KETIDAKHADIRAN:*\n';
    noteRecords.forEach((r, idx) => {
      const dObj = new Date(r.date + 'T12:00:00Z');
      const dFormatted = dObj.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
      const time = r.time_in ? r.time_in.slice(0, 5) : '-';
      
      let statusStr = '';
      if (r.status === 'TERLAMBAT') {
        statusStr = `⚠️ Terlambat ${r.late_minutes || 0} mnt (pukul ${time} WIB)`;
      } else if (r.status === 'SAKIT') {
        statusStr = `🏥 Sakit${r.notes ? ' (' + r.notes + ')' : ''}`;
      } else if (r.status === 'IZIN') {
        statusStr = `📝 Izin${r.notes ? ' (' + r.notes + ')' : ''}`;
      } else {
        statusStr = `❌ Alpa / Tanpa Keterangan`;
      }
      detailsText += `${idx + 1}. *${dFormatted}*: ${statusStr}\n`;
    });
  }

  let msg = `📊 *REKAPITULASI KEHADIRAN BULANAN*\n`;
  msg += `🏫 *${schoolName}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `👤 *Nama Siswa:* ${student.name}\n`;
  msg += `🏷️ *Kelas:* ${student.class_name || '-'}\n`;
  msg += `🆔 *NIS:* ${student.nis}\n`;
  if (waliKelas) {
    msg += `👨‍🏫 *Wali Kelas:* ${waliKelas.name}\n`;
  }
  msg += `📅 *Periode:* ${monthName}\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `📈 *PERSENTASE KEHADIRAN: ${percentage}%*\n\n`;

  msg += `📊 *RINGKASAN AKUMULASI HARI:*\n`;
  msg += `✅ Hadir Tepat Waktu : ${countHadir} hari\n`;
  msg += `⚠️ Hadir Terlambat   : ${countTelat} hari ${totalLateMin > 0 ? `(total ${totalLateMin} menit)` : ''}\n`;
  msg += `🏥 Sakit             : ${countSakit} hari\n`;
  msg += `📝 Izin              : ${countIzin} hari\n`;
  msg += `❌ Alpa              : ${countAlpa} hari\n`;
  msg += `📅 Total Hari Efektif : ${totalEffectiveDays} hari\n\n`;

  msg += detailsText;
  msg += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `_Laporan resmi Sistem Absensi ${schoolName}_`;

  return {
    success: true,
    student,
    monthPrefix,
    monthName,
    stats: {
      hadir: countHadir,
      terlambat: countTelat,
      sakit: countSakit,
      izin: countIzin,
      alpa: countAlpa,
      totalEffectiveDays,
      percentage
    },
    message: msg
  };
}

/**
 * Menghasilkan rekapitulasi kehadiran bulanan seluruh siswa di sebuah rombel kelas
 * @param {number|string} classId 
 * @param {string} [monthParam] 
 * @returns {object}
 */
function generateMonthlyClassSummary(classId, monthParam) {
  const { monthPrefix, monthName } = parseMonthParam(monthParam);

  const targetClass = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
  if (!targetClass) {
    throw new Error('Data kelas tidak ditemukan.');
  }

  const schoolNameSetting = db.prepare("SELECT value FROM settings WHERE key = 'school_name'").get();
  const schoolName = schoolNameSetting?.value || 'Sekolah';

  const waliKelas = db.prepare(`
    SELECT name, phone FROM users WHERE role = 'guru' AND class_id = ? LIMIT 1
  `).get(classId);

  // Ambil data siswa dan rekap presensi per siswa di kelas ini
  const students = db.prepare(`
    SELECT 
      s.id as student_id, s.name as student_name, s.nis,
      COALESCE(SUM(CASE WHEN a.status = 'HADIR' THEN 1 ELSE 0 END), 0) as hadir,
      COALESCE(SUM(CASE WHEN a.status = 'TERLAMBAT' THEN 1 ELSE 0 END), 0) as terlambat,
      COALESCE(SUM(CASE WHEN a.status = 'SAKIT' THEN 1 ELSE 0 END), 0) as sakit,
      COALESCE(SUM(CASE WHEN a.status = 'IZIN' THEN 1 ELSE 0 END), 0) as izin,
      COALESCE(SUM(CASE WHEN a.status = 'ALPA' THEN 1 ELSE 0 END), 0) as alpa,
      COALESCE(SUM(CASE WHEN a.status = 'TERLAMBAT' THEN COALESCE(a.late_minutes, 0) ELSE 0 END), 0) as total_late_minutes
    FROM students s
    LEFT JOIN attendances a ON s.id = a.student_id AND a.date LIKE ?
    WHERE s.class_id = ? AND s.is_active = 1
    GROUP BY s.id
    ORDER BY s.name ASC
  `).all(`${monthPrefix}%`, classId);

  if (students.length === 0) {
    return {
      success: false,
      message: `Belum ada siswa aktif terdaftar di kelas ${targetClass.name}.`
    };
  }

  let totalClassHadir = 0;
  let totalClassTelat = 0;
  let totalClassSakit = 0;
  let totalClassIzin = 0;
  let totalClassAlpa = 0;

  let listText = '';
  students.forEach((s, idx) => {
    totalClassHadir += s.hadir;
    totalClassTelat += s.terlambat;
    totalClassSakit += s.sakit;
    totalClassIzin += s.izin;
    totalClassAlpa += s.alpa;

    const totalDays = s.hadir + s.terlambat + s.sakit + s.izin + s.alpa;
    const pct = totalDays > 0 ? Math.round(((s.hadir + s.terlambat) / totalDays) * 100) : 0;

    listText += `${idx + 1}. *${s.student_name}* (NIS: ${s.nis})\n`;
    listText += `   └ H:${s.hadir} • T:${s.terlambat} • S:${s.sakit} • I:${s.izin} • A:${s.alpa} ➔ *${pct}%*\n`;
  });

  const grandTotal = totalClassHadir + totalClassTelat + totalClassSakit + totalClassIzin + totalClassAlpa;
  const avgPercentage = grandTotal > 0 ? Math.round(((totalClassHadir + totalClassTelat) / grandTotal) * 100) : 0;

  let msg = `📊 *REKAP PRESENSI BULANAN KELAS*\n`;
  msg += `🏫 *${schoolName}*\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `🏷️ *Kelas:* ${targetClass.name}\n`;
  if (waliKelas) {
    msg += `👨‍🏫 *Wali Kelas:* ${waliKelas.name}\n`;
  }
  msg += `📅 *Periode:* ${monthName}\n`;
  msg += `👥 *Jumlah Siswa:* ${students.length} orang\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n\n`;

  msg += `📈 *RATA-RATA KEHADIRAN KELAS: ${avgPercentage}%*\n\n`;
  msg += `📋 *RINGKASAN KEHADIRAN SISWA:*\n`;
  msg += `_(Ket: H=Hadir, T=Terlambat, S=Sakit, I=Izin, A=Alpa)_\n\n`;
  msg += listText;

  msg += `\n━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `📊 *TOTAL AKUMULASI SATU KELAS:*\n`;
  msg += `• Tepat Waktu: ${totalClassHadir}x hadir\n`;
  msg += `• Terlambat: ${totalClassTelat}x\n`;
  msg += `• Izin/Sakit: ${totalClassIzin + totalClassSakit}x\n`;
  msg += `• Alpa: ${totalClassAlpa}x\n`;
  msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
  msg += `_Untuk rincian murid tertentu, ketik:\n👉 *REKAP BULANAN <NIS/NAMA>*\nContoh: *REKAP BULANAN ${students[0].nis}*_`;

  return {
    success: true,
    classId: targetClass.id,
    className: targetClass.name,
    monthPrefix,
    monthName,
    studentsCount: students.length,
    avgPercentage,
    message: msg
  };
}

module.exports = {
  generateTeacherSummary,
  parseMonthParam,
  generateMonthlyStudentSummary,
  generateMonthlyClassSummary
};

