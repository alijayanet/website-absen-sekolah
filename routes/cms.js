const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const db = require('../database/db');
const { isAuthenticated, isAdmin } = require('../middlewares/auth');
const config = require('../config');

// Helper untuk filter gambar
const imageFilter = (req, file, cb) => {
  if (/image\/(jpeg|jpg|png|webp|svg\+xml)/.test(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Format file harus berupa gambar (PNG, JPG, SVG, atau WEBP).'));
  }
};

// 1. Upload Logo & Banner
const generalStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'school_logo' || file.fieldname === 'school_principal_stamp') {
      cb(null, config.logosPath);
    } else if (file.fieldname === 'school_hero_image') {
      cb(null, config.bannersPath);
    } else {
      cb(null, config.photosPath);
    }
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${file.fieldname}_${Date.now()}${ext}`;
    cb(null, uniqueName);
  }
});
const uploadGeneral = multer({ storage: generalStorage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: imageFilter });

// 2. Upload Galeri Sekolah
const galleryStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.galleryPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `gallery_${Date.now()}_${Math.round(Math.random() * 1E9)}${ext}`;
    cb(null, uniqueName);
  }
});
const uploadGallery = multer({ storage: galleryStorage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: imageFilter });

// Tampilkan Halaman Pengaturan / CMS Landing Page
router.get('/dashboard/cms', isAuthenticated, isAdmin, (req, res) => {
  const settingsRows = db.prepare('SELECT key, value FROM settings').all();
  const settings = {};
  for (const row of settingsRows) {
    settings[row.key] = row.value;
  }

  // Ambil daftar galeri sekolah
  const gallery = db.prepare('SELECT * FROM school_gallery ORDER BY id DESC').all();

  res.render('dashboard/cms', {
    settings,
    gallery,
    successMsg: req.query.success || null,
    errorMsg: req.query.error || null
  });
});

// 1. Simpan Profil Sekolah & Logo (CMS)
router.post('/dashboard/cms/profile', isAuthenticated, isAdmin, uploadGeneral.fields([
  { name: 'school_logo', maxCount: 1 },
  { name: 'school_hero_image', maxCount: 1 }
]), (req, res) => {
  try {
    const { school_name, school_tagline, school_description, school_address, school_phone, school_email, school_accreditation } = req.body;
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

    if (school_name) upsert.run('school_name', school_name.trim());
    if (school_tagline) upsert.run('school_tagline', school_tagline.trim());
    if (school_description) upsert.run('school_description', school_description.trim());
    if (school_address) upsert.run('school_address', school_address.trim());
    if (school_phone) upsert.run('school_phone', school_phone.trim());
    if (school_email) upsert.run('school_email', school_email.trim());
    if (school_accreditation) upsert.run('school_accreditation', school_accreditation.trim());

    if (req.files && req.files.school_logo) {
      const logoUrl = `/uploads/logos/${req.files.school_logo[0].filename}`;
      upsert.run('school_logo', logoUrl);
    }

    if (req.files && req.files.school_hero_image) {
      const heroUrl = `/uploads/banners/${req.files.school_hero_image[0].filename}`;
      upsert.run('school_hero_image', heroUrl);
    }

    res.redirect('/dashboard/cms?success=Profil sekolah dan gambar hero berhasil diperbarui.');
  } catch (err) {
    console.error('Error save profile CMS:', err);
    res.redirect(`/dashboard/cms?error=${encodeURIComponent(err.message)}`);
  }
});

// 2. Simpan Sambutan, Profil Kepala Sekolah, Tanda Tangan & Cap Stempel
router.post('/dashboard/cms/principal', isAuthenticated, isAdmin, uploadGeneral.fields([
  { name: 'school_principal_photo', maxCount: 1 },
  { name: 'school_principal_signature', maxCount: 1 },
  { name: 'school_principal_stamp', maxCount: 1 }
]), (req, res) => {
  try {
    const {
      school_principal_name,
      school_principal_nip,
      school_principal_welcome,
      card_issue_city,
      card_issue_date,
      remove_signature,
      remove_stamp,
      remove_photo
    } = req.body;
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

    if (typeof school_principal_name !== 'undefined') upsert.run('school_principal_name', school_principal_name.trim());
    if (typeof school_principal_nip !== 'undefined') upsert.run('school_principal_nip', school_principal_nip.trim());
    if (typeof school_principal_welcome !== 'undefined') upsert.run('school_principal_welcome', school_principal_welcome.trim());
    if (typeof card_issue_city !== 'undefined') upsert.run('card_issue_city', card_issue_city.trim());
    if (typeof card_issue_date !== 'undefined') upsert.run('card_issue_date', card_issue_date.trim());

    if (remove_signature === '1') upsert.run('school_principal_signature', '');
    if (remove_stamp === '1') upsert.run('school_principal_stamp', '');
    if (remove_photo === '1') upsert.run('school_principal_photo', '');

    if (req.files) {
      if (req.files['school_principal_photo'] && req.files['school_principal_photo'][0]) {
        upsert.run('school_principal_photo', `/uploads/photos/${req.files['school_principal_photo'][0].filename}`);
      }
      if (req.files['school_principal_signature'] && req.files['school_principal_signature'][0]) {
        upsert.run('school_principal_signature', `/uploads/photos/${req.files['school_principal_signature'][0].filename}`);
      }
      if (req.files['school_principal_stamp'] && req.files['school_principal_stamp'][0]) {
        upsert.run('school_principal_stamp', `/uploads/logos/${req.files['school_principal_stamp'][0].filename}`);
      }
    }

    res.redirect('/dashboard/cms?success=Data Kepala Sekolah, Tanda Tangan & Cap Stempel Legalisasi berhasil diperbarui.');
  } catch (err) {
    res.redirect(`/dashboard/cms?error=${encodeURIComponent(err.message)}`);
  }
});

// 3. Simpan Visi, Misi, & Statistik
router.post('/dashboard/cms/vision-mission', isAuthenticated, isAdmin, (req, res) => {
  try {
    const { school_vision, school_mission, school_stats_teachers, school_stats_graduates } = req.body;
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

    if (school_vision) upsert.run('school_vision', school_vision.trim());
    if (school_mission) upsert.run('school_mission', school_mission.trim());
    upsert.run('school_stats_teachers', (school_stats_teachers || '').trim());
    if (school_stats_graduates) upsert.run('school_stats_graduates', school_stats_graduates.trim());

    res.redirect('/dashboard/cms?success=Visi, Misi, dan Statistik sekolah berhasil disimpan.');
  } catch (err) {
    res.redirect(`/dashboard/cms?error=${encodeURIComponent(err.message)}`);
  }
});

// 4. Tambah Foto Galeri Sekolah (Fasilitas / Kegiatan / Prestasi)
router.post('/dashboard/cms/gallery', isAuthenticated, isAdmin, uploadGallery.single('gallery_photo'), (req, res) => {
  try {
    const { title, category, description } = req.body;
    if (!title) {
      return res.redirect('/dashboard/cms?error=Judul foto galeri wajib diisi.');
    }

    const imageUrl = req.file ? `/uploads/gallery/${req.file.filename}` : '';

    const stmt = db.prepare('INSERT INTO school_gallery (title, category, image_url, description) VALUES (?, ?, ?, ?)');
    stmt.run(title.trim(), category || 'Fasilitas', imageUrl, description ? description.trim() : '');

    res.redirect('/dashboard/cms?success=Foto kegiatan/fasilitas berhasil ditambahkan ke galeri sekolah.');
  } catch (err) {
    res.redirect(`/dashboard/cms?error=${encodeURIComponent(err.message)}`);
  }
});

// 5. Hapus Foto Galeri Sekolah
router.post('/dashboard/cms/gallery/:id/delete', isAuthenticated, isAdmin, (req, res) => {
  try {
    const item = db.prepare('SELECT * FROM school_gallery WHERE id = ?').get(req.params.id);
    if (item && item.image_url) {
      const filePath = path.join(config.uploadPath, item.image_url.replace('/uploads/', ''));
      if (fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (e) {}
      }
    }
    db.prepare('DELETE FROM school_gallery WHERE id = ?').run(req.params.id);
    res.redirect('/dashboard/cms?success=Foto galeri berhasil dihapus.');
  } catch (err) {
    res.redirect(`/dashboard/cms?error=${encodeURIComponent(err.message)}`);
  }
});

// 6. Simpan Pengumuman Landing Page
router.post('/dashboard/cms/announcement', isAuthenticated, isAdmin, (req, res) => {
  try {
    const { announcement_title, announcement_content, hari_aktif } = req.body;
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

    upsert.run('announcement_title', announcement_title ? announcement_title.trim() : '');
    upsert.run('announcement_content', announcement_content ? announcement_content.trim() : '');
    if (hari_aktif !== undefined) upsert.run('hari_aktif', hari_aktif.trim());

    res.redirect('/dashboard/cms?success=Pengumuman landing page berhasil diperbarui.');
  } catch (err) {
    res.redirect(`/dashboard/cms?error=${encodeURIComponent(err.message)}`);
  }
});

// 7. Simpan Pengaturan Jam Sekolah & Absensi
router.post('/dashboard/cms/schedule', isAuthenticated, isAdmin, (req, res) => {
  try {
    const { hari_aktif, jam_masuk, toleransi_telat, jam_cutoff_alpa, wa_auto_teacher_summary, jam_rekap_guru, scheduler_timezone } = req.body;
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

    if (hari_aktif !== undefined) upsert.run('hari_aktif', hari_aktif.trim());
    if (jam_masuk) upsert.run('jam_masuk', jam_masuk.trim());
    if (toleransi_telat) upsert.run('toleransi_telat', toleransi_telat.trim());
    if (jam_cutoff_alpa) upsert.run('jam_cutoff_alpa', jam_cutoff_alpa.trim());
    upsert.run('wa_auto_teacher_summary', wa_auto_teacher_summary === '1' ? '1' : '0');
    if (jam_rekap_guru) upsert.run('jam_rekap_guru', jam_rekap_guru.trim());
    if (scheduler_timezone) upsert.run('scheduler_timezone', scheduler_timezone.trim());

    res.redirect('/dashboard/cms?success=Jadwal operasional absensi berhasil diperbarui.');
  } catch (err) {
    res.redirect(`/dashboard/cms?error=${encodeURIComponent(err.message)}`);
  }
});

// 8. Simpan Pengaturan & Template Pesan WhatsApp
router.post('/dashboard/cms/whatsapp', isAuthenticated, isAdmin, (req, res) => {
  try {
    const { wa_enabled, wa_template_absen, wa_template_intro, wa_template_alpa } = req.body;
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');

    upsert.run('wa_enabled', wa_enabled === '1' ? '1' : '0');
    if (wa_template_absen) upsert.run('wa_template_absen', wa_template_absen.trim());
    if (wa_template_intro) upsert.run('wa_template_intro', wa_template_intro.trim());
    if (wa_template_alpa) upsert.run('wa_template_alpa', wa_template_alpa.trim());

    res.redirect('/dashboard/cms?success=Template pesan WhatsApp berhasil disimpan.');
  } catch (err) {
    res.redirect(`/dashboard/cms?error=${encodeURIComponent(err.message)}`);
  }
});

module.exports = router;
