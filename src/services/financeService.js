/**
 * Absensi Sekolah - Finance & Billing Service
 * src/services/financeService.js
 * 
 * Mengelola pembuatan tagihan (SPP & non-SPP), kode bayar unik,
 * kuitansi pembayaran, dan integrasi QRIS Dinamis.
 */

'use strict';

const db = require('../database/db');
const qrisUtil = require('../utils/qrisUtil');

class FinanceService {
  /**
   * Dapatkan pengaturan setting sistem
   */
  getSetting(key, defaultValue = '') {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : defaultValue;
  }

  /**
   * Format rupiah untuk tampilan teks
   */
  formatRupiah(number) {
    return 'Rp ' + Number(number || 0).toLocaleString('id-ID');
  }

  /**
   * Generate Kode Tagihan / Invoice Unik
   */
  generateBillCode(period) {
    const datePrefix = (period || new Date().toISOString().slice(0, 7)).replace('-', '');
    const countRow = db.prepare(`
      SELECT COUNT(*) as count FROM student_bills WHERE bill_code LIKE ?
    `).get(`INV-${datePrefix}-%`);
    const nextSeq = (countRow?.count || 0) + 1;
    return `INV-${datePrefix}-${String(nextSeq).padStart(4, '0')}`;
  }

  /**
   * Generate Nomor Kuitansi Pembayaran Unik
   */
  generateReceiptNo() {
    const todayStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const countRow = db.prepare(`
      SELECT COUNT(*) as count FROM payment_receipts WHERE receipt_no LIKE ?
    `).get(`RCP-${todayStr}-%`);
    const nextSeq = (countRow?.count || 0) + 1;
    return `RCP-${todayStr}-${String(nextSeq).padStart(4, '0')}`;
  }

  /**
   * Cari kode unik 3 digit (100 - 998) agar total_amount tidak bentrok
   * dengan tagihan UNPAID lainnya di sistem
   */
  generateUniqueAmount(baseAmount) {
    const base = Math.max(0, parseInt(baseAmount, 10) || 0);
    let attempts = 0;
    while (attempts < 50) {
      const code = Math.floor(Math.random() * 899) + 100; // 100 - 998
      const total = base + code;
      const existing = db.prepare(`
        SELECT id FROM student_bills 
        WHERE total_amount = ? AND status = 'UNPAID'
      `).get(total);

      if (!existing) {
        return { uniqueCode: code, totalAmount: total };
      }
      attempts++;
    }
    // Fallback jika padat
    const fallbackCode = Math.floor(Math.random() * 899) + 100;
    return { uniqueCode: fallbackCode, totalAmount: base + fallbackCode };
  }

  /**
   * Buat Satu Tagihan Siswa (Custom / Satuan)
   */
  createBill({ studentId, categoryId, title, period, baseAmount, dueDate, notes }) {
    const student = db.prepare('SELECT id, name FROM students WHERE id = ?').get(studentId);
    if (!student) throw new Error('Siswa tidak ditemukan');

    const category = db.prepare('SELECT * FROM fee_categories WHERE id = ?').get(categoryId);
    if (!category) throw new Error('Kategori tagihan tidak valid');

    const base = parseInt(baseAmount, 10) || category.default_amount || 0;
    if (base <= 0) throw new Error('Nominal tagihan harus lebih dari 0');

    const billCode = this.generateBillCode(period);
    const { uniqueCode, totalAmount } = this.generateUniqueAmount(base);

    const billTitle = title || (period ? `${category.name} (${period})` : category.name);

    const stmt = db.prepare(`
      INSERT INTO student_bills (
        bill_code, student_id, category_id, title, period,
        base_amount, unique_code, total_amount, status, due_date, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UNPAID', ?, ?)
    `);

    const res = stmt.run(
      billCode,
      studentId,
      categoryId,
      billTitle,
      period || null,
      base,
      uniqueCode,
      totalAmount,
      dueDate || null,
      notes || null
    );

    return db.prepare('SELECT * FROM student_bills WHERE id = ?').get(res.lastInsertRowid);
  }

