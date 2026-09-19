const fs = require('fs');
const path = require('path');
const db = require('../src/database/db');
const config = require('../src/config');

const brainDir = 'C:\\Users\\DELL\\.gemini\\antigravity\\brain\\9e313289-b461-4052-88f7-2a28f9d1011f';

function copyIfFound(pattern, destFolder, destFileName) {
  const files = fs.readdirSync(brainDir);
  const matched = files.find(f => f.startsWith(pattern) && (f.endsWith('.jpg') || f.endsWith('.png')));
  if (matched) {
    const srcPath = path.join(brainDir, matched);
    const destPath = path.join(destFolder, destFileName);
    fs.copyFileSync(srcPath, destPath);
    console.log(`Copied ${matched} -> ${destFileName}`);
    return true;
  } else {
    console.warn(`File with pattern ${pattern} not found in ${brainDir}`);
    return false;
  }
}

async function setupImages() {
  console.log('--- Setting up Generated Images for School Website ---');

  // 1. Copy Logo
  if (copyIfFound('school_logo_', config.logosPath, 'school_logo.jpg')) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('school_logo', '/uploads/logos/school_logo.jpg') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  }

  // 2. Copy Hero Banner
  if (copyIfFound('school_hero_campus_', config.bannersPath, 'school_hero.jpg')) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('school_hero_image', '/uploads/banners/school_hero.jpg') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  }

  // 3. Copy Principal Photo
  if (copyIfFound('principal_portrait_', config.photosPath, 'principal.jpg')) {
    db.prepare("INSERT INTO settings (key, value) VALUES ('school_principal_photo', '/uploads/photos/principal.jpg') ON CONFLICT(key) DO UPDATE SET value = excluded.value").run();
  }

  // 4. Copy Gallery Photos
  copyIfFound('gallery_computer_lab_', config.galleryPath, 'computer_lab.jpg');
  copyIfFound('gallery_library_', config.galleryPath, 'library.jpg');
  copyIfFound('gallery_robotics_', config.galleryPath, 'robotics.jpg');

  // Update gallery records in SQLite
  db.prepare("UPDATE school_gallery SET image_url = '/uploads/banners/school_hero.jpg' WHERE id = 1 OR title LIKE '%Gedung%'").run();
  db.prepare("UPDATE school_gallery SET image_url = '/uploads/gallery/computer_lab.jpg' WHERE id = 2 OR title LIKE '%Komputer%'").run();
  db.prepare("UPDATE school_gallery SET image_url = '/uploads/gallery/library.jpg' WHERE id = 3 OR title LIKE '%Perpustakaan%'").run();
  db.prepare("UPDATE school_gallery SET image_url = '/uploads/gallery/robotics.jpg' WHERE id = 4 OR title LIKE '%Ekstrakurikuler%'").run();

  console.log('--- Setup Images Selesai ---');
}

setupImages();
