/**
 * Absensi Sekolah - Savings Service
 * src/services/savingsService.js
 * 
 * Mengelola logika bisnis Tabungan Siswa:
 * Setoran, Penarikan, Rekapitulasi per Guru/Wali Kelas, dan Riwayat Mutasi.
 */

'use strict';

const db = require('../database/db');

class SavingsService {
  /**
   * Format angka ke Rupiah
   */
  formatRupiah(amount) {
    const num = Number(amount) || 0;
    return 'Rp ' + num.toLocaleString('id-ID');
  }

  /**
   * Parsing nominal dari berbagai bentuk input string (misal: "50000", "50.000", "50k", "Rp 50.000")
   */
  parseAmount(input) {
    if (typeof input === 'number') return Math.round(input);
    if (!input) return 0;

    let str = String(input).trim().toLowerCase();
    
    // Tangani akhiran 'k' atau 'rb' (misal: 50k -> 50000)
    let multiplier = 1;
    if (str.endsWith('k') || str.endsWith('rb')) {
      multiplier = 1000;
      str = str.replace(/(k|rb)$/, '').trim();
    } else if (str.endsWith('jt') || str.endsWith('m')) {
      multiplier = 1000000;
      str = str.replace(/(jt|m)$/, '').trim();
    }

    // Bersihkan karakter non-angka kecuali koma atau titik
    const cleanStr = str.replace(/[^0-9]/g, '');
    const val = parseInt(cleanStr, 10);
    if (isNaN(val) || val <= 0) return 0;
    return val * multiplier;
  }

  /**
   * Catat Transaksi Setoran Tabungan Siswa
   */
  deposit({ studentId, teacherId = null, amount, notes = '', transactionDate = null }) {
    const parsedAmount = this.parseAmount(amount);
    if (parsedAmount <= 0) {
      throw new Error('Nominal setoran harus lebih dari 0.');
    }

    const student = db.prepare(`
      SELECT s.*, c.name as class_name 
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE s.id = ? AND s.is_active = 1
    `).get(studentId);

    if (!student) {
      throw new Error('Siswa tidak ditemukan atau tidak aktif.');
    }

    const txDate = transactionDate || new Date().toISOString().slice(0, 10);
    const cleanNotes = (notes || 'Setoran Tabungan Siswa').trim();

    let record = null;

    const runTransaction = db.transaction(() => {
      const currentBalance = Number(student.savings_balance) || 0;
      const newBalance = currentBalance + parsedAmount;

      // Update saldo di tabel students
      db.prepare(`
        UPDATE students 
        SET savings_balance = ? 
        WHERE id = ?
      `).run(newBalance, student.id);

      // Simpan mutasi transaksi
      const insertStmt = db.prepare(`
        INSERT INTO student_savings (
          student_id, teacher_id, class_id, type, amount,
          balance_after, transaction_date, notes
        ) VALUES (?, ?, ?, 'SETOR', ?, ?, ?, ?)
      `);

      const res = insertStmt.run(
        student.id,
        teacherId || null,
        student.class_id || null,
        parsedAmount,
        newBalance,
        txDate,
        cleanNotes
      );

      record = db.prepare(`
        SELECT sv.*, s.name as student_name, s.nis, s.parent_name, s.parent_phone,
               c.name as class_name, u.name as teacher_name
        FROM student_savings sv
        JOIN students s ON sv.student_id = s.id
        LEFT JOIN classes c ON sv.class_id = c.id
        LEFT JOIN users u ON sv.teacher_id = u.id
        WHERE sv.id = ?
      `).get(res.lastInsertRowid);
    });

    runTransaction();
    return record;
  }