  /**
   * Generate Tagihan Massal Bulanan & Mingguan untuk Seluruh Siswa atau Per Kelas
   */
  generateMonthlyBills({ period, classId = null, categoryId, baseAmount, dueDate, notes, title }) {
    if (!period) throw new Error('Periode tagihan harus ditentukan (format: YYYY-MM atau YYYY-MM-W#)');

    const category = db.prepare('SELECT * FROM fee_categories WHERE id = ?').get(categoryId);
    if (!category) throw new Error('Kategori tagihan tidak ditemukan');

    const base = parseInt(baseAmount, 10) || category.default_amount;
    if (base <= 0) throw new Error('Nominal tagihan harus lebih dari 0');

    // Ambil daftar siswa aktif
    let studentsQuery = 'SELECT id, name, class_id FROM students WHERE is_active = 1';
    const params = [];
    if (classId && classId !== 'all') {
      studentsQuery += ' AND class_id = ?';
      params.push(classId);
    }
    const students = db.prepare(studentsQuery).all(...params);

    let createdCount = 0;
    let skippedCount = 0;

    const checkStmt = db.prepare(`
      SELECT id FROM student_bills 
      WHERE student_id = ? AND category_id = ? AND period = ? AND status != 'CANCELLED'
    `);

    const insertStmt = db.prepare(`
      INSERT INTO student_bills (
        bill_code, student_id, category_id, title, period,
        base_amount, unique_code, total_amount, status, due_date, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UNPAID', ?, ?)
    `);

    const monthNames = [
      'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
      'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
    ];

    let readablePeriod = period;
    const weekMatch = period.match(/^(\d{4})-(\d{2})-W(\d+)$/);
    const isoWeekMatch = period.match(/^(\d{4})-W(\d+)$/);
    const monthMatch = period.match(/^(\d{4})-(\d{2})$/);

    if (weekMatch) {
      const mIdx = parseInt(weekMatch[2], 10) - 1;
      readablePeriod = `Minggu ke-${weekMatch[3]} ${monthNames[mIdx] || weekMatch[2]} ${weekMatch[1]}`;
    } else if (isoWeekMatch) {
      readablePeriod = `Minggu ke-${isoWeekMatch[2]} ${isoWeekMatch[1]}`;
    } else if (monthMatch) {
      const mIdx = parseInt(monthMatch[2], 10) - 1;
      readablePeriod = `${monthNames[mIdx] || monthMatch[2]} ${monthMatch[1]}`;
    }

    const defaultTitle = title || `${category.name} - ${readablePeriod}`;
    const datePrefix = (period.replace(/[^0-9]/g, '') || new Date().toISOString().slice(0, 7).replace('-', '')).slice(0, 8);

    const insertTransaction = db.transaction(() => {
      for (const st of students) {
        // Lewati jika sudah ada tagihan untuk periode dan kategori yang sama
        const exists = checkStmt.get(st.id, category.id, period);
        if (exists) {
          skippedCount++;
          continue;
        }

        const countRow = db.prepare(`
          SELECT COUNT(*) as count FROM student_bills WHERE bill_code LIKE ?
        `).get(`INV-${datePrefix}-%`);
        const nextSeq = (countRow?.count || 0) + 1;
        const billCode = `INV-${datePrefix}-${String(nextSeq).padStart(4, '0')}`;

        const { uniqueCode, totalAmount } = this.generateUniqueAmount(base);

        insertStmt.run(
          billCode,
          st.id,
          category.id,
          defaultTitle,
          period,
          base,
          uniqueCode,
          totalAmount,
          dueDate || null,
          notes || null
        );

        createdCount++;
      }
    });

    insertTransaction();

    return {
      total_students: students.length,
      created_count: createdCount,
      skipped_count: skippedCount,
      period,
      readable_period: readablePeriod,
      category_name: category.name
    };
  }

