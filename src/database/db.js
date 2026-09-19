const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const config = require('../config');

// Pastikan direktori data & uploads tersedia
const dataDir = path.dirname(config.dbPath);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(config.baileysAuthPath)) fs.mkdirSync(config.baileysAuthPath, { recursive: true });
if (!fs.existsSync(config.photosPath)) fs.mkdirSync(config.photosPath, { recursive: true });
if (!fs.existsSync(config.logosPath)) fs.mkdirSync(config.logosPath, { recursive: true });
if (!fs.existsSync(config.galleryPath)) fs.mkdirSync(config.galleryPath, { recursive: true });
if (!fs.existsSync(config.bannersPath)) fs.mkdirSync(config.bannersPath, { recursive: true });

// Buka koneksi database SQLite dengan better-sqlite3
const db = new Database(config.dbPath);

// Konfigurasi performa tinggi WAL mode
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('foreign_keys = ON');
db.pragma('cache_size = -16000'); // 16MB cache

// Inisialisasi skema tabel jika belum ada
const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');
db.exec(schema);

module.exports = db;
