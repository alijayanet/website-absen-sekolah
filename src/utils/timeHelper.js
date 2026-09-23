/**
 * timeHelper.js — Helper timezone terpusat untuk aplikasi Absensi Sekolah
 * Default timezone: Asia/Jakarta (WIB = UTC+7)
 * 
 * Semua fungsi di sini menggunakan Intl API sehingga TIDAK bergantung
 * pada timezone sistem server (yang mungkin UTC di VPS/cloud).
 * 
 * Cara penggunaan:
 *   const { getNowWIB, getTodayWIB, getTimeStringWIB } = require('../utils/timeHelper');
 */

const db = require('../database/db');

/**
 * Ambil timezone yang dikonfigurasi admin dari tabel settings.
 * Default: 'Asia/Jakarta' (WIB, UTC+7)
 * @returns {string}
 */
function getConfiguredTimezone() {
  try {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'scheduler_timezone'").get();
    return (row && row.value && row.value.trim()) ? row.value.trim() : 'Asia/Jakarta';
  } catch {
    return 'Asia/Jakarta';
  }
}

/**
 * Kembalikan objek Date yang sudah dikoreksi offsetnya ke timezone yang dikonfigurasi.
 * Catatan: Date JS selalu UTC di-bawah-hood, tapi kita bisa mengekstrak
 * komponen waktu lokal menggunakan Intl.DateTimeFormat.
 * @param {string} [tz] Override timezone (opsional)
 * @returns {Date} Date dengan getHours/getMinutes/dll menunjukkan waktu lokal
 */
function getNowWIB(tz) {
  const timezone = tz || getConfiguredTimezone();
  const now = new Date();

  // Buat formatter untuk timezone yang ditentukan
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(now);

  const get = (type) => parts.find(p => p.type === type)?.value || '00';
  const year = get('year');
  const month = get('month');
  const day = get('day');
  let hour = get('hour');
  const minute = get('minute');
  const second = get('second');

  // Handle jam 24:xx yang dikembalikan oleh beberapa sistem
  if (hour === '24') hour = '00';

  // Buat Date dari string waktu lokal (diperlakukan sebagai UTC untuk konsistensi getHours())
  // Kita pakai Date UTC sebagai "dummy" agar getHours/getMinutes bisa dibaca langsung
  const localDate = new Date(`${year}-${month}-${day}T${hour}:${minute}:${second}Z`);
  // Simpan metadata timezone di objek untuk referensi
  localDate._timezone = timezone;
  localDate._localYear = parseInt(year);
  localDate._localMonth = parseInt(month) - 1; // 0-indexed
  localDate._localDay = parseInt(day);
  localDate._localHour = parseInt(hour);
  localDate._localMinute = parseInt(minute);
  localDate._localSecond = parseInt(second);

  return localDate;
}

/**
 * Dapatkan tanggal hari ini dalam timezone yang dikonfigurasi, format YYYY-MM-DD.
 * @param {string} [tz] Override timezone (opsional)
 * @returns {string} e.g. "2026-09-22"
 */
function getTodayWIB(tz) {
  const timezone = tz || getConfiguredTimezone();
  const now = new Date();
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(now);
}

/**
 * Dapatkan waktu saat ini dalam format HH:MM, dalam timezone yang dikonfigurasi.
 * @param {string} [tz] Override timezone (opsional)
 * @returns {string} e.g. "09:30"
 */
function getTimeStringWIB(tz) {
  const timezone = tz || getConfiguredTimezone();
  const now = new Date();
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(now);
}

/**
 * Dapatkan waktu saat ini dalam format HH:MM:SS, dalam timezone yang dikonfigurasi.
 * @param {string} [tz] Override timezone (opsional)
 * @returns {string} e.g. "09:30:05"
 */
function getTimeSecondWIB(tz) {
  const timezone = tz || getConfiguredTimezone();
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(now);
  const get = (type) => parts.find(p => p.type === type)?.value || '00';
  let hour = get('hour');
  if (hour === '24') hour = '00';
  return `${hour}:${get('minute')}:${get('second')}`;
}

/**
 * Dapatkan komponen jam (0-23) dalam timezone yang dikonfigurasi.
 * @param {string} [tz]
 * @returns {number}
 */
function getHourWIB(tz) {
  const timezone = tz || getConfiguredTimezone();
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hour: '2-digit',
    hour12: false
  }).formatToParts(now);
  let h = parseInt(parts.find(p => p.type === 'hour')?.value || '0');
  if (h === 24) h = 0;
  return h;
}

/**
 * Format tanggal ke bahasa Indonesia (hari, tanggal bulan tahun).
 * @param {string} dateStr YYYY-MM-DD
 * @param {string} [tz]
 * @returns {string} e.g. "Senin, 22 September 2026"
 */
function formatDateIndonesia(dateStr, tz) {
  const timezone = tz || getConfiguredTimezone();
  // Tambah T12:00:00 agar tidak bergeser karena UTC
  const d = new Date(dateStr + 'T12:00:00Z');
  return d.toLocaleDateString('id-ID', {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

/**
 * Cek apakah sebuah tanggal (YYYY-MM-DD) merupakan akhir pekan (Sabtu atau Minggu)
 * @param {string} dateStr YYYY-MM-DD
 * @param {string} [tz]
 * @returns {boolean}
 */
function isWeekend(dateStr, tz) {
  const timezone = tz || getConfiguredTimezone();
  const d = new Date(dateStr + 'T12:00:00Z');
  const dayName = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(d);
  return dayName === 'Sat' || dayName === 'Sun';
}

/**
 * Dapatkan tanggal YYYY-MM-DD relatif terhadap hari ini dalam zona waktu WIB
 * @param {number} offsetDays misal -1 untuk kemarin, 1 untuk besok
 * @param {string} [tz]
 * @returns {string} YYYY-MM-DD
 */
function getRelativeDateWIB(offsetDays = 0, tz) {
  const timezone = tz || getConfiguredTimezone();
  const now = new Date();
  // Tambahkan offset millisecond
  const target = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(target);
}

module.exports = {
  getConfiguredTimezone,
  getNowWIB,
  getTodayWIB,
  getTimeStringWIB,
  getTimeSecondWIB,
  getHourWIB,
  formatDateIndonesia,
  isWeekend,
  getRelativeDateWIB
};