  // Alias untuk kompatibilitas dan kejelasan
  generatePeriodicBills(options) {
    return this.generateMonthlyBills(options);
  }

  /**
   * Eksekusi Pembayaran Tagihan (Otomatis via Webhook atau Manual Kasir TU)
   */
  payBill(billId, { paymentMethod = 'QRIS', paymentChannel = 'Otomatis Gateway', referenceNote = '', receivedBy = 'SYSTEM' }) {
    const bill = db.prepare(`
      SELECT b.*, s.name as student_name, s.nis, s.parent_name, s.parent_phone, c.name as class_name, cat.name as category_name
      FROM student_bills b
      JOIN students s ON b.student_id = s.id
      JOIN fee_categories cat ON b.category_id = cat.id
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE b.id = ?
    `).get(billId);

    if (!bill) throw new Error('Tagihan tidak ditemukan');
    if (bill.status === 'PAID') return { alreadyPaid: true, bill };

    const receiptNo = this.generateReceiptNo();
    const amountPaid = bill.total_amount;

    const payTx = db.transaction(() => {
      // 1. Update status tagihan
      db.prepare(`
        UPDATE student_bills 
        SET status = 'PAID', paid_at = CURRENT_TIMESTAMP 
        WHERE id = ?
      `).run(bill.id);

      // 2. Buat kuitansi
      db.prepare(`
        INSERT INTO payment_receipts (
          receipt_no, bill_id, amount_paid, payment_method, payment_channel, reference_note, received_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        receiptNo,
        bill.id,
        amountPaid,
        paymentMethod,
        paymentChannel,
        referenceNote || null,
        receivedBy
      );
    });

    payTx();

    const updatedBill = db.prepare('SELECT * FROM student_bills WHERE id = ?').get(bill.id);
    const receipt = db.prepare('SELECT * FROM payment_receipts WHERE receipt_no = ?').get(receiptNo);

    // 3. Kirim notifikasi WhatsApp ke Orang Tua jika memiliki nomor telepon
    const schoolName = this.getSetting('school_name', 'Sekolah');
    if (bill.parent_phone) {
      const waMsg = `🎉 *BUKTI PEMBAYARAN RESMI*\n` +
        `🏫 *${schoolName}*\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `🧾 *No. Kuitansi:* ${receiptNo}\n` +
        `🆔 *No. Tagihan:* ${bill.bill_code}\n` +
        `👤 *Siswa:* ${bill.student_name} (${bill.class_name || '-'})\n` +
        `📋 *Pembayaran:* ${bill.title}\n` +
        `💰 *Jumlah Lunas:* ${this.formatRupiah(amountPaid)}\n` +
        `💳 *Metode:* ${paymentMethod} (${paymentChannel})\n` +
        `⏰ *Waktu:* ${new Date().toLocaleString('id-ID')}\n` +
        `━━━━━━━━━━━━━━━━━━━━━\n` +
        `Alhamdulillah, pembayaran telah berhasil diverifikasi dan tercatat lunas di sistem sekolah. Terima kasih atas kerja sama Bapak/Ibu Wali Murid.\n\n` +
        `_Ketik *SPP* untuk mengecek status tagihan lainnya._`;

      try {
        const queue = require('./queue');
        queue.enqueue({
          studentId: bill.student_id,
          phone: bill.parent_phone,
          message: waMsg,
          type: 'PAYMENT_RECEIPT'
        });
      } catch (err) {
        console.error('[Finance] Gagal memasukkan kuitansi ke antrean WA:', err.message);
      }
    }

    return {
      success: true,
      receipt_no: receiptNo,
      bill: updatedBill,
      receipt
    };
  }

  /**
   * Generate QRIS Dinamis untuk Tagihan Tertentu
   */
  async getDynamicQrisForBill(billId) {
    const bill = db.prepare(`
      SELECT b.*, s.name as student_name, s.nis, c.name as class_name, cat.name as category_name
      FROM student_bills b
      JOIN students s ON b.student_id = s.id
      JOIN fee_categories cat ON b.category_id = cat.id
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE b.id = ?
    `).get(billId);

    if (!bill) throw new Error('Tagihan tidak ditemukan');

    const staticPayload = this.getSetting('qris_static_payload', '').trim();
    if (!staticPayload) {
      throw new Error('Payload QRIS Statis sekolah belum diatur di menu Pengaturan Keuangan');
    }

    const { dynamicPayload, dataUrl } = await qrisUtil.generateDynamicQrisDataUrl(
      staticPayload,
      bill.total_amount
    );

    return {
      bill,
      amount: bill.total_amount,
      base_amount: bill.base_amount,
      unique_code: bill.unique_code,
      dynamicPayload,
      dataUrl
    };
  }

  /**
   * Generate Buffer QRIS Dinamis untuk dikirim via Baileys WhatsApp
   */
  async getDynamicQrisBufferForBill(billId) {
    const bill = db.prepare(`
      SELECT b.*, s.name as student_name, s.nis, s.parent_phone, c.name as class_name, cat.name as category_name
      FROM student_bills b
      JOIN students s ON b.student_id = s.id
      JOIN fee_categories cat ON b.category_id = cat.id
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE b.id = ?
    `).get(billId);

    if (!bill) throw new Error('Tagihan tidak ditemukan');

    const staticPayload = this.getSetting('qris_static_payload', '').trim();
    if (!staticPayload) {
      throw new Error('Payload QRIS Statis sekolah belum diatur');
    }

    const { dynamicPayload, buffer } = await qrisUtil.generateDynamicQrisBuffer(
      staticPayload,
      bill.total_amount,
      { width: 500, margin: 2 }
    );

    return {
      bill,
      amount: bill.total_amount,
      dynamicPayload,
      buffer
    };
  }

  /**
   * Dapatkan Statistik Keuangan Dashboard
   */
  getFinanceStats(monthPrefix = null) {
    const curMonth = monthPrefix || new Date().toISOString().slice(0, 7);

    // Total pendapatan bulan ini
    const totalIncomeRow = db.prepare(`
      SELECT COALESCE(SUM(amount_paid), 0) as total
      FROM payment_receipts
      WHERE created_at LIKE ?
    `).get(`${curMonth}%`);

    // Total tagihan pending (unpaid) keseluruhan
    const pendingBillsRow = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total
      FROM student_bills
      WHERE status = 'UNPAID'
    `).get();

    // Total tagihan lunas bulan ini
    const paidBillsRow = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as total
      FROM student_bills
      WHERE status = 'PAID' AND paid_at LIKE ?
    `).get(`${curMonth}%`);

    // Kategori pendapatan bulan ini
    const categoryBreakdown = db.prepare(`
      SELECT cat.name, COUNT(b.id) as bills_count, COALESCE(SUM(r.amount_paid), 0) as total_amount
      FROM payment_receipts r
      JOIN student_bills b ON r.bill_id = b.id
      JOIN fee_categories cat ON b.category_id = cat.id
      WHERE r.created_at LIKE ?
      GROUP BY cat.id
      ORDER BY total_amount DESC
    `).all(`${curMonth}%`);

    // Pembayaran 10 transaksi terakhir
    const recentPayments = db.prepare(`
      SELECT r.*, b.bill_code, b.title, s.name as student_name, c.name as class_name
      FROM payment_receipts r
      JOIN student_bills b ON r.bill_id = b.id
      JOIN students s ON b.student_id = s.id
      LEFT JOIN classes c ON s.class_id = c.id
      ORDER BY r.created_at DESC
      LIMIT 10
    `).all();

    return {
      curMonth,
      totalIncome: totalIncomeRow?.total || 0,
      pendingCount: pendingBillsRow?.count || 0,
      pendingTotal: pendingBillsRow?.total || 0,
      paidCount: paidBillsRow?.count || 0,
      paidTotal: paidBillsRow?.total || 0,
      categoryBreakdown,
      recentPayments
    };
  }
}

module.exports = new FinanceService();
