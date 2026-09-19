const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const db = require('../database/db');
const { isAuthenticated } = require('../middlewares/auth');
const config = require('../config');
const queue = require('../services/queue');

// Multer Storage untuk Foto Siswa
const photoStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, config.photosPath);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueName = `student_${Date.now()}_${Math.round(Math.random() * 1E9)}${ext}`;
    cb(null, uniqueName);
  }
});
const uploadPhoto = multer({
  storage: photoStorage,
  limits: { fileSize: 2 * 1024 * 1024 }, // Max 2MB
  fileFilter: (req, file, cb) => {
    if (/image\/(jpeg|jpg|png|webp)/.test(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Format file harus berupa gambar (JPG, PNG, atau WEBP).'));
    }
  }
});

// Multer Storage untuk Import Excel
const excelStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const tempDir = path.join(config.uploadPath, 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
    cb(null, tempDir);
  },
  filename: (req, file, cb) => {
    cb(null, `import_${Date.now()}.xlsx`);
  }
});
const uploadExcel = multer({ storage: excelStorage });

// 1. Tampilkan Daftar Siswa
router.get('/dashboard/students', isAuthenticated, (req, res) => {
  const { q, class_id, wa_status } = req.query;
  const user = req.session.user;
  const isGuru = user.role === 'guru';

  let query = `
    SELECT s.*, c.name as class_name 
    FROM students s
    LEFT JOIN classes c ON s.class_id = c.id
    WHERE s.is_active = 1
  `;
  const params = [];

  // Jika guru, batasi hanya kelas binaannya secara ketat
  if (isGuru) {
    if (user.class_id) {
      query += ` AND s.class_id = ? `;
      params.push(user.class_id);
    } else {
      // Guru belum punya kelas binaan
      query += ` AND 1 = 0 `;
    }
  } else if (class_id) {
    query += ` AND s.class_id = ? `;
    params.push(class_id);
  }

  if (wa_status) {
    query += ` AND s.wa_status = ? `;
    params.push(wa_status);
  }

  if (q) {
    query += ` AND (s.name LIKE ? OR s.nis LIKE ? OR s.nisn LIKE ? OR s.rfid_uid LIKE ?) `;
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }

  query += ` ORDER BY c.name ASC, s.name ASC `;

  const students = db.prepare(query).all(...params);
  const classes = (isGuru && user.class_id)
    ? db.prepare('SELECT * FROM classes WHERE id = ?').all(user.class_id)
    : db.prepare('SELECT * FROM classes ORDER BY name ASC').all();

  res.render('dashboard/students', {
    students,
    classes,
    query: { q: q || '', class_id: isGuru ? (user.class_id || '') : (class_id || ''), wa_status: wa_status || '' },
    successMsg: req.query.success || null,
    errorMsg: req.query.error || (!user.class_id && isGuru ? 'Akun Anda belum ditugaskan sebagai wali kelas. Hubungi Administrator.' : null)
  });
});

// 2. Tambah Siswa Baru
router.post('/dashboard/students', isAuthenticated, uploadPhoto.single('photo'), (req, res) => {
  try {
    const user = req.session.user;
    const { nis, nisn, rfid_uid, name, gender, parent_name, parent_phone } = req.body;
    let targetClassId = req.body.class_id;

    // Jika guru, otomatis tetapkan ke kelas binaannya
    if (user.role === 'guru') {
      if (!user.class_id) {
        return res.redirect('/dashboard/students?error=Akun Anda belum memiliki kelas binaan');
      }
      targetClassId = user.class_id;
    }

    if (!nis || !name || !targetClassId) {
      return res.redirect('/dashboard/students?error=NIS, Nama, dan Kelas wajib diisi');
    }

    // Buat token QR Code unik
    const qr_code_token = `QR-${nis}-${Date.now().toString(36).toUpperCase()}`;
    const photo = req.file ? `/uploads/photos/${req.file.filename}` : null;

    const stmt = db.prepare(`
      INSERT INTO students 
      (nis, nisn, rfid_uid, qr_code_token, name, gender, class_id, parent_name, parent_phone, photo, wa_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unverified')
    `);

    stmt.run(
      nis.trim(),
      nisn ? nisn.trim() : null,
      rfid_uid ? rfid_uid.trim() : null,
      qr_code_token,
      name.trim(),
      gender || 'L',
      targetClassId,
      parent_name ? parent_name.trim() : null,
      parent_phone ? parent_phone.trim() : null,
      photo
    );

    res.redirect('/dashboard/students?success=Data siswa berhasil ditambahkan');
  } catch (err) {
    console.error('Error insert student:', err);
    res.redirect(`/dashboard/students?error=${encodeURIComponent(err.message)}`);
  }
});

