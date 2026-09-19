const QRCode = require('qrcode');
const db = require('../database/db');

class IDCardService {
  /**
   * Menghasilkan data URL QR code beresolusi tinggi untuk token kartu siswa
   */
  async generateQRCode(text) {
    try {
      return await QRCode.toDataURL(text, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 300,
        color: {
          dark: '#0f172a',
          light: '#ffffff'
        }
      });
    } catch (err) {
      console.error('Error generating QR code:', err);
      return '';
    }
  }

  /**
   * Mengambil data siswa beserta QR code yang sudah di-generate untuk kartu
   */
  async getCardDataForStudent(studentId) {
    const student = db.prepare(`
      SELECT s.*, c.name as class_name 
      FROM students s 
      LEFT JOIN classes c ON s.class_id = c.id 
      WHERE s.id = ?
    `).get(studentId);

    if (!student) return null;

    student.qr_data_url = await this.generateQRCode(student.qr_code_token || student.nis);
    return student;
  }

  /**
   * Mengambil data seluruh siswa dalam kelas untuk cetak massal
   */
  async getCardDataForClass(classId) {
    let query = `
      SELECT s.*, c.name as class_name 
      FROM students s 
      LEFT JOIN classes c ON s.class_id = c.id 
    `;
    const params = [];
    if (classId) {
      query += ` WHERE s.class_id = ? `;
      params.push(classId);
    }
    query += ` ORDER BY c.name ASC, s.name ASC `;

    const students = db.prepare(query).all(...params);

    for (const student of students) {
      student.qr_data_url = await this.generateQRCode(student.qr_code_token || student.nis);
    }

    return students;
  }

  /**
   * Mengambil data daftar siswa berdasarkan array of ID untuk cetak terpilih (checkbox)
   */
  async getCardDataForStudents(studentIds) {
    if (!studentIds || !Array.isArray(studentIds) || studentIds.length === 0) {
      return [];
    }
    const cleanIds = studentIds.map(id => Number(id)).filter(id => !isNaN(id) && id > 0);
    if (cleanIds.length === 0) return [];

    const placeholders = cleanIds.map(() => '?').join(',');
    const query = `
      SELECT s.*, c.name as class_name 
      FROM students s 
      LEFT JOIN classes c ON s.class_id = c.id 
      WHERE s.id IN (${placeholders})
      ORDER BY c.name ASC, s.name ASC
    `;
    const students = db.prepare(query).all(...cleanIds);

    for (const student of students) {
      student.qr_data_url = await this.generateQRCode(student.qr_code_token || student.nis);
    }
    return students;
  }

  /**
   * Mengambil data semua siswa untuk cetak semua (bisa dengan filter)
   */
  async getAllCardData(filters = {}) {
    let query = `
      SELECT s.*, c.name as class_name 
      FROM students s 
      LEFT JOIN classes c ON s.class_id = c.id 
    `;
    const conditions = [];
    const params = [];

    if (filters.class_id) {
      conditions.push('s.class_id = ?');
      params.push(filters.class_id);
    }
    if (filters.wa_status) {
      conditions.push('s.wa_status = ?');
      params.push(filters.wa_status);
    }
    if (filters.q) {
      conditions.push('(s.name LIKE ? OR s.nis LIKE ? OR s.rfid_uid LIKE ?)');
      params.push(`%${filters.q}%`, `%${filters.q}%`, `%${filters.q}%`);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }
    query += ' ORDER BY c.name ASC, s.name ASC ';

    const students = db.prepare(query).all(...params);

    for (const student of students) {
      student.qr_data_url = await this.generateQRCode(student.qr_code_token || student.nis);
    }
    return students;
  }
}

module.exports = new IDCardService();
