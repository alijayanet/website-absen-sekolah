/**
 * Absensi Sekolah - Payment Notification Webhook Router
 * src/routes/api/paymentNotif.js
 * 
 * Pengganti MacroDroid / Server Gateway Penangkap Notifikasi Bank & E-Wallet
 * Otomatis memverifikasi pembayaran SPP / tagihan siswa ketika ada notifikasi uang masuk di HP sekolah.
 */

'use strict';

const express = require('express');
const router = express.Router();
const db = require('../../database/db');
const financeService = require('../../services/financeService');

/**
 * Helper untuk mengekstrak nominal rupiah dari teks notifikasi SMS/Push Notification Bank
 */
function parseAmountFromText(text) {
  if (!text) return 0;
  const s = String(text).replace(/,/g, ''); // bersihkan koma jika ada

  // Pola 1: Rp 150.125 atau Rp. 150.125 atau Rp150.125 atau Rp7.643
  const rpMatch = /rp\.?\s*([0-9\.]+)/i.exec(s);
  if (rpMatch) {
    const clean = rpMatch[1].replace(/\./g, '');
    const num = parseInt(clean, 10);
    if (!isNaN(num) && num >= 100) return num;
  }

  // Pola 2: "sebesar 150.125" atau "nominal 150.125" atau "jumlah 150.125"
  const wordMatch = /(?:sebesar|nominal|jumlah|total|dana)\s*(?:rp\.?)?\s*([0-9\.]+)/i.exec(s);
  if (wordMatch) {
    const clean = wordMatch[1].replace(/\./g, '');
    const num = parseInt(clean, 10);
    if (!isNaN(num) && num >= 100) return num;
  }

  // Pola 3: Angka ribuan dengan titik (contoh 150.125 atau 100.025 atau 50.000)
  const dotMatch = /\b([0-9]{1,3}(?:\.[0-9]{3})+)\b/.exec(s);
  if (dotMatch) {
    const clean = dotMatch[1].replace(/\./g, '');
    const num = parseInt(clean, 10);
    if (!isNaN(num) && num >= 100) return num;
  }

  // Pola 4: Angka digit setelah kata terima / masuk / bayar
  const rawNumMatch = /(?:diterima|masuk|berhasil|bayar|transfer)\D+([0-9]{3,9})/i.exec(s);
  if (rawNumMatch) {
    const num = parseInt(rawNumMatch[1], 10);
    if (!isNaN(num) && num >= 100) return num;
  }

  return 0;
}

/**
 * POST /api/webhook/payment-notif (dan /api/webhook/v1/payment-notif)
 */
router.post(['/v1/payment-notif', '/payment-notif'], async (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress;
  const body = req.body || {};

  const service = String(body.service || body.app || body.packageName || 'Auto-Gateway').trim();
  const title = String(body.title || '').trim();
  const content = String(body.content || body.text || '').trim();
  const fullText = `${title} ${content}`.trim();
  const secretKey = String(body.secret_key || req.headers['x-webhook-token'] || req.query.secret_key || '').trim();

  console.log(`[Payment Webhook] Notifikasi diterima dari [${service}]: "${fullText.slice(0, 150)}"`);

  // Validasi Secret Key jika dikonfigurasi
  const expectedSecret = String(financeService.getSetting('payment_gateway_secret', '')).trim();
  if (expectedSecret && secretKey && secretKey !== expectedSecret) {
    console.warn(`[Payment Webhook] Secret key tidak valid dari ${ip}`);
    return res.status(403).json({ success: false, error: 'Invalid secret_key' });
  }

  if (!fullText) {
    return res.status(400).json({ success: false, error: 'Isi notifikasi kosong' });
  }

  // Ekstrak nominal uang dari notifikasi
  const parsedAmount = parseAmountFromText(fullText);

  // Catat ke webhook_logs
  try {
    db.prepare(`
      INSERT INTO webhook_logs (provider, ref_id, status, payload, ip)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      service,
      parsedAmount ? String(parsedAmount) : 'NO_AMOUNT',
      parsedAmount ? 'amount_parsed' : 'unparsed',
      JSON.stringify(body),
      ip
    );
  } catch (_) {}

  if (!parsedAmount || parsedAmount < 100) {
    console.log(`[Payment Webhook] Tidak ditemukan nominal valid pada teks: "${fullText.slice(0, 100)}"`);
    return res.json({
      success: true,
      matched: false,
      parsed_amount: 0,
      message: 'Notifikasi dicatat (tidak ditemukan nominal pembayaran yang cocok).'
    });
  }

  console.log(`[Payment Webhook] Nominal terdeteksi: Rp ${parsedAmount.toLocaleString('id-ID')}. Mencari tagihan pending...`);

  // Cari tagihan siswa dengan total_amount yang cocok persis dan berstatus UNPAID
  try {
    const bill = db.prepare(`
      SELECT b.*, s.name as student_name, s.nis, s.parent_phone, c.name as class_name
      FROM student_bills b
      JOIN students s ON b.student_id = s.id
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE b.total_amount = ? AND b.status = 'UNPAID'
      ORDER BY b.created_at DESC
      LIMIT 1
    `).get(parsedAmount);

    if (bill) {
      console.log(`[Payment Webhook] MATCH BILL! Menyetujui tagihan #${bill.id} (${bill.bill_code} - ${bill.title}) untuk siswa ${bill.student_name}`);
      
      const payResult = financeService.payBill(bill.id, {
        paymentMethod: 'QRIS',
        paymentChannel: service,
        referenceNote: `Verifikasi Otomatis via Webhook Notifikasi (${service})`,
        receivedBy: 'SYSTEM-GATEWAY'
      });

      return res.json({
        success: true,
        matched: true,
        type: 'student_bill',
        bill_id: bill.id,
        bill_code: bill.bill_code,
        title: bill.title,
        amount: parsedAmount,
        student_id: bill.student_id,
        student_name: bill.student_name,
        class_name: bill.class_name || '-',
        receipt_no: payResult.receipt_no,
        message: `Tagihan ${bill.bill_code} (${bill.title}) sebesar Rp ${parsedAmount.toLocaleString('id-ID')} atas nama ${bill.student_name} berhasil diverifikasi otomatis!`
      });
    }

    console.log(`[Payment Webhook] Tidak ditemukan tagihan UNPAID dengan total nominal Rp ${parsedAmount.toLocaleString('id-ID')}`);
    return res.json({
      success: true,
      matched: false,
      parsed_amount: parsedAmount,
      message: `Nominal Rp ${parsedAmount.toLocaleString('id-ID')} terdeteksi, namun tidak ada tagihan pending yang cocok.`
    });

  } catch (err) {
    console.error(`[Payment Webhook] Error memproses pembayaran: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/webhook/payment-notif/logs (Lihat log webhook notifikasi)
 */
router.get(['/v1/payment-notif/logs', '/payment-notif/logs'], (req, res) => {
  try {
    const logs = db.prepare(`
      SELECT * FROM webhook_logs 
      ORDER BY created_at DESC 
      LIMIT 50
    `).all();

    return res.json({ success: true, data: logs });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