  /**
   * Catat Transaksi Penarikan Tabungan Siswa
   */
  withdraw({ studentId, teacherId = null, amount, notes = '', transactionDate = null }) {
    const parsedAmount = this.parseAmount(amount);
    if (parsedAmount <= 0) {
      throw new Error('Nominal penarikan harus lebih dari 0.');
    }

    const student = db.prepare(`
      SELECT s.*, c.name as class_name 
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE s.id = ? AND s.is_active = 1
    `).get(studentId);

    if (!student) {
      throw new Error('Siswa tidak ditemukan atau tidak aktif.');
    }

    const currentBalance = Number(student.savings_balance) || 0;
    if (currentBalance < parsedAmount) {
      throw new Error(`Saldo tabungan tidak mencukupi. Saldo saat ini: ${this.formatRupiah(currentBalance)}, jumlah yang ingin ditarik: ${this.formatRupiah(parsedAmount)}.`);
    }

    const txDate = transactionDate || new Date().toISOString().slice(0, 10);
    const cleanNotes = (notes || 'Penarikan Tabungan Siswa').trim();

    let record = null;

    const runTransaction = db.transaction(() => {
      const newBalance = currentBalance - parsedAmount;

      // Update saldo di tabel students
      db.prepare(`
        UPDATE students 
        SET savings_balance = ? 
        WHERE id = ?
      `).run(newBalance, student.id);

      // Simpan mutasi transaksi
      const insertStmt = db.prepare(`
        INSERT INTO student_savings (
          student_id, teacher_id, class_id, type, amount,
          balance_after, transaction_date, notes
        ) VALUES (?, ?, ?, 'TARIK', ?, ?, ?, ?)
      `);

      const res = insertStmt.run(
        student.id,
        teacherId || null,
        student.class_id || null,
        parsedAmount,
        newBalance,
        txDate,
        cleanNotes
      );

      record = db.prepare(`
        SELECT sv.*, s.name as student_name, s.nis, s.parent_name, s.parent_phone,
               c.name as class_name, u.name as teacher_name
        FROM student_savings sv
        JOIN students s ON sv.student_id = s.id
        LEFT JOIN classes c ON sv.class_id = c.id
        LEFT JOIN users u ON sv.teacher_id = u.id
        WHERE sv.id = ?
      `).get(res.lastInsertRowid);
    });

    runTransaction();
    return record;
  }

  /**
   * Ambil data lengkap tabungan satu siswa beserta guru penanggung jawab dan mutasi terakhir
   */
  getStudentSavings(studentId) {
    const student = db.prepare(`
      SELECT s.*, c.name as class_name
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE s.id = ?
    `).get(studentId);

    if (!student) return null;

    // Cari guru / wali kelas penanggung jawab rombel ini
    const teacher = db.prepare(`
      SELECT id, name, phone, username
      FROM users
      WHERE role = 'guru' AND class_id = ?
      LIMIT 1
    `).get(student.class_id);

    // Ambil mutasi transaksi (terbaru)
    const transactions = db.prepare(`
      SELECT sv.*, u.name as teacher_name
      FROM student_savings sv
      LEFT JOIN users u ON sv.teacher_id = u.id
      WHERE sv.student_id = ?
      ORDER BY sv.transaction_date DESC, sv.id DESC
      LIMIT 10
    `).all(studentId);

    return {
      student,
      balance: Number(student.savings_balance) || 0,
      formattedBalance: this.formatRupiah(student.savings_balance),
      teacher: teacher || { name: 'Wali Kelas / Bendahara Sekolah', phone: '-' },
      transactions
    };
  }

  /**
   * Ambil daftar riwayat mutasi siswa
   */
  getStudentHistory(studentId, limit = 50) {
    return db.prepare(`
      SELECT sv.*, u.name as teacher_name
      FROM student_savings sv
      LEFT JOIN users u ON sv.teacher_id = u.id
      WHERE sv.student_id = ?
      ORDER BY sv.transaction_date DESC, sv.id DESC
      LIMIT ?
    `).all(studentId, limit);
  }

