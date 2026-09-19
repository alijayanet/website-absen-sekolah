const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middlewares/auth');
const idcardService = require('../services/idcard');

// Cetak Semua Kartu Pelajar (dengan filter opsional class_id, q, wa_status)
router.get('/dashboard/students/cards/all', isAuthenticated, async (req, res) => {
  try {
    const user = req.session.user;
    let targetClassId = (user.role === 'guru' && user.class_id) ? user.class_id : req.query.class_id;

    if (user.role === 'guru' && !user.class_id) {
      return res.status(403).send('Akun Anda belum memiliki kelas binaan.');
    }

    const filters = {
      class_id: targetClassId,
      q: req.query.q,
      wa_status: req.query.wa_status
    };

    const students = await idcardService.getAllCardData(filters);
    if (students.length === 0) {
      return res.status(404).send('Tidak ada data siswa untuk dicetak.');
    }

    res.render('idcard-print', {
      students,
      isBatch: true
    });
  } catch (err) {
    console.error('Error print all ID cards:', err);
    res.status(500).send('Gagal mencetak semua kartu: ' + err.message);
  }
});

// Cetak Kartu Pelajar Terpilih via GET (query string ?ids=1,2,3)
router.get('/dashboard/students/cards/selected', isAuthenticated, async (req, res) => {
  try {
    const idsParam = req.query.ids || '';
    const studentIds = idsParam.split(',').map(s => s.trim()).filter(Boolean);

    if (studentIds.length === 0) {
      return res.status(400).send('Tidak ada siswa yang dipilih.');
    }

    const students = await idcardService.getCardDataForStudents(studentIds);
    if (students.length === 0) {
      return res.status(404).send('Data siswa yang dipilih tidak ditemukan.');
    }

    res.render('idcard-print', {
      students,
      isBatch: true
    });
  } catch (err) {
    console.error('Error GET print selected ID cards:', err);
    res.status(500).send('Gagal mencetak kartu terpilih: ' + err.message);
  }
});

// Cetak Kartu Pelajar Terpilih via POST (form submission dari checkbox)
router.post('/dashboard/students/cards/selected', isAuthenticated, async (req, res) => {
  try {
    let studentIds = req.body.student_ids;
    if (!studentIds) {
      return res.status(400).send('Tidak ada siswa yang dipilih.');
    }
    if (!Array.isArray(studentIds)) {
      studentIds = [studentIds];
    }

    const students = await idcardService.getCardDataForStudents(studentIds);
    if (students.length === 0) {
      return res.status(404).send('Data siswa yang dipilih tidak ditemukan.');
    }

    res.render('idcard-print', {
      students,
      isBatch: true
    });
  } catch (err) {
    console.error('Error POST print selected ID cards:', err);
    res.status(500).send('Gagal mencetak kartu terpilih: ' + err.message);
  }
});

// Cetak Kartu Pelajar Satuan
router.get('/dashboard/students/:id/card', isAuthenticated, async (req, res) => {
  try {
    const user = req.session.user;
    const student = await idcardService.getCardDataForStudent(req.params.id);
    if (!student) {
      return res.status(404).send('Data siswa tidak ditemukan.');
    }

    if (user.role === 'guru' && user.class_id && Number(student.class_id) !== Number(user.class_id)) {
      return res.status(403).send('Akses Ditolak: Anda hanya berhak mencetak kartu untuk siswa di kelas binaan Anda.');
    }

    res.render('idcard-print', {
      students: [student],
      isBatch: false
    });
  } catch (err) {
    console.error('Error generate ID card:', err);
    res.status(500).send('Gagal membuat kartu pelajar: ' + err.message);
  }
});

// Cetak Kartu Pelajar Massal Per Kelas
router.get('/dashboard/classes/:id/cards', isAuthenticated, async (req, res) => {
  try {
    const user = req.session.user;
    if (user.role === 'guru' && user.class_id && Number(req.params.id) !== Number(user.class_id)) {
      return res.status(403).send('Akses Ditolak: Anda hanya berhak mencetak kartu untuk kelas binaan Anda.');
    }

    const students = await idcardService.getCardDataForClass(req.params.id);
    if (students.length === 0) {
      return res.status(404).send('Tidak ada siswa pada kelas ini.');
    }

    res.render('idcard-print', {
      students,
      isBatch: true
    });
  } catch (err) {
    console.error('Error batch ID cards:', err);
    res.status(500).send('Gagal membuat kartu kelas: ' + err.message);
  }
});

module.exports = router;
