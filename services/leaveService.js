/**
 * leaveService.js — Modul Penanganan Pengajuan Izin / Sakit Mandiri via WhatsApp
 * 
 * Alur:
 * 1. Orang Tua mengajukan via bot WA (IZIN / SAKIT)
 * 2. Sistem memvalidasi, menyimpan ke tabel leave_requests (status PENDING)
 * 3. Sistem meneruskan permohonan ke WhatsApp Wali Kelas (atau Admin jika belum ada guru)
 * 4. Guru / Admin dapat menyetujui (SETUJU <ID>) atau menolak (TOLAK <ID> [alasan]) langsung via WhatsApp
 * 5. Saat disetujui, kehadiran otomatis tercatat di tabel attendances dan Orang Tua menerima notifikasi WA
 */

const db = require('../database/db');
const queue = require('./queue');
const { getTodayWIB, getRelativeDateWIB, isWeekend, formatDateIndonesia } = require('../utils/timeHelper');

class LeaveService {
  /**
   * Helper untuk mengonversi nama bulan Indonesia ke angka 2 digit
   */
  getMonthNumber(monthStr) {
    if (!monthStr) return null;
    const m = monthStr.toLowerCase();
    const months = {
      jan: '01', januari: '01',
      feb: '02', februari: '02',
      mar: '03', maret: '03',
      apr: '04', april: '04',
      mei: '05',
      jun: '06', juni: '06',
      jul: '07', juli: '07',
      agu: '08', agust: '08', agustus: '08',
      sep: '09', sept: '09', september: '09',
      okt: '10', oktober: '10',
      nop: '11', nov: '11', november: '11',
      des: '12', desember: '12'
    };
    return months[m] || null;
  }