// 3. Edit Data Siswa
router.post('/dashboard/students/:id/edit', isAuthenticated, uploadPhoto.single('photo'), (req, res) => {
  try {
    const user = req.session.user;
    const { id } = req.params;
    const { nis, nisn, rfid_uid, name, gender, parent_name, parent_phone } = req.body;

    const current = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
    if (!current) {
      return res.redirect('/dashboard/students?error=Siswa tidak ditemukan');
    }

    // Validasi wewenang guru
    if (user.role === 'guru' && user.class_id && current.class_id !== user.class_id) {
      return res.redirect('/dashboard/students?error=Anda hanya berhak mengedit siswa di kelas binaan Anda');
    }

    let targetClassId = (user.role === 'guru' && user.class_id) ? user.class_id : (req.body.class_id || current.class_id);

    let photo = current.photo;
    if (req.file) {
      photo = `/uploads/photos/${req.file.filename}`;
      // Hapus foto lama jika ada
      if (current.photo) {
        const oldPath = path.join(config.uploadPath, current.photo.replace('/uploads/', ''));
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }
    }

    const stmt = db.prepare(`
      UPDATE students 
      SET nis = ?, nisn = ?, rfid_uid = ?, name = ?, gender = ?, class_id = ?, parent_name = ?, parent_phone = ?, photo = ?
      WHERE id = ?
    `);

    stmt.run(
      nis.trim(),
      nisn ? nisn.trim() : null,
      rfid_uid ? rfid_uid.trim() : null,
      name.trim(),
      gender || 'L',
      targetClassId,
      parent_name ? parent_name.trim() : null,
      parent_phone ? parent_phone.trim() : null,
      photo,
      id
    );

    res.redirect('/dashboard/students?success=Data siswa berhasil diperbarui');
  } catch (err) {
    console.error('Error update student:', err);
    res.redirect(`/dashboard/students?error=${encodeURIComponent(err.message)}`);
  }
});

// 4. Hapus Siswa
router.post('/dashboard/students/:id/delete', isAuthenticated, (req, res) => {
  try {
    const user = req.session.user;
    const { id } = req.params;

    const current = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
    if (current && user.role === 'guru' && user.class_id && current.class_id !== user.class_id) {
      return res.redirect('/dashboard/students?error=Anda hanya berhak menghapus siswa di kelas binaan Anda');
    }

    db.prepare('DELETE FROM students WHERE id = ?').run(id);
    res.redirect('/dashboard/students?success=Data siswa berhasil dihapus');
  } catch (err) {
    res.redirect(`/dashboard/students?error=${encodeURIComponent(err.message)}`);
  }
});

