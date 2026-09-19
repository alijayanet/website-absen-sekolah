# Sistem Absensi Sekolah Real-Time & Web Profil Sekolah

[![GitHub Repository](https://img.shields.io/badge/GitHub-alijayanet%2Fwebsite--absen--sekolah-181717?style=for-the-badge&logo=github)](https://github.com/alijayanet/website-absen-sekolah)
[![Node.js](https://img.shields.io/badge/Node.js-v18%20%7C%20v20+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-v4.21-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![SQLite WAL](https://img.shields.io/badge/SQLite-WAL%20Mode-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![WhatsApp Baileys](https://img.shields.io/badge/WhatsApp-Baileys%20Gateway-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)](https://github.com/WhiskeySockets/Baileys)
[![Developer](https://img.shields.io/badge/Pengembang-ALIJAYA--NET-0284c7?style=for-the-badge&logo=codeforces&logoColor=white)](#-pengembang--dukungan)
[![WhatsApp Support](https://img.shields.io/badge/WhatsApp-081947215703-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)](https://wa.me/6281947215703)

Sistem Informasi Manajemen Presensi Siswa Sekolah Modern berbasis Web yang terintegrasi langsung dengan **WhatsApp Gateway (Baileys)**, **Dual Scanner (RFID USB Keyboard Wedge & QR Code Kamera HP/Webcam)**, **Generator Cetak Kartu Pelajar Standar CR80**, **Website Profil Sekolah Lengkap dengan CMS**, dan **Cek Kehadiran Mandiri Wali Murid**.

---

## 📑 Daftar Isi
- [Keunggulan Sistem](#-keunggulan-sistem)
- [Keterangan Fitur Lengkap](#-keterangan-fitur-lengkap)
  - [1. Layar Kiosk Scanner Gerbang Sekolah](#1-layar-kiosk-scanner-gerbang-sekolah-kiosk)
  - [2. WhatsApp Gateway Baileys & Onboarding 2-Arah](#2-whatsapp-gateway-baileys--onboarding-2-arah-anti-banned)
  - [3. Cetak Kartu Pelajar Standar CR80](#3-cetak-kartu-pelajar-standar-cr80-pvc--atm)
  - [4. Website Profil Sekolah & Cek Mandiri Wali Murid](#4-website-profil-sekolah--cek-mandiri-wali-murid)
  - [5. CMS Terintegrasi di Dashboard Admin](#5-cms-terintegrasi-di-dashboard-admin)
  - [6. Manajemen Akademik & Rekapitulasi Excel](#6-manajemen-akademik--rekapitulasi-excel)
- [Prasyarat Sistem (Prerequisites)](#-prasyarat-sistem-prerequisites)
- [Langkah-Langkah Instalasi](#-langkah-langkah-instalasi)
- [Panduan Menghubungkan WhatsApp](#-panduan-menghubungkan-whatsapp)
- [Akun Pengguna Bawaan (Default Credentials)](#-akun-pengguna-bawaan-default-credentials)
- [Akses Cepat URL Sistem](#-akses-cepat-url-sistem)
- [Struktur Direktori Proyek](#-struktur-direktori-proyek)
- [Pengembang & Dukungan](#-pengembang--dukungan)
- [Lisensi](#-lisensi)

---

## 🌟 Keunggulan Sistem

- **Presensi Masuk Saja (*Single Tap In*)**: Didesain khusus untuk efisiensi gerbang sekolah di pagi hari, siswa cukup tap satu kali tanpa perlu antre panjang memilih opsi masuk/pulang.
- **Dukungan Kamera Ponsel Optimal**: Tampilan Kiosk responsif di layar ponsel, mendukung pergantian kamera depan/belakang, pemilihan lensa, serta fallback foto bawaan kamera HP 100% jalan di semua perangkat.
- **WhatsApp Onboarding 2-Arah Anti-Banned**: Melindungi nomor bot sekolah dari pemblokiran spam WhatsApp dengan mewajibkan wali murid menyimpan kontak dan membalas **"YA"** untuk konfirmasi dua arah.
- **Zero Heavy Database Setup**: Menggunakan SQLite dengan mode **WAL (Write-Ahead Logging)** yang super cepat, ringan, andal, tanpa perlu repot instalasi/konfigurasi server database MySQL/PostgreSQL terpisah.
- **Audio Feedback Mandiri**: Dilengkapi efek suara chime, warning, dan buzz menggunakan Web Audio API murni tanpa beban file audio eksternal.

---

## 🚀 Keterangan Fitur Lengkap

### 1. Layar Kiosk Scanner Gerbang Sekolah (`/kiosk`)
* **Dual Method Input**:
  * **RFID USB Reader**: Listener otomatis keyboard wedge menangkap ketikan nomor kartu RFID tanpa perlu mengeklik form input secara manual.
  * **Kamera QR Code**: Memindai QR Code kartu pelajar melalui kamera webcam laptop maupun kamera smartphone secara live.
* **Fitur Ramah Ponsel (Mobile-Friendly Kiosk)**:
  * Tombol balik kamera (**Depan / Belakang**) untuk kenyamanan memindai lewat smartphone.
  * Selector pemilihan lensa kamera jika perangkat memiliki lebih dari 1 kamera.
  * Indikator status diagnostik visual secara langsung di layar HP (menampilkan status kamera & protokol SSL).
  * **Tombol Buka Kamera HP (Ambil Foto QR)**: Menggunakan dialog kamera native ponsel (`capture="environment"`) yang bekerja 100% di semua browser mobile.
* **Logika Kehadiran Cerdas**:
  * Menghitung status `HADIR` tepat waktu (sebelum jam masuk) atau `TERLAMBAT` (dengan penghitungan rincian menit keterlambatan).
  * **Anti-Double Scan**: Mencegah siswa melakukan tap lebih dari 1 kali di hari yang sama.
* **Audio FX Synthesizer**: Suara chime merdu saat hadir, nada peringatan saat telat, dan nada buzz saat kartu tidak dikenali.
* **Popup Real-Time Siswa**: Animasi modal otomatis memunculkan foto siswa, nama, kelas, jam masuk, dan badge warna status sebelum tertutup otomatis setelah 3.5 detik.

### 2. WhatsApp Gateway Baileys & Onboarding 2-Arah (Anti-Banned)
* **Onboarding 2-Arah (Simpan Kontak & Balas 'YA')**:
  * Tombol di Data Siswa untuk mengirim pesan perkenalan resmi dari sekolah ke nomor wali murid:
    > *"Bapak/Ibu Wali Murid dari [Nama Siswa], ini adalah nomor resmi notifikasi presensi sekolah. Mohon SIMPAN KONTAK ini dan balas pesan ini dengan kata YA agar sistem verifikasi aktif."*
  * **Auto-Reply & Deteksi Otomatis 'YA'**: Saat wali murid membalas *"YA"*, Baileys otomatis mendeteksi kata tersebut, memverifikasi status siswa menjadi `confirmed`, dan mengirimkan pesan konfirmasi terima kasih otomatis.
* **Antrean Pesan SQLite (Message Queue Worker)**:
  * Pesan tidak dikirim serentak sekaligus, melainkan melalui worker antrean dengan jeda acak **1.5 hingga 3 detik** antar pesan untuk mematuhi rate limit WhatsApp dan mencegah nomor diblokir.
* **Notifikasi Presensi Real-Time**: Pesan otomatis terkirim ke WhatsApp wali murid begitu siswa berhasil absen di gerbang sekolah.
* **Broadcast Siswa Belum Hadir (Alpa)**: Fitur satu klik di dashboard untuk mengirimkan notifikasi massal kepada seluruh wali murid yang anaknya belum hadir pada jam batas kehadiran sekolah.
* **Manajemen Sesi Baileys di Dashboard**:
  * QR Code pairing WhatsApp live refresh secara real-time.
  * Status koneksi sesi (Terhubung / Menunggu Scan / Terputus).
  * Fitur kirim pesan uji coba (*Test Send*), restart koneksi, dan logout sesi.

### 3. Cetak Kartu Pelajar Standar CR80 (PVC / ATM)
* **Dimensi Standar Internasional CR80**: Ukuran **85.60 mm × 53.98 mm** dengan sudut melengkung (*rounded corner*) 3.5 mm, presisi untuk kartu PVC, mesin cetak ID Card, atau kertas stiker A4.
* **Layout Kartu Elegan**: Memuat logo resmi sekolah, nama instansi, pasfoto siswa, nama lengkap, NIS, NISN, kelas, serta **QR Code resolusi tinggi** yang siap dibaca oleh scanner gerbang.
* **Opsi Pencetakan Fleksibel**:
  * **Cetak Satuan**: Tombol cetak kartu langsung pada tiap baris siswa (`/dashboard/students/:id/card`).
  * **Cetak Berdasarkan Checkbox (Pilihan / Select All)**: Centang siswa yang diinginkan secara fleksibel, lalu klik *"Cetak Kartu Terpilih"* melalui bilah aksi melayang (*floating action bar*).
  * **Cetak Semua Kartu Siswa**: Tombol satu klik untuk mencetak seluruh kartu siswa (atau sesuai filter pencarian/kelas aktif).
  * **Cetak Massal Per Kelas (*Batch Print*)**: Cetak seluruh kartu siswa dalam satu kelas sekaligus (`/dashboard/classes/:id/cards`).

### 4. Website Profil Sekolah & Cek Mandiri Wali Murid
* **Beranda Informatif & Modern**:
  * Top bar informasi jam operasional, akreditasi, email, dan telepon resmi.
  * Hero banner kampus dengan tampilan transparan profesional.
  * Sambutan Kepala Sekolah beserta foto resmi pimpinan.
  * Visi & Misi pendidikan terstruktur.
  * Program unggulan dan fasilitas sekolah (Lab Komputer, Perpustakaan, Ekstrakurikuler Robotika).
  * Galeri foto kegiatan dan prestasi siswa.
  * Papan pengumuman resmi dan agenda kegiatan akademik.
* **Cek Kehadiran Mandiri Siswa**:
  * Wali murid cukup memasukkan **NIS** atau **NISN** di halaman beranda.
  * Menampilkan ringkasan kehadiran bulan berjalan (Tepat Waktu, Terlambat, Izin, Sakit, Alpa, dan Persentase).
  * Dilengkapi kalender interaktif riwayat presensi harian siswa.

### 5. CMS Terintegrasi di Dashboard Admin
* **Kelola Profil Sekolah**: Ubah nama sekolah, tagline, deskripsi, alamat, kontak WhatsApp, telepon, dan email.
* **Upload Aset Gambar**:
  * Upload **Logo Sekolah** (otomatis terpasang di header web, kartu CR80, dan footer).
  * Upload **Banner Hero Utama**.
  * Upload **Foto Kepala Sekolah**.
  * Upload & kelola **Galeri Foto Kegiatan**.
* **Konfigurasi Jam Presensi**: Atur jam masuk (default: `07:00`), batas toleransi telat (default: `07:15`), dan jam cutoff broadcast alpa (default: `08:00`).
* **Template Pesan WhatsApp**: Sesuaikan template pesan kehadiran dengan variabel dinamis: `{nama_siswa}`, `{kelas}`, `{tanggal}`, `{jam}`, `{status}`, `{keterangan_telat}`, dan `{nama_sekolah}`.

### 6. Manajemen Akademik & Rekapitulasi Excel
* **Role-Based Access Control (RBAC)**:
  * **Administrator**: Akses penuh ke seluruh menu, siswa, kelas, akun pengguna, CMS, WhatsApp Gateway, dan laporan.
  * **Guru / Wali Kelas**: Akses khusus untuk memantau presensi kelas binaan serta mencatat status Izin/Sakit siswa.
* **Import & Export Excel (`.xlsx`)**:
  * Import data siswa massal dari file Excel.
  * Export rekapitulasi kehadiran bulanan ke file Microsoft Excel lengkap dengan filter kelas dan rentang tanggal.

---

## 💻 Prasyarat Sistem (Prerequisites)

Sebelum melakukan instalasi, pastikan perangkat Anda telah memenuhi syarat berikut:
1. **Node.js**: Versi **18.x** atau **20.x LTS** ([Unduh Node.js](https://nodejs.org/)).
2. **NPM**: Versi **9.x** atau lebih baru (otomatis terpasang bersama Node.js).
3. **Perangkat Keras Presensi (Opsional)**:
   - Barcode/QR Code Scanner atau Kamera Laptop/Webcam/Kamera HP.
   - Reader RFID USB (13.56 MHz Mifare atau 125 kHz Proximity) tipe *Plug-and-Play USB Keyboard Wedge*.

---

## 📦 Langkah-Langkah Instalasi

Ikuti langkah-langkah berikut untuk memasang dan menjalankan aplikasi:

### 1. Clone Repository
```bash
git clone https://github.com/alijayanet/website-absen-sekolah.git
cd website-absen-sekolah
```

### 2. Install Dependensi Proyek
```bash
npm install
```

### 3. Konfigurasi File Environment (`.env`)
Buat file konfigurasi `.env` dengan menyalin template dari `env-example.txt`:

* **Windows (PowerShell / Command Prompt)**:
  ```cmd
  copy env-example.txt .env
  ```
* **Linux / macOS**:
  ```bash
  cp env-example.txt .env
  ```

> [!NOTE]
> Buka file `.env` jika Anda ingin menyesuaikan nomor `PORT` (default: `3000`), `SESSION_SECRET`, atau lokasi penyimpanan folder data.

### 4. Inisialisasi Database & Data Awal (Seeding)
Jalankan perintah berikut untuk membuat struktur database SQLite WAL dan mengisi data awal (pengaturan sekolah, akun demo, data kelas, data siswa, dan contoh galeri):
```bash
npm run seed
```

### 5. Menjalankan Server Aplikasi
* **Mode Standar (Foreground)**:
  ```bash
  npm start
  ```
* **Mode Pengembangan (Auto-Reload saat ada perubahan file)**:
  ```bash
  npm run dev
  ```

#### 🚀 Mode Background / Daemon dengan PM2 (Tetap Berjalan Saat Console Ditutup)
Agar aplikasi dapat berjalan terus-menerus di latar belakang (*background service*) tanpa perlu membiarkan jendela Command Prompt / Terminal terbuka, gunakan **PM2**:

1. **Instal PM2 secara Global** *(hanya perlu sekali saja)*:
   ```bash
   npm install -g pm2
   ```

2. **Jalankan Aplikasi di Background**:
   ```bash
   npm run pm2:start
   # atau perintah langsung:
   pm2 start ecosystem.config.js
   ```
   > [!NOTE]
   > Setelah perintah di atas dijalankan, **jendela console/terminal dapat langsung ditutup**. Server aplikasi akan tetap aktif melayani presensi dan WhatsApp di background!

3. **Perintah Manajemen PM2 (Cheat Sheet)**:
   | Perintah | Fungsi / Keterangan |
   |---|---|
   | `npm run pm2:status` *(atau `pm2 status`)* | Menampilkan status server, penggunaan memori (RAM), & CPU |
   | `npm run pm2:logs` *(atau `pm2 logs absensi-sekolah`)* | Melihat live output log server & pesan WhatsApp |
   | `npm run pm2:restart` *(atau `pm2 restart absensi-sekolah`)* | Me-restart ulang server aplikasi secara instan |
   | `npm run pm2:stop` *(atau `pm2 stop absensi-sekolah`)* | Menghentikan server aplikasi |

4. **Jalankan Otomatis Saat Komputer / Server Menyala (Auto-Start on Boot)**:
   * **Untuk Windows Server / Desktop**:
     Buka PowerShell sebagai Administrator, lalu jalankan:
     ```powershell
     npm install -g pm2-windows-startup
     pm2-startup install
     pm2 save
     ```
   * **Untuk Linux / VPS (Ubuntu, Debian, CentOS)**:
     ```bash
     pm2 startup
     # Salin & jalankan perintah sudo env PATH... yang dimunculkan di terminal, kemudian:
     pm2 save
     ```


Aplikasi siap diakses melalui browser di alamat:
👉 **`http://localhost:3000`** atau **`http://127.0.0.1:3000`**

> [!TIP]
> **Akses dari Ponsel dalam Jaringan Wi-Fi yang Sama:**
> Buka browser di ponsel Anda dan akses menggunakan IP lokal komputer host, misalnya: `http://192.168.1.5:3000/kiosk`.
> Untuk membuka kamera live stream di browser ponsel (Chrome/Safari), gunakan koneksi **HTTPS** (atau gunakan layanan terowongan SSL gratis seperti **ngrok** / **Cloudflare Tunnel**). Tombol *"Buka Kamera HP (Ambil Foto QR)"* tetap dapat digunakan langsung di semua mode jaringan.

---

## 📱 Panduan Menghubungkan WhatsApp

1. Jalankan aplikasi dan login ke Dashboard Administrator di `http://localhost:3000/login`.
2. Klik menu **WhatsApp Baileys** pada bilah menu samping (*sidebar*).
3. Tunggu 3–5 detik hingga **QR Code WhatsApp** muncul di layar.
4. Buka aplikasi **WhatsApp** di ponsel Anda:
   - Ketuk menu titik tiga (Android) atau Pengaturan (iOS).
   - Pilih **Perangkat Tertaut** (*Linked Devices*).
   - Ketuk **Tautkan Perangkat** (*Link a Device*).
   - Arahkan kamera ponsel ke QR Code di layar monitor.
5. Status koneksi akan otomatis berubah menjadi **"WhatsApp Terhubung"**.
6. Gunakan tombol **Kirim Pesan Uji Coba** untuk memverifikasi bahwa gateway telah aktif dan siap mengirim notifikasi.

---

## 🔐 Akun Pengguna Bawaan (Default Credentials)

Setelah menjalankan `npm run seed`, Anda dapat langsung login menggunakan akun berikut:

| Peran (Role) | Username | Password | Hak Akses |
|---|---|---|---|
| **Administrator** | `admin` | `admin123` | Akses penuh seluruh sistem, CMS, Pengaturan Jam, Akun, dan WhatsApp |
| **Guru / Wali Kelas** | `guru_ipa1` | `guru123` | Monitoring kehadiran kelas X IPA 1 & input status Izin/Sakit |

*(Kredensial dan password dapat diubah kapan saja melalui menu Manajemen Pengguna di Dashboard Admin).*

---

## 🌐 Akses Cepat URL Sistem

| Halaman | URL | Keterangan |
|---|---|---|
| **Website Utama & Profil Sekolah** | `http://localhost:3000/` | Beranda sekolah, info profil, galeri, dan pencarian mandiri kehadiran siswa |
| **Layar Kiosk Scanner Gerbang** | `http://localhost:3000/kiosk` | Layar presensi mandiri RFID & QR Code siswa di gerbang sekolah |
| **Halaman Login Petugas** | `http://localhost:3000/login` | Form login aman untuk Admin dan Guru |
| **Dashboard Utama** | `http://localhost:3000/dashboard` | Statistik kehadiran real-time hari ini dan grafik kehadiran |
| **Manajemen Data Siswa** | `http://localhost:3000/dashboard/students` | Tambah, edit, hapus, kirim notif pengenalan, dan cetak kartu siswa |
| **WhatsApp Gateway** | `http://localhost:3000/dashboard/whatsapp` | Hubungkan nomor WhatsApp, monitoring sesi, dan test kirim pesan |
| **CMS & Pengaturan Sekolah** | `http://localhost:3000/dashboard/cms` | Upload logo, banner, foto kepsek, galeri, dan setting jam masuk |

---

## 📁 Struktur Direktori Proyek

```plaintext
website-absen-sekolah/
├── data/
│   ├── absensi.db            # Database SQLite (Mode WAL aktif)
│   ├── auth_baileys/         # Sesi autentikasi multi-file Baileys WhatsApp
│   └── uploads/              # Direktori penyimpanan file & foto terunggah
│       ├── banners/          # Foto banner hero sekolah
│       ├── gallery/          # Dokumentasi kegiatan & fasilitas sekolah
│       ├── logos/            # Logo resmi sekolah
│       ├── photos/           # Pasfoto kepala sekolah
│       └── students/         # Pasfoto siswa
├── src/
│   ├── database/
│   │   ├── db.js             # Inisialisasi koneksi SQLite & mode WAL
│   │   ├── schema.sql        # Skema tabel database
│   │   └── seed.js           # Script seeding data awal
│   ├── middleware/
│   │   └── auth.js           # Middleware autentikasi sesi login & RBAC role
│   ├── routes/
│   │   ├── attendances.js    # Rute laporan & manajemen presensi
│   │   ├── auth.js           # Rute autentikasi login & logout
│   │   ├── classes.js        # Rute manajemen kelas & cetak kartu rombel
│   │   ├── cms.js            # Rute pengelolaan konten web sekolah & jam
│   │   ├── dashboard.js      # Rute halaman ringkasan & statistik
│   │   ├── idcard.js         # Rute rendering kartu pelajar CR80
│   │   ├── kiosk.js          # Rute layar kiosk scanner gerbang & API scan
│   │   ├── landing.js        # Rute halaman depan & pencarian mandiri wali murid
│   │   ├── students.js       # Rute CRUD data siswa & impor Excel
│   │   ├── teachers.js       # Rute manajemen data guru & wali kelas binaan
│   │   └── whatsapp.js       # Rute monitoring & kontrol sesi WhatsApp
│   ├── services/
│   │   ├── idcard.js         # Generator QR Code presisi tinggi kartu CR80
│   │   ├── queue.js          # Worker antrean pengiriman WhatsApp anti-banned
│   │   └── whatsapp.js       # Core handler koneksi Baileys & auto-reply 'YA'
│   ├── views/
│   │   ├── dashboard/        # Template tampilan modul dashboard (EJS)
│   │   ├── kiosk.ejs         # Template tampilan Kiosk scanner layar gerbang
│   │   ├── landing.ejs       # Template website profil sekolah & cek mandiri
│   │   └── login.ejs         # Template formulir login
│   └── server.js             # Titik masuk utama aplikasi Express.js
├── env-example.txt           # Template variabel konfigurasi environment
├── .env                      # File konfigurasi aktif (disalin dari env-example.txt)
├── ecosystem.config.js       # Konfigurasi proses background PM2
├── package.json              # Definisi dependensi & skrip npm
└── README.md                 # Dokumentasi panduan proyek
```

---

## 👨‍💻 Pengembang & Dukungan

Aplikasi ini dikembangkan dan dipelihara secara aktif oleh:

* **Pengembang**: **ALIJAYA-NET**
* **WhatsApp**: [**+62 819-4721-5703**](https://wa.me/6281947215703) (`081947215703`)
* **GitHub**: [@alijayanet](https://github.com/alijayanet)
* **Repository**: [alijayanet/website-absen-sekolah](https://github.com/alijayanet/website-absen-sekolah)

Jika Anda membutuhkan:
- Bantuan instalasi dan konfigurasi server sekolah (VPS / Local Server LAN).
- Kustomisasi fitur presensi, format laporan dinas, atau integrasi RFID khusus.
- Pengadaan kartu RFID PVC cetak standar CR80 atau mesin pembaca scanner.

Silakan hubungi langsung melalui kontak WhatsApp resmi di atas.

---

## 📄 Lisensi

Proyek ini dirilis di bawah lisensi **MIT License** - Anda bebas menggunakan, memodifikasi, dan mengembangkan perangkat lunak ini untuk keperluan institusi pendidikan.

---

<p align="center">
  Dibuat dengan dedikasi untuk kemajuan digitalisasi pendidikan Indonesia &bull; <strong>ALIJAYA-NET</strong>
</p>
