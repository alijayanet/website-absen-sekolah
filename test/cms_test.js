const db = require('../src/database/db');
const assert = require('assert');

function testCMS() {
  console.log('--- Pengujian CMS & Galeri Sekolah ---');

  // 1. Cek settings baru
  const accreditation = db.prepare("SELECT value FROM settings WHERE key = 'school_accreditation'").get();
  assert(accreditation && accreditation.value.includes('Terakreditasi'), 'Akreditasi harus tersimpan');

  const principal = db.prepare("SELECT value FROM settings WHERE key = 'school_principal_name'").get();
  assert(principal && principal.value.includes('Mulyadi'), 'Nama kepala sekolah harus tersimpan');

  // 2. Cek galeri foto
  const gallery = db.prepare("SELECT * FROM school_gallery").all();
  assert(gallery.length > 0, 'Galeri awal harus terisi');
  console.log(`Jumlah foto di galeri: ${gallery.length}`);

  console.log('✓ Semua data CMS & Galeri Foto Sekolah tersimpan dengan baik.');
}

testCMS();