// 5. Kirim Notifikasi Pengenalan WhatsApp (Single Student)
router.post('/dashboard/students/:id/send-intro', isAuthenticated, (req, res) => {
  try {
    const { id } = req.params;
    const student = db.prepare(`
      SELECT s.*, c.name as class_name 
      FROM students s 
      LEFT JOIN classes c ON s.class_id = c.id 
      WHERE s.id = ?
    `).get(id);

    if (!student || !student.parent_phone) {
      return res.json({ success: false, message: 'Nomor WhatsApp wali murid tidak tersedia.' });
    }

    const templateSetting = db.prepare("SELECT value FROM settings WHERE key = 'wa_template_intro'").get()?.value;
    const schoolNameSetting = db.prepare("SELECT value FROM settings WHERE key = 'school_name'").get()?.value || 'Sekolah';

    const message = (templateSetting || '')
      .replace(/{nama_wali}/g, student.parent_name || 'Wali Murid')
      .replace(/{nama_siswa}/g, student.name)
      .replace(/{kelas}/g, student.class_name || '-')
      .replace(/{nama_sekolah}/g, schoolNameSetting);

    // Update status siswa menjadi intro_sent
    db.prepare(`
      UPDATE students 
      SET wa_status = 'intro_sent', wa_intro_sent_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `).run(id);

    // Masukkan ke antrean kirim
    queue.enqueue({
      studentId: student.id,
      phone: student.parent_phone,
      message,
      type: 'INTRO'
    });

    res.json({ success: true, message: `Pesan pengenalan untuk ${student.name} berhasil masuk ke antrean pengiriman.` });
  } catch (err) {
    console.error('Error send intro:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 6. Batch Kirim Notifikasi Pengenalan WhatsApp (Per Kelas atau Semua yang Unverified)
router.post('/dashboard/students/batch-send-intro', isAuthenticated, (req, res) => {
  try {
    const user = req.session.user;
    const { student_ids } = req.body;
    let targetClassId = (user.role === 'guru' && user.class_id) ? user.class_id : req.body.class_id;

    let query = `
      SELECT s.*, c.name as class_name 
      FROM students s 
      LEFT JOIN classes c ON s.class_id = c.id 
      WHERE s.is_active = 1 AND s.parent_phone IS NOT NULL AND s.parent_phone != '' 
    `;
    const params = [];

    // Jika guru, batasi hanya ke kelas binaannya
    if (user.role === 'guru') {
      if (!user.class_id) {
        return res.json({ success: false, message: 'Akun Anda belum memiliki kelas binaan.' });
      }
      query += ` AND s.class_id = ? `;
      params.push(user.class_id);
    }

    if (student_ids && Array.isArray(student_ids) && student_ids.length > 0) {
      const placeholders = student_ids.map(() => '?').join(',');
      query += ` AND s.id IN (${placeholders}) `;
      params.push(...student_ids);
    } else {
      query += ` AND s.wa_status = 'unverified' `;
      if (targetClassId && user.role !== 'guru') {
        query += ` AND s.class_id = ? `;
        params.push(targetClassId);
      }
    }

    const students = db.prepare(query).all(...params);

    if (students.length === 0) {
      return res.json({ success: false, message: 'Tidak ada siswa dengan status belum terverifikasi untuk diproses.' });
    }

    const templateSetting = db.prepare("SELECT value FROM settings WHERE key = 'wa_template_intro'").get()?.value;
    const schoolNameSetting = db.prepare("SELECT value FROM settings WHERE key = 'school_name'").get()?.value || 'Sekolah';

    const updateStmt = db.prepare(`
      UPDATE students 
      SET wa_status = 'intro_sent', wa_intro_sent_at = CURRENT_TIMESTAMP 
      WHERE id = ?
    `);

    for (const student of students) {
      const message = (templateSetting || '')
        .replace(/{nama_wali}/g, student.parent_name || 'Wali Murid')
        .replace(/{nama_siswa}/g, student.name)
        .replace(/{kelas}/g, student.class_name || '-')
        .replace(/{nama_sekolah}/g, schoolNameSetting);

      updateStmt.run(student.id);

      queue.enqueue({
        studentId: student.id,
        phone: student.parent_phone,
        message,
        type: 'INTRO'
      });
    }

    res.json({
      success: true,
      count: students.length,
      message: `${students.length} pesan pengenalan telah dimasukkan ke antrean pengiriman WhatsApp.`
    });
  } catch (err) {
    console.error('Error batch intro:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// 7. Export Siswa ke Excel (.xlsx)
router.get('/dashboard/students/export/excel', isAuthenticated, (req, res) => {
  try {
    const user = req.session.user;
    let targetClassId = (user.role === 'guru' && user.class_id) ? user.class_id : req.query.class_id;

    let query = `
      SELECT s.nis, s.nisn, s.rfid_uid, s.qr_code_token, s.name, s.gender, c.name as class_name, 
             s.parent_name, s.parent_phone, s.wa_status
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      WHERE s.is_active = 1
    `;
    const params = [];

    if (user.role === 'guru') {
      if (!user.class_id) {
        query += ` AND 1 = 0 `;
      } else {
        query += ` AND s.class_id = ? `;
        params.push(user.class_id);
      }
    } else if (targetClassId) {
      query += ` AND s.class_id = ? `;
      params.push(targetClassId);
    }
    query += ` ORDER BY c.name ASC, s.name ASC `;

    const data = db.prepare(query).all(...params);

    const worksheet = XLSX.utils.json_to_sheet(data.map(item => ({
      'NIS': item.nis,
      'NISN': item.nisn || '',
      'UID RFID': item.rfid_uid || '',
      'Token QR': item.qr_code_token,
      'Nama Siswa': item.name,
      'L/P': item.gender,
      'Kelas': item.class_name || '',
      'Nama Wali': item.parent_name || '',
      'No WA Wali': item.parent_phone || '',
      'Status WA': item.wa_status
    })));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Data Siswa');

    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Disposition', `attachment; filename=Data_Siswa_${Date.now()}.xlsx`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    console.error('Error export excel:', err);
    res.redirect('/dashboard/students?error=Gagal mengekspor data siswa');
  }
});

// 8. Import Siswa dari Excel (.xlsx)
router.post('/dashboard/students/import/excel', isAuthenticated, uploadExcel.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.redirect('/dashboard/students?error=Pilih file Excel terlebih dahulu');
    }

    const workbook = XLSX.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const rawData = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);

    // Bersihkan file sementara
    try { fs.unlinkSync(req.file.path); } catch (e) {}

    let insertedCount = 0;
    let skippedCount = 0;

    const classes = db.prepare('SELECT id, name FROM classes').all();
    const classMap = new Map();
    classes.forEach(c => classMap.set(c.name.trim().toUpperCase(), c.id));

    const insertStudent = db.prepare(`
      INSERT OR REPLACE INTO students 
      (nis, nisn, rfid_uid, qr_code_token, name, gender, class_id, parent_name, parent_phone, wa_status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unverified')
    `);

    for (const row of rawData) {
      const nis = String(row['NIS'] || row['nis'] || '').trim();
      const name = String(row['Nama Siswa'] || row['Nama'] || row['nama'] || '').trim();
      const className = String(row['Kelas'] || row['kelas'] || '').trim().toUpperCase();

      if (!nis || !name) {
        skippedCount++;
        continue;
      }

      // Cek atau buat kelas jika belum ada
      let classId = classMap.get(className);
      if (!classId && className) {
        const createClass = db.prepare('INSERT INTO classes (name) VALUES (?)').run(className);
        classId = createClass.lastInsertRowid;
        classMap.set(className, classId);
      }

      const nisn = row['NISN'] ? String(row['NISN']).trim() : null;
      const rfid = row['UID RFID'] || row['RFID'] ? String(row['UID RFID'] || row['RFID']).trim() : null;
      const gender = (row['L/P'] || row['gender'] || 'L').toString().toUpperCase().startsWith('P') ? 'P' : 'L';
      const parentName = row['Nama Wali'] ? String(row['Nama Wali']).trim() : null;
      const parentPhone = row['No WA Wali'] || row['No WA'] || row['Telepon'] ? String(row['No WA Wali'] || row['No WA'] || row['Telepon']).trim() : null;
      const qrToken = `QR-${nis}-${Date.now().toString(36).toUpperCase()}`;

      try {
        insertStudent.run(nis, nisn, rfid, qrToken, name, gender, classId || 1, parentName, parentPhone);
        insertedCount++;
      } catch (insertErr) {
        skippedCount++;
      }
    }

    res.redirect(`/dashboard/students?success=Berhasil mengimpor ${insertedCount} siswa (Dilewati: ${skippedCount})`);
  } catch (err) {
    console.error('Error import excel:', err);
    res.redirect(`/dashboard/students?error=Gagal mengimpor file: ${encodeURIComponent(err.message)}`);
  }
});

module.exports = router;