  /**
   * Ambil data tabungan siswa dalam satu kelas (untuk Guru & Wali Kelas)
   */
  getClassSavings(classId) {
    const classInfo = db.prepare('SELECT * FROM classes WHERE id = ?').get(classId);
    if (!classInfo) return null;

    // Cari guru pengampu kelas ini
    const teacher = db.prepare(`
      SELECT id, name, phone, username 
      FROM users 
      WHERE role = 'guru' AND class_id = ? 
      LIMIT 1
    `).get(classId);

    const students = db.prepare(`
      SELECT s.id, s.nis, s.name, s.gender, s.parent_name, s.parent_phone, s.photo,
             COALESCE(s.savings_balance, 0) as savings_balance,
             (SELECT COUNT(*) FROM student_savings WHERE student_id = s.id) as tx_count,
             (SELECT MAX(transaction_date) FROM student_savings WHERE student_id = s.id) as last_tx_date
      FROM students s
      WHERE s.class_id = ? AND s.is_active = 1
      ORDER BY s.name ASC
    `).all(classId);

    const totalBalance = students.reduce((sum, s) => sum + (Number(s.savings_balance) || 0), 0);
    const activeSaverCount = students.filter(s => (Number(s.savings_balance) || 0) > 0).length;

    // Total setor & tarik di kelas ini
    const txTotals = db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'SETOR' THEN amount ELSE 0 END), 0) as total_deposit,
        COALESCE(SUM(CASE WHEN type = 'TARIK' THEN amount ELSE 0 END), 0) as total_withdrawal,
        COUNT(*) as total_tx_count
      FROM student_savings
      WHERE class_id = ?
    `).get(classId);

    return {
      classInfo,
      teacher: teacher || { name: 'Belum Ditentukan', phone: '-' },
      students,
      stats: {
        totalStudents: students.length,
        activeSavers: activeSaverCount,
        totalBalance,
        formattedTotalBalance: this.formatRupiah(totalBalance),
        totalDeposit: txTotals.total_deposit,
        totalWithdrawal: txTotals.total_withdrawal,
        totalTxCount: txTotals.total_tx_count
      }
    };
  }

  /**
   * Rekapitulasi Total Saldo Tabungan per Guru / Wali Kelas (untuk Admin)
   */
  getTeacherSavingsSummary() {
    // Ambil daftar semua guru dan kelas yang diampu
    const teachers = db.prepare(`
      SELECT u.id as teacher_id, u.name as teacher_name, u.phone as teacher_phone,
             c.id as class_id, c.name as class_name
      FROM users u
      LEFT JOIN classes c ON u.class_id = c.id
      WHERE u.role = 'guru'
      ORDER BY c.name ASC, u.name ASC
    `).all();

    const summary = teachers.map(t => {
      let studentCount = 0;
      let activeSaverCount = 0;
      let totalBalance = 0;
      let totalDeposit = 0;
      let totalWithdrawal = 0;

      if (t.class_id) {
        const studentStats = db.prepare(`
          SELECT 
            COUNT(*) as total_students,
            COUNT(CASE WHEN COALESCE(savings_balance, 0) > 0 THEN 1 END) as active_savers,
            COALESCE(SUM(savings_balance), 0) as total_balance
          FROM students
          WHERE class_id = ? AND is_active = 1
        `).get(t.class_id);

        const txStats = db.prepare(`
          SELECT 
            COALESCE(SUM(CASE WHEN type = 'SETOR' THEN amount ELSE 0 END), 0) as total_deposit,
            COALESCE(SUM(CASE WHEN type = 'TARIK' THEN amount ELSE 0 END), 0) as total_withdrawal
          FROM student_savings
          WHERE class_id = ?
        `).get(t.class_id);

        studentCount = studentStats.total_students || 0;
        activeSaverCount = studentStats.active_savers || 0;
        totalBalance = studentStats.total_balance || 0;
        totalDeposit = txStats.total_deposit || 0;
        totalWithdrawal = txStats.total_withdrawal || 0;
      }

      return {
        teacherId: t.teacher_id,
        teacherName: t.teacher_name,
        teacherPhone: t.teacher_phone || '-',
        classId: t.class_id,
        className: t.class_name || 'Belum Diatur',
        studentCount,
        activeSaverCount,
        totalBalance,
        formattedTotalBalance: this.formatRupiah(totalBalance),
        totalDeposit,
        totalWithdrawal
      };
    });

    return summary;
  }

  /**
   * Ambil Statistik Global Tabungan Seluruh Sekolah (untuk Admin)
   */
  getSchoolSavingsStats() {
    const globalBalance = db.prepare(`
      SELECT 
        COALESCE(SUM(savings_balance), 0) as total_balance,
        COUNT(CASE WHEN COALESCE(savings_balance, 0) > 0 THEN 1 END) as active_savers,
        COUNT(*) as total_students
      FROM students
      WHERE is_active = 1
    `).get();

    const globalTx = db.prepare(`
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'SETOR' THEN amount ELSE 0 END), 0) as total_deposit,
        COALESCE(SUM(CASE WHEN type = 'TARIK' THEN amount ELSE 0 END), 0) as total_withdrawal,
        COUNT(*) as total_transactions
      FROM student_savings
    `).get();

    return {
      totalBalance: globalBalance.total_balance || 0,
      formattedTotalBalance: this.formatRupiah(globalBalance.total_balance || 0),
      activeSavers: globalBalance.active_savers || 0,
      totalStudents: globalBalance.total_students || 0,
      totalDeposit: globalTx.total_deposit || 0,
      formattedTotalDeposit: this.formatRupiah(globalTx.total_deposit || 0),
      totalWithdrawal: globalTx.total_withdrawal || 0,
      formattedTotalWithdrawal: this.formatRupiah(globalTx.total_withdrawal || 0),
      totalTransactions: globalTx.total_transactions || 0
    };
  }
}

module.exports = new SavingsService();
