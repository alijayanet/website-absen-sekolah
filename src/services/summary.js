const db = require('../database/db');

/**
 * Menghasilkan objek rekap urutan presensi siswa secara kronologis untuk sebuah kelas pada tanggal tertentu.
 * @param {number|string} classId ID Kelas
 * @param {string} date Tanggal format YYYY-MM-DD
 * @returns {object} Data rekapitulasi dan teks pesan WhatsApp
 */
function generateTeacherSummary(classId, date) {
  const today = new Date().toLocaleDateString('en-CA');
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

  // Format tanggal bahasa Indonesia
  const targetDateObj = new Date(targetDate + 'T00:00:00');
  const formattedDate = targetDateObj.toLocaleDateString('id-ID', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });

  const now = new Date();
  const timeNow = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

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

module.exports = { generateTeacherSummary };