  /**
   * Parse teks pesan laporan izin/sakit dari orang tua
   * @param {string} rawText Teks pesan lengkap dari orang tua
   * @param {Array} parentStudents Daftar siswa yang dimiliki orang tua
   * @returns {object} Hasil parsing
   */
  parseLeaveMessage(rawText, parentStudents = []) {
    const text = (rawText || '').trim();
    const tokens = text.split(/\s+/);
    const firstWord = tokens[0].toUpperCase();
    const type = (firstWord === 'SAKIT') ? 'SAKIT' : 'IZIN';

    // 1. Tentukan Siswa yang Dimaksud
    let selectedStudent = null;
    let remainingTokens = tokens.slice(1);

    if (parentStudents.length === 0) {
      return {
        error: 'NOMOR_TIDAK_TERDAFTAR',
        message: 'Nomor WhatsApp Anda belum terdaftar sebagai wali murid di sistem absensi sekolah.'
      };
    } else if (parentStudents.length === 1) {
      selectedStudent = parentStudents[0];
    } else {
      // Orang tua memiliki lebih dari 1 anak terdaftar
      // Cek apakah token pertama setelah perintah adalah nomor urut anak (misal: "IZIN 1 ...")
      if (remainingTokens.length > 0) {
        const firstArg = remainingTokens[0];
        const numIdx = parseInt(firstArg, 10);
        if (!isNaN(numIdx) && numIdx >= 1 && numIdx <= parentStudents.length) {
          selectedStudent = parentStudents[numIdx - 1];
          remainingTokens = remainingTokens.slice(1);
        } else {
          // Cek apakah ada kecocokan nama siswa di token
          for (let i = 0; i < parentStudents.length; i++) {
            const s = parentStudents[i];
            const firstName = s.name.split(' ')[0].toLowerCase();
            if (firstArg.toLowerCase() === firstName || s.name.toLowerCase().startsWith(firstArg.toLowerCase())) {
              selectedStudent = s;
              remainingTokens = remainingTokens.slice(1);
              break;
            }
          }
        }
      }

      // Jika belum dapat menentukan anak, minta orang tua untuk memilih anak terlebih dahulu
      if (!selectedStudent) {
        return {
          needChildSelection: true,
          type,
          parentStudents
        };
      }
    }

    // 2. Parse Tanggal Pengajuan (Default: hari ini dalam WIB)
    const today = getTodayWIB();
    let startDate = today;
    let endDate = today;

    const remainingText = remainingTokens.join(' ');
    let cleanReason = remainingText;

    // A. Deteksi kata kunci tanggal relatif
    if (/\bKEMARIN\b/i.test(cleanReason)) {
      startDate = getRelativeDateWIB(-1);
      endDate = startDate;
      cleanReason = cleanReason.replace(/\bKEMARIN\b/gi, '').trim();
    } else if (/\bBESOK\b/i.test(cleanReason)) {
      startDate = getRelativeDateWIB(1);
      endDate = startDate;
      cleanReason = cleanReason.replace(/\bBESOK\b/gi, '').trim();
    } else if (/\bLUSA\b/i.test(cleanReason)) {
      startDate = getRelativeDateWIB(2);
      endDate = startDate;
      cleanReason = cleanReason.replace(/\bLUSA\b/gi, '').trim();
    } else if (/\bHARI\s+INI\b/i.test(cleanReason)) {
      startDate = today;
      endDate = today;
      cleanReason = cleanReason.replace(/\bHARI\s+INI\b/gi, '').trim();
    }

    // B. Deteksi format YYYY-MM-DD spesifik (misal: 2026-09-23)
    const isoDateMatch = cleanReason.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
    if (isoDateMatch) {
      startDate = isoDateMatch[0];
      endDate = isoDateMatch[0];
      cleanReason = cleanReason.replace(isoDateMatch[0], '').trim();
    }

    // C. Deteksi format DD/MM/YYYY atau DD-MM-YYYY (misal: 23/09/2026 atau 23-09-2026)
    const ddmmyyyyMatch = cleanReason.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
    if (ddmmyyyyMatch) {
      const d = String(ddmmyyyyMatch[1]).padStart(2, '0');
      const m = String(ddmmyyyyMatch[2]).padStart(2, '0');
      const y = ddmmyyyyMatch[3];
      startDate = `${y}-${m}-${d}`;
      endDate = startDate;
      cleanReason = cleanReason.replace(ddmmyyyyMatch[0], '').trim();
    }

    // D. Deteksi format DD Bulan YYYY (misal: 23 September 2026 atau 23 Sep)
    const textDateMatch = cleanReason.match(/\b(\d{1,2})\s+([a-zA-Z]{3,9})(?:\s+(\d{4}))?\b/i);
    if (textDateMatch) {
      const dayNum = String(textDateMatch[1]).padStart(2, '0');
      const monthNum = this.getMonthNumber(textDateMatch[2]);
      if (monthNum) {
        const yearNum = textDateMatch[3] || today.slice(0, 4);
        startDate = `${yearNum}-${monthNum}-${dayNum}`;
        endDate = startDate;
        cleanReason = cleanReason.replace(textDateMatch[0], '').trim();
      }
    }

    // E. Bersihkan alasan dari tanda baca berlebih di awal (seperti - atau :)
    cleanReason = cleanReason.replace(/^[\s:\-\,\.]+/, '').trim();

    // Jika alasan kosong, berikan alasan default yang sopan
    if (!cleanReason) {
      cleanReason = (type === 'SAKIT') ? 'Sakit / Kurang Sehat' : 'Izin Kepentingan Keluarga';
    }

    // 3. Validasi Hari Libur / Akhir Pekan (Sabtu & Minggu)
    if (isWeekend(startDate) && isWeekend(endDate)) {
      const dayFormatted = formatDateIndonesia(startDate);
      return {
        error: 'HARI_LIBUR',
        message: `Tanggal yang diajukan (${dayFormatted}) merupakan hari libur akhir pekan (Sabtu/Minggu).\n\nKegiatan pembelajaran tidak aktif pada hari tersebut, sehingga pelaporan absensi tidak diperlukan. Terima kasih.`
      };
    }

    return {
      success: true,
      student: selectedStudent,
      type,
      startDate,
      endDate,
      reason: cleanReason
    };
  }

