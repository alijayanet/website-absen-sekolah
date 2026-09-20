require('dotenv').config();
const path = require('path');

module.exports = {
  port: process.env.PORT || 3000,
  sessionSecret: process.env.SESSION_SECRET || 'absensi-super-secret-key',
  dbPath: path.resolve(process.env.DB_PATH || './data/database.sqlite'),
  baileysAuthPath: path.resolve(process.env.AUTH_FOLDER || './data/baileys_auth'),
  uploadPath: path.resolve(process.env.UPLOAD_FOLDER || './data/uploads'),
  photosPath: path.resolve(process.env.UPLOAD_FOLDER || './data/uploads', 'photos'),
  logosPath: path.resolve(process.env.UPLOAD_FOLDER || './data/uploads', 'logos'),
  galleryPath: path.resolve(process.env.UPLOAD_FOLDER || './data/uploads', 'gallery'),
  bannersPath: path.resolve(process.env.UPLOAD_FOLDER || './data/uploads', 'banners'),
  lettersPath: path.resolve(process.env.UPLOAD_FOLDER || './data/uploads', 'letters'),
  qrisPath: path.resolve(process.env.UPLOAD_FOLDER || './data/uploads', 'qris')
};