  /**
   * Catat pengajuan izin ke database dan kirim notifikasi ke Wali Kelas / Admin
   */
  submitLeaveRequest({ student, type, startDate, endDate, reason, parentPhone, parentName }) {
    const schoolNameSetting = db.prepare("SELECT value FROM settings WHERE key = 'school_name'").get();
    const schoolName = schoolNameSetting?.value || 'Sekolah';

    const cleanPhone = (parentPhone || '').replace(/\D/g, '');
    const parentPhoneLast4 = cleanPhone.slice(-4) || '0000';

    // 1. Cek apakah sudah ada pengajuan izin yang berstatus PENDING atau APPROVED untuk tanggal yang sama
    const existing = db.prepare(`
      SELECT * FROM leave_requests
      WHERE student_id = ? 
        AND status IN ('PENDING', 'APPROVED')
        AND (
          (start_date <= ? AND end_date >= ?)
          OR (start_date <= ? AND end_date >= ?)
        )
      LIMIT 1
    `).get(student.id, startDate, startDate, endDate, endDate);

    if (existing) {
      const statusIndo = existing.status === 'APPROVED' ? 'telah disetujui' : 'sedang menunggu persetujuan Wali Kelas';
      return {
        error: 'DUPLICATE_REQUEST',
        message: `⚠️ Permohonan izin untuk ananda *${student.name}* pada tanggal tersebut sudah pernah diajukan sebelumnya dan saat ini statusnya *${statusIndo}* (ID: #${existing.id}).`
      };
    }

    // 2. Simpan ke tabel leave_requests
    const insertStmt = db.prepare(`
      INSERT INTO leave_requests (
        student_id, type, start_date, end_date, reason, parent_phone_last4, status
      ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING')
    `);

    const result = insertStmt.run(student.id, type, startDate, endDate, reason, parentPhoneLast4);
    const leaveId = result.lastInsertRowid;

    // 3. Cari Wali Kelas dari siswa ini
    const teacher = db.prepare(`
      SELECT u.*, c.name as class_name
      FROM users u
      JOIN classes c ON u.class_id = c.id
      WHERE u.role = 'guru' 
        AND u.class_id = ? 
        AND u.phone IS NOT NULL 
        AND TRIM(u.phone) != ''
      LIMIT 1
    `).get(student.class_id);

    // Ambil Admin sekolah sebagai fallback
    const admin = db.prepare(`
      SELECT * FROM users
      WHERE role = 'admin' 
        AND phone IS NOT NULL 
        AND TRIM(phone) != ''
      LIMIT 1
    `).get();

    const dateDisplay = (startDate === endDate)
      ? formatDateIndonesia(startDate)
      : `${formatDateIndonesia(startDate)} s/d ${formatDateIndonesia(endDate)}`;

    const typeDesc = (type === 'SAKIT') ? 'SAKIT' : 'IZIN';

    // 4. Kirim notifikasi permohonan ke WhatsApp Guru (atau Admin jika belum ada guru)
    let recipientPhone = null;
    let recipientRole = 'GURU';
    let recipientName = 'Wali Kelas';

    if (teacher && teacher.phone && teacher.phone.trim() !== '') {
      recipientPhone = teacher.phone.trim();
      recipientRole = 'GURU';
      recipientName = teacher.name;
    } else if (admin && admin.phone && admin.phone.trim() !== '') {
      recipientPhone = admin.phone.trim();
      recipientRole = 'ADMIN';
      recipientName = admin.name;
    }

    if (recipientPhone) {
      let forwardMsg = `📋 *PENGAJUAN ${typeDesc} SISWA (MENUNGGU PERSETUJUAN)*\n`;
      forwardMsg += `🏫 *${schoolName}*\n`;
      forwardMsg += `━━━━━━━━━━━━━━━━━━━━━\n`;
      forwardMsg += `Terdapat permohonan baru yang diajukan oleh Orang Tua siswa:\n\n`;
      forwardMsg += `👤 *Nama Siswa:* ${student.name}\n`;
      forwardMsg += `🏷️ *Kelas:* ${student.class_name || '-'}\n`;
      forwardMsg += `📌 *Jenis:* *${typeDesc}*\n`;
      forwardMsg += `📅 *Tanggal:* ${dateDisplay}\n`;
      forwardMsg += `📝 *Alasan:* "${reason}"\n`;
      forwardMsg += `👨‍👩‍👦 *Wali Murid:* ${student.parent_name || 'Orang Tua'} (${parentPhone})\n`;
      forwardMsg += `🆔 *ID Permohonan:* *#${leaveId}*\n`;
      forwardMsg += `━━━━━━━━━━━━━━━━━━━━━\n`;
      forwardMsg += `Silakan balas pesan ini untuk memproses:\n\n`;
      forwardMsg += `👉 *SETUJU ${leaveId}* — untuk menyetujui\n`;
      forwardMsg += `👉 *TOLAK ${leaveId} [alasan]* — untuk menolak\n\n`;
      forwardMsg += `_Contoh balas: *SETUJU ${leaveId}*_`;

      queue.enqueue({
        studentId: student.id,
        phone: recipientPhone,
        message: forwardMsg,
        type: 'LEAVE_REQUEST_FORWARD'
      });
    }

    // 5. Susun pesan konfirmasi untuk dikembalikan langsung ke Orang Tua
    let parentConfirmMsg = `Assalamu’alaikum Wr. Wb.\n\n`;
    parentConfirmMsg += `Terima kasih, permohonan *${typeDesc}* ananda *${student.name}* telah kami terima di sistem absensi *${schoolName}*:\n\n`;
    parentConfirmMsg += `📅 *Tanggal:* ${dateDisplay}\n`;
    parentConfirmMsg += `📝 *Alasan:* "${reason}"\n`;
    parentConfirmMsg += `⏳ *Status:* *MENUNGGU PERSETUJUAN WALI KELAS*\n`;
    parentConfirmMsg += `🆔 *ID Permohonan:* *#${leaveId}*\n\n`;

    if (recipientRole === 'GURU') {
      parentConfirmMsg += `Laporan ini telah otomatis kami teruskan ke nomor WhatsApp Wali Kelas (*${recipientName}*). Begitu diverifikasi, Anda akan langsung menerima notifikasi persetujuan di WhatsApp ini.\n\n`;
    } else {
      parentConfirmMsg += `Laporan ini telah otomatis kami teruskan ke pihak sekolah / Administrator untuk diverifikasi.\n\n`;
    }

    parentConfirmMsg += `_Semoga ananda lekas sembuh / urusan keluarga berjalan lancar._ 🙏`;

    return {
      success: true,
      leaveId,
      student,
      recipientRole,
      recipientName,
      message: parentConfirmMsg
    };
  }

  /**
   * Proses keputusan Guru atau Admin (SETUJU atau TOLAK)
   * @param {object} reviewerUser Objek user guru atau admin
   * @param {string} action 'APPROVE' atau 'REJECT'
   * @param {number|string} leaveId ID permohonan
   * @param {string} rejectionNotes Alasan penolakan (jika ditolak)
   */
  processTeacherDecision(reviewerUser, action, leaveId, rejectionNotes = '') {
    const schoolNameSetting = db.prepare("SELECT value FROM settings WHERE key = 'school_name'").get();
    const schoolName = schoolNameSetting?.value || 'Sekolah';

    const parsedId = parseInt(leaveId, 10);
    if (isNaN(parsedId)) {
      return `Format perintah tidak valid. Gunakan format:\n👉 *SETUJU <ID>* (Contoh: *SETUJU 12*)\n👉 *TOLAK <ID> <alasan>*`;
    }

    // Cari permohonan izin
    const leave = db.prepare(`
      SELECT lr.*, 
             s.name as student_name, s.class_id, s.parent_phone, s.parent_name,
             c.name as class_name
      FROM leave_requests lr
      JOIN students s ON lr.student_id = s.id
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE lr.id = ?
    `).get(parsedId);

    if (!leave) {
      return `Permohonan izin dengan ID *#${parsedId}* tidak ditemukan. Pastikan nomor ID sudah sesuai.`;
    }

    // Validasi Hak Akses:
    // Jika reviewer adalah Guru, pastikan siswa berada di kelas binaan guru tersebut
    if (reviewerUser.role === 'guru') {
      if (!reviewerUser.class_id || leave.class_id !== reviewerUser.class_id) {
        return `⚠️ *Akses Terbatas:*\nAnda hanya memiliki wewenang untuk menyetujui permohonan siswa di kelas binaan Anda (*${reviewerUser.class_name || '-'}*).`;
      }
    }

    // Cek apakah status sudah bukan PENDING
    if (leave.status !== 'PENDING') {
      const statusText = (leave.status === 'APPROVED') ? 'DISETUJUI' : 'DITOLAK';
      const reviewerInfo = leave.reviewed_at ? ` pada ${leave.reviewed_at}` : '';
      return `ℹ️ Permohonan ID *#${parsedId}* untuk siswa *${leave.student_name}* sudah pernah diproses sebelumnya (Status: *${statusText}*${reviewerInfo}).`;
    }

    const typeDesc = (leave.type === 'SAKIT') ? 'Sakit' : 'Izin';
    const dateDisplay = (leave.start_date === leave.end_date)
      ? formatDateIndonesia(leave.start_date)
      : `${formatDateIndonesia(leave.start_date)} s/d ${formatDateIndonesia(leave.end_date)}`;

    // ==============================
    // A. KASUS: SETUJU (APPROVE)
    // ==============================
    if (action === 'APPROVE') {
      // 1. Update status leave_requests
      const updateStmt = db.prepare(`
        UPDATE leave_requests
        SET status = 'APPROVED', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, rejection_note = NULL
        WHERE id = ?
      `);
      updateStmt.run(reviewerUser.id, parsedId);

      // 2. Sinkronkan ke tabel attendances
      const reviewerTitle = (reviewerUser.role === 'admin') ? 'Administrator' : 'Wali Kelas';
      const reviewerName = reviewerUser.name || reviewerTitle;
      const note = `Izin Mandiri (${typeDesc}) disetujui ${reviewerTitle} (${reviewerName}): ${leave.reason}`;

      const upsertAttendance = db.prepare(`
        INSERT INTO attendances (student_id, date, time_in, status, notes, created_by)
        VALUES (?, ?, '07:00:00', ?, ?, ?)
        ON CONFLICT(student_id, date) DO UPDATE SET
          status = excluded.status,
          notes = excluded.notes,
          time_in = excluded.time_in,
          created_by = excluded.created_by
      `);

      const curDate = new Date(leave.start_date + 'T00:00:00');
      const stopDate = new Date(leave.end_date + 'T00:00:00');

      while (curDate <= stopDate) {
        const dateStr = curDate.toLocaleDateString('en-CA');
        // Jangan timpa jika akhir pekan
        if (!isWeekend(dateStr)) {
          upsertAttendance.run(leave.student_id, dateStr, leave.type, note, `${reviewerUser.role.toUpperCase()} (WA)`);
        }
        curDate.setDate(curDate.getDate() + 1);
      }

      // 3. Kirim notifikasi WA ke Orang Tua
      if (leave.parent_phone && leave.parent_phone.trim() !== '') {
        let parentMsg = `Assalamu’alaikum Wr. Wb.\n`;
        parentMsg += `Yth. Bapak/Ibu Wali Murid dari *${leave.student_name}* (Kelas ${leave.class_name || '-'}),\n\n`;
        parentMsg += `Diberitahukan bahwa permohonan *${typeDesc.toUpperCase()}* ananda pada tanggal:\n`;
        parentMsg += `📅 *${dateDisplay}*\n`;
        parentMsg += `📝 Alasan: _${leave.reason}_\n\n`;
        parentMsg += `Telah resmi *DISETUJUI* oleh ${reviewerTitle} (*${reviewerName}*).\n`;
        parentMsg += `Status absensi ananda di sekolah telah diperbarui menjadi *${leave.type}*.\n\n`;
        parentMsg += `Terima kasih atas kerja samanya.\n`;
        parentMsg += `_Sistem Absensi ${schoolName}_`;

        queue.enqueue({
          studentId: leave.student_id,
          phone: leave.parent_phone.trim(),
          message: parentMsg,
          type: 'LEAVE_APPROVAL'
        });
      }

      // 4. Balas pesan sukses ke Guru / Admin
      let teacherResp = `✅ *PERMOHONAN IZIN BERHASIL DISETUJUI*\n`;
      teacherResp += `━━━━━━━━━━━━━━━━━━━━━\n`;
      teacherResp += `Permohonan ID *#${parsedId}* atas nama siswa *${leave.student_name}* (${leave.class_name || '-'}) telah disetujui.\n\n`;
      teacherResp += `📌 *Status Kehadiran:* Dicatat sebagai *${leave.type}*\n`;
      teacherResp += `📅 *Tanggal:* ${dateDisplay}\n`;
      teacherResp += `💬 *Notifikasi Orang Tua:* Telah dikirimkan otomatis ke WhatsApp wali murid.\n\n`;
      teacherResp += `_Terima kasih atas dedikasi Bapak/Ibu Guru._`;
      return teacherResp;
    }

    // ==============================
    // B. KASUS: TOLAK (REJECT)
    // ==============================
    if (action === 'REJECT') {
      const reasonReject = (rejectionNotes || '').trim() || 'Mohon melampirkan surat keterangan dokter atau menghubungi wali kelas langsung';

      const updateStmt = db.prepare(`
        UPDATE leave_requests
        SET status = 'REJECTED', reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP, rejection_note = ?
        WHERE id = ?
      `);
      updateStmt.run(reviewerUser.id, reasonReject, parsedId);

      const reviewerTitle = (reviewerUser.role === 'admin') ? 'Administrator' : 'Wali Kelas';
      const reviewerName = reviewerUser.name || reviewerTitle;

      // Kirim notifikasi penolakan ke Orang Tua
      if (leave.parent_phone && leave.parent_phone.trim() !== '') {
        let parentMsg = `Assalamu’alaikum Wr. Wb.\n`;
        parentMsg += `Yth. Bapak/Ibu Wali Murid dari *${leave.student_name}* (Kelas ${leave.class_name || '-'}),\n\n`;
        parentMsg += `Mohon maaf, permohonan *${typeDesc.toUpperCase()}* ananda pada tanggal *${dateDisplay}* *BELUM DAPAT DISETUJUI* oleh ${reviewerTitle} (*${reviewerName}*).\n\n`;
        parentMsg += `⚠️ *Alasan:* _${reasonReject}_\n\n`;
        parentMsg += `Silakan hubungi pihak sekolah atau Wali Kelas untuk koordinasi lebih lanjut.\n`;
        parentMsg += `_Sistem Absensi ${schoolName}_`;

        queue.enqueue({
          studentId: leave.student_id,
          phone: leave.parent_phone.trim(),
          message: parentMsg,
          type: 'LEAVE_REJECTION'
        });
      }

      let teacherResp = `❌ *PERMOHONAN IZIN DITOLAK*\n`;
      teacherResp += `━━━━━━━━━━━━━━━━━━━━━\n`;
      teacherResp += `Permohonan ID *#${parsedId}* (${leave.student_name}) telah ditolak.\n`;
      teacherResp += `⚠️ *Catatan Penolakan:* "${reasonReject}"\n`;
      teacherResp += `💬 Pemberitahuan penolakan telah dikirimkan ke nomor WhatsApp orang tua siswa.`;
      return teacherResp;
    }

    return `Aksi tidak dikenal.`;
  }

  /**
   * Tampilkan daftar permohonan yang masih berstatus PENDING
   */
  getPendingLeavesMessage(reviewerUser) {
    const schoolNameSetting = db.prepare("SELECT value FROM settings WHERE key = 'school_name'").get();
    const schoolName = schoolNameSetting?.value || 'Sekolah';

    let query = `
      SELECT lr.*, s.name as student_name, c.name as class_name, s.parent_phone
      FROM leave_requests lr
      JOIN students s ON lr.student_id = s.id
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE lr.status = 'PENDING'
    `;
    const params = [];

    if (reviewerUser.role === 'guru') {
      if (!reviewerUser.class_id) {
        return `Halo ${reviewerUser.name}, akun Guru Anda belum ditugaskan sebagai Wali Kelas dari rombel tertentu.`;
      }
      query += ` AND s.class_id = ? `;
      params.push(reviewerUser.class_id);
    }

    query += ` ORDER BY lr.created_at ASC `;
    const pendingList = db.prepare(query).all(...params);

    if (pendingList.length === 0) {
      return `🎉 *Tidak ada permohonan izin/sakit yang menunggu verifikasi saat ini.* Semua permohonan telah diproses.`;
    }

    let msg = `📋 *DAFTAR PERMOHONAN IZIN MENUNGGU PERSETUJUAN*\n`;
    msg += `🏫 *${schoolName}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `Total: *${pendingList.length} permohonan* menunggu respon Anda:\n\n`;

    pendingList.forEach((item, idx) => {
      const typeDesc = (item.type === 'SAKIT') ? 'Sakit' : 'Izin';
      const dateDisplay = (item.start_date === item.end_date)
        ? formatDateIndonesia(item.start_date)
        : `${formatDateIndonesia(item.start_date)} s/d ${formatDateIndonesia(item.end_date)}`;

      msg += `${idx + 1}. *#${item.id}* - *${item.student_name}* (${item.class_name || '-'})\n`;
      msg += `   • Jenis: *${typeDesc}*\n`;
      msg += `   • Tanggal: ${dateDisplay}\n`;
      msg += `   • Alasan: "${item.reason}"\n\n`;
    });

    msg += `━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `Untuk memproses, balas dengan:\n`;
    msg += `👉 *SETUJU <ID>* (misal: *SETUJU ${pendingList[0].id}*)\n`;
    msg += `👉 *TOLAK <ID> <alasan>* (misal: *TOLAK ${pendingList[0].id} tidak ada surat*)`;

    return msg;
  }
}

module.exports = new LeaveService();
