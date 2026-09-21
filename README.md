# Sistem Manajemen Sekolah Modern & Presensi Terpadu

[![GitHub Repository](https://img.shields.io/badge/GitHub-alijayanet%2Fwebsite--absen--sekolah-181717?style=for-the-badge&logo=github)](https://github.com/alijayanet/website-absen-sekolah)
[![Node.js](https://img.shields.io/badge/Node.js-v18%20%7C%20v20+-339933?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-v4.21-000000?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![SQLite WAL](https://img.shields.io/badge/SQLite-WAL%20Mode-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://www.sqlite.org/)
[![WhatsApp Baileys](https://img.shields.io/badge/WhatsApp-Baileys%20v6-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)](https://github.com/WhiskeySockets/Baileys)
[![QRIS Dynamic](https://img.shields.io/badge/QRIS-EMVCo%20TLV%20Dynamic-E11D48?style=for-the-badge&logo=codeforces&logoColor=white)](#5-inovasi-qris-statis-ke-dinamis-emvco--webhook-otomatis)
[![Developer](https://img.shields.io/badge/Pengembang-ALIJAYA--NET-0284c7?style=for-the-badge&logo=codeforces&logoColor=white)](#-pengembang--dukungan-resmi)
[![WhatsApp Support](https://img.shields.io/badge/WhatsApp-081947215703-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)](https://wa.me/6281947215703)

Sistem Informasi Manajemen Sekolah Modern (*All-in-One School Management System*) yang menggabungkan **Presensi Digital IoT (RFID & Barcode/QR Code)**, **Administrasi Keuangan SPP & Generator QRIS Dinamis Otomatis**, **Buku Tabungan Siswa Digital Berbasis Rombel Kelas**, **Website Profil Sekolah Lengkap dengan CMS & Cek Kehadiran Mandiri**, serta **WhatsApp Gateway Interaktif 2-Arah**.

---

## 📑 Daftar Isi

- [Keunggulan Sistem](#-keunggulan-sistem)
- [Modul & Keterangan Fitur Lengkap](#-modul--keterangan-fitur-lengkap)
  - [1. Layar Kiosk Scanner Gerbang Sekolah (`/kiosk`)](#1-layar-kiosk-scanner-gerbang-sekolah-kiosk)
  - [2. Website Profil Sekolah & Cek Mandiri Wali Murid (`/`)](#2-website-profil-sekolah--cek-mandiri-wali-murid-)
  - [3. Pengajuan Izin & Sakit Mandiri Online](#3-pengajuan-izin--sakit-mandiri-online)
  - [4. Modul Keuangan Sekolah & Manajemen Tagihan SPP](#4-modul-keuangan-sekolah--manajemen-tagihan-spp)
  - [5. Inovasi QRIS Statis-ke-Dinamis EMVCo & Webhook Otomatis](#5-inovasi-qris-statis-ke-dinamis-emvco--webhook-otomatis)
  - [6. Modul Tabungan Siswa Digital (Wewenang Guru / Wali Kelas)](#6-modul-tabungan-siswa-digital-wewenang-guru--wali-kelas)
  - [7. WhatsApp Gateway Baileys & Onboarding 2-Arah](#7-whatsapp-gateway-baileys--onboarding-2-arah-anti-banned)
  - [8. Panduan Perintah Interaktif WhatsApp Bot (Orang Tua & Guru)](#8-panduan-perintah-interaktif-whatsapp-bot)
  - [9. Generator & Cetak Kartu Pelajar Standar CR80](#9-generator--cetak-kartu-pelajar-standar-cr80)
  - [10. Manajemen Akademik & Rekapitulasi Excel](#10-manajemen-akademik--rekapitulasi-excel)
- [File Presentasi PPT Sistem](#-file-presentasi-ppt-sistem)
- [Prasyarat Sistem (Prerequisites)](#-prasyarat-sistem-prerequisites)
- [Langkah-Langkah Instalasi](#-langkah-langkah-instalasi)
- [Panduan Menghubungkan WhatsApp](#-panduan-menghubungkan-whatsapp)
- [Panduan Setup QRIS Dinamis & Webhook Bank](#-panduan-setup-qris-dinamis--webhook-bank)
- [Akun Pengguna Bawaan (Default Credentials)](#-akun-pengguna-bawaan-default-credentials)
- [Akses Cepat URL Sistem](#-akses-cepat-url-sistem)
- [Struktur Direktori Proyek](#-struktur-direktori-proyek)
- [Pengembang & Dukungan Resmi](#-pengembang--dukungan-resmi)
- [Lisensi](#-lisensi)

---

## 🌟 Keunggulan Sistem

- **Presensi Gerbang Single Tap In**: Siswa cukup tap satu kali di pagi hari tanpa harus memilih opsi masuk/pulang, mengeliminasi antrean panjang di gerbang sekolah.
- **Kiosk Ramah Smartphone & Tablet**: Responsif di semua browser, mendukung rotasi kamera depan/belakang, pemilihan lensa, serta tombol *Ambil Foto QR Bawaan HP* (`capture="environment"`) yang bekerja 100% di semua ponsel.
- **QRIS Dinamis Otomatis EMVCo TLV**: Mengubah QRIS statis dari Bank/E-Wallet apa saja menjadi QRIS Dinamis ber-nominal tepat dan kode unik anti-bentrok. Orang tua tidak perlu input nominal manual!
- **Verifikasi Pelunasan 0 Detik**: Webhook notifikasi bank otomatis mencocokkan transfer masuk, melunasi tagihan, menerbitkan kuitansi, dan mengabari orang tua seketika.
- **Tabungan Siswa Akuntabel**: Dipegang langsung oleh Guru / Wali Kelas pengampu rombel. Admin hanya memantau total dana sekolah tanpa tombol setor/tarik guna mencegah tumpang-tindih wewenang.
- **WhatsApp Onboarding Anti-Banned**: Melindungi nomor WhatsApp sekolah dari banned/spam dengan protokol verifikasi simpan kontak dua arah dan antrean pesan terjeda 1.5–3 detik.
- **Audio Synthesizer Mandiri**: Efek suara nada masuk (chime merdu), nada telat (warning), dan kartu salah (buzz) menggunakan Web Audio API murni tanpa beban download file audio eksternal.
- **Zero Heavy Database**: Berjalan di atas SQLite dengan mode **WAL (Write-Ahead Logging)** yang super cepat, tahan crash, ringan, dan portabel tanpa perlu konfigurasi MySQL atau PostgreSQL.

---

## 🚀 Modul & Keterangan Fitur Lengkap

### 1. Layar Kiosk Scanner Gerbang Sekolah (`/kiosk`)
* **Dual Method Input**:
  * **RFID USB Reader**: Listener otomatis keyboard wedge menangkap nomor kartu RFID tanpa perlu mengeklik form input secara manual.
  * **Kamera QR Code**: Memindai QR Code kartu pelajar melalui kamera webcam laptop maupun kamera smartphone secara live.
* **Fitur Ramah Ponsel (Mobile-Friendly Kiosk)**:
  * Tombol balik kamera (**Depan / Belakang**) untuk kenyamanan memindai lewat smartphone.
  * Selector pemilihan lensa kamera jika perangkat memiliki lebih dari 1 kamera.
  * **Tombol Buka Kamera HP (Ambil Foto QR)**: Menggunakan dialog kamera native ponsel (`capture="environment"`) yang bekerja 100% di semua browser mobile.
* **Logika Kehadiran Cerdas**:
  * Menghitung status `HADIR` tepat waktu (sebelum jam masuk) atau `TERLAMBAT` (dengan penghitungan rincian menit keterlambatan).
  * **Anti-Double Scan**: Mencegah siswa melakukan tap lebih dari 1 kali di hari yang sama.
* **Audio FX Synthesizer**: Suara chime merdu saat hadir, nada peringatan saat telat, dan nada buzz saat kartu tidak dikenali.
* **Popup Real-Time Siswa**: Animasi modal otomatis memunculkan foto siswa, nama, kelas, jam masuk, dan badge warna status sebelum tertutup otomatis setelah 3.5 detik.

---

### 2. Website Profil Sekolah & Cek Mandiri Wali Murid (`/`)
* **Beranda Informatif & Modern**:
  * Top bar informasi jam operasional, akreditasi, email, dan telepon resmi.
  * Hero banner kampus interaktif dengan galeri visual transparan profesional.
  * Sambutan Kepala Sekolah beserta foto resmi pimpinan dan visi-misi pendidikan.
  * Fasilitas & Program Unggulan: Lab Komputer, Perpustakaan, Ekstrakurikuler Robotika.
  * Papan pengumuman resmi dan agenda kegiatan akademik terintegrasi CMS.
  * Galeri foto dokumentasi kegiatan dan prestasi siswa.
* **Cek Kehadiran Mandiri Siswa (`#cek-kehadiran`)**:
  * Wali murid cukup memasukkan **NIS** atau **NISN** di halaman beranda.
  * **✨ Kartu Profil & Saldo Tabungan**: Menampilkan foto, nama, NIS, kelas, nama Wali Kelas, serta **kotak highlight saldo tabungan siswa terkini**.
  * **Statistik Bulanan**: Total Hadir, Terlambat, Izin, Sakit, Alpa, dan Persentase kehadiran.
  * **Kalender Presensi Interaktif**: Riwayat kehadiran harian siswa dalam sebulan.
  * **Tombol Pengajuan Izin/Sakit**: Akses cepat untuk mengunggah surat izin atau sakit online.

---

### 3. Pengajuan Izin & Sakit Mandiri Online
* **Formulir Mandiri Berbasis Web**:
  * Dapat diakses langsung oleh wali murid melalui website sekolah tanpa perlu membuat akun login.
  * Mendukung pilihan kategori: **Izin** (keperluan keluarga/dinas) atau **Sakit**.
  * Rentang tanggal fleksibel (1 hari atau beberapa hari berturut-turut).
  * Upload foto surat dokter atau surat keterangan orang tua (JPG/PNG).
* **Verifikasi Keamanan 4 Digit WhatsApp**:
  * Orang tua wajib memasukkan 4 digit terakhir nomor WhatsApp yang terdaftar di database siswa untuk memvalidasi keaslian pengaju.
* **Alur Persetujuan Wali Kelas**:
  * Pengajuan masuk ke antrean verifikasi Wali Kelas di Dashboard.
  * Wali Kelas memeriksa alasan dan foto surat dokter, lalu mengeklik tombol **Setujui** atau **Tolak**.
  * Begitu disetujui, kehadiran siswa otomatis tercatat sebagai `IZIN` atau `SAKIT` pada kalender presensi, dan notifikasi persetujuan dikirimkan langsung ke WhatsApp orang tua.

---

### 4. Modul Keuangan Sekolah & Manajemen Tagihan SPP
* **CRUD Kategori Biaya Tagihan (`/dashboard/finance/bills`)**:
  * Bebas menambah, mengedit, dan menghapus kategori tarif pembayaran.
  * Pilihan tipe periode: **Bulanan** (SPP), **Mingguan** (Uang Kas/Infaq), **Sekali Bayar** (Uang Gedung/Seragam/Daftar Ulang), atau **Kustom** (Ujian/Kegiatan).
  * Menentukan nominal tarif default dan deskripsi per kategori.
* **Penerbitan Tagihan Massal & Perorangan**:
  * **Generate Tagihan Massal**: Terbitkan tagihan SPP bulanan ke seluruh siswa sekolah atau per rombel kelas hanya dengan 1 kali klik.
  * **Tagihan Satuan**: Terbitkan tagihan khusus perorangan dengan nominal dan tanggal jatuh tempo kustom.
* **Filter & Audit Trail Tagihan**:
  * Filter multi-kriteria: Status (UNPAID, PAID, CANCELLED), Kelas, Kategori Biaya, Periode Bulan, dan kata kunci pencarian.
  * Fitur batalkan (*cancel*) dan revisi tagihan yang belum lunas.
* **Kasir Pembayaran Tunai di TU**:
  * Petugas TU dapat melayani pembayaran tunai di kasir sekolah secara cepat.
  * Sistem otomatis menerbitkan kuitansi pelunasan dan mengirimkan notifikasi kuitansi ke WhatsApp orang tua.
* **Cetak Kuitansi Resmi Standar Instansi**:
  * Tombol cetak kuitansi siap simpan PDF atau cetak printer kasir lengkap dengan kop resmi sekolah, nomor kuitansi unik, watermark *LUNAS*, rincian nominal biaya, kode unik, dan tanda tangan kasir TU.

---

### 5. Inovasi QRIS Statis-ke-Dinamis EMVCo & Webhook Otomatis
* **Algoritma Generator QRIS EMVCo TLV (`src/utils/qrisUtil.js`)**:
  * Mengonversi string QRIS statis merchant Bank/E-Wallet (BCA, Mandiri, BRI, BNI, Dana, Gopay, Ovo, ShopeePay) menjadi QRIS Dinamis standar *EMVCo Merchant-Presented Mode*.
  * Mengubah Tag 01 dari `'11'` (Statis) menjadi `'12'` (Dinamis).
  * Menyisipkan Tag 54 (*Transaction Amount*) dengan nilai nominal tagihan yang tepat.
  * Menghitung ulang Checksum CRC16 CCITT False (`0x1021`, init `0xFFFF`).
  * Menghasilkan barcode QRIS dalam bentuk **Data URL** (web modal) dan **PNG Buffer** (dikirim via WhatsApp).
* **Fitur Auto-Decode Unggah Foto QRIS Sekolah (`/dashboard/finance/qris`)**:
  * Admin cukup mengunggah foto atau screenshot gambar barcode QRIS sekolah.
  * Library `jsQR` di sisi browser otomatis membaca payload string EMVCo dan nama merchant sekolah seketika tanpa perlu mengetik manual.
* **Kode Unik Anti-Bentrok (`generateUniqueAmount`)**:
  * Menambahkan kode 3-digit acak (100–998) pada setiap tagihan yang dijamin tidak kembar dengan tagihan `UNPAID` lainnya.
* **Webhook Notifikasi Bank Otomatis (`/api/webhook/payment-notif`)**:
  * Menangkap notifikasi uang masuk dari SMS/Push Notification m-Banking di HP sekolah menggunakan aplikasi **MacroDroid**.
  * Regex multi-pola cerdas mengekstrak nominal rupiah dari teks notifikasi transfer bank secara otomatis.
  * Mencocokkan `total_amount` dengan tagihan `UNPAID`, mengubah status menjadi `PAID`, mencatat kuitansi resmi, dan mengirimkan notifikasi pelunasan ke nomor WhatsApp orang tua dalam hitungan detik.

---

### 6. Modul Tabungan Siswa Digital (Wewenang Guru / Wali Kelas)
* **Wewenang Eksklusif Guru / Wali Kelas (`/dashboard/savings`)**:
  * Pengelolaan uang fisik tabungan siswa (setoran dan penarikan) adalah tanggung jawab dan wewenang penuh Guru / Wali Kelas binaan.
  * **Proteksi Akses Admin**: Pada menu Tabungan Admin, tombol `+ Setor Tabungan` dan `- Tarik Saldo` dihilangkan. Admin hanya dapat melihat ringkasan total saldo per rombel dan grand total dana sekolah.
  * Endpoint backend memproteksi proses setor/tarik hanya dapat dieksekusi oleh akun dengan role `guru`.
* **Ikon Koin Emas Islami & Edukatif (`coins`)**:
  * Menggunakan ikon tumpukan koin emas (`coins`) pada sidebar dan header yang mencerminkan budaya hemat dan investasi masa depan.
* **Pencatatan Setoran & Penarikan via Web**:
  * Modal setor cepat dengan opsi nominal instan (Rp 5.000, Rp 10.000, Rp 20.000, Rp 50.000, Rp 100.000) atau nominal bebas beserta catatan keperluan.
  * Modal penarikan dilengkapi validasi saldo: sistem menolak penarikan jika melebihi saldo tabungan siswa.
* **Pencatatan Cepat Langsung via WhatsApp Bot**:
  * Guru dapat mencatat setoran cukup dengan mengetik pesan WhatsApp:
    > `SETOR Ahmad 20rb Uang saku jumat`
  * Guru dapat mencatat penarikan via WhatsApp:
    > `TARIK Ahmad 10000 Keperluan buku gambar`
* **Notifikasi Real-Time ke Orang Tua**:
  * Setiap kali ada transaksi setoran atau penarikan, sistem otomatis mengirimkan notifikasi WhatsApp ke wali murid berisi jumlah setoran, sisa saldo terkini, dan nama guru penanggung jawab.

---

### 7. WhatsApp Gateway Baileys & Onboarding 2-Arah (Anti-Banned)
* **Onboarding 2-Arah (Simpan Kontak & Balas 'YA')**:
  * Mencegah nomor bot sekolah diblokir oleh sistem anti-spam WhatsApp dengan mewajibkan interaksi awal dua arah.
  * Sekolah mengirimkan pesan perkenalan resmi -> orang tua membalas kata **"YA"** -> bot memverifikasi nomor orang tua secara otomatis.
* **Worker Antrean Pesan SQLite Terjeda (`src/services/queue.js`)**:
  * Pesan presensi, kuitansi, dan tabungan tidak ditembakkan secara serentak, melainkan dikirim satu per satu dengan jeda acak **1.5 hingga 3 detik** per pesan.
* **Manajemen Sesi Baileys di Dashboard (`/dashboard/whatsapp`)**:
  * QR Code pairing WhatsApp live refresh secara real-time.
  * Status koneksi (Terhubung / Menunggu Scan / Terputus).
  * Tombol kirim pesan uji coba (*Test Send*), restart koneksi, dan putus sesi.

---

### 8. Panduan Perintah Interaktif WhatsApp Bot

Layanan bot beroperasi otomatis 24 jam melayani pesan dari Orang Tua Murid maupun Dewan Guru:

#### 📌 A. Perintah Khusus Orang Tua Murid
| Perintah WA | Fungsi / Kegunaan | Contoh Respon Bot |
|---|---|---|
| `CEK` atau `PRESENSI` | Cek kehadiran ananda hari ini, persentase bulanan, dan 5 riwayat terakhir | Rekap status masuk, jam tiba, & histori kehadiran |
| `CEK 1` / `CEK 2` | Memilih anak tertentu jika nomor terdaftar memiliki >1 anak | Rekap presensi anak yang dipilih |
| `SPP` atau `TAGIHAN` | Cek daftar tagihan sekolah belum lunas & riwayat lunas | Rincian invoice, nominal, kode bayar, & jatuh tempo |
| `BAYAR <ID>` | **Meminta Barcode QRIS Dinamis Otomatis** | **Bot langsung mengirim GAMBAR QRIS ber-nominal tepat** |
| `TABUNGAN` | Cek buku tabungan digital ananda | Total saldo, rekap setor/tarik, 5 mutasi, & kontak guru |
| `JADWAL` | Info jam operasional sekolah & tata tertib gerbang | Jam masuk, toleransi gerbang, & hari aktif |
| `WALI` | Menampilkan nama & nomor WhatsApp Wali Kelas ananda | Nama guru & tautan langsung `wa.me/nomor` |
| `IZIN` | Panduan pengajuan izin & sakit online via website | Alur pengajuan surat online & link web |
| `INFO` | Profil resmi, akreditasi, alamat, email, & telepon | Kontak dan profil sekolah |
| `MENU` | Menampilkan seluruh daftar menu bantuan | Ringkasan perintah interaktif |

#### 📌 B. Perintah Khusus Guru / Wali Kelas
| Perintah WA | Fungsi / Kegunaan | Contoh Format Ketikan |
|---|---|---|
| `TABUNGAN` / `TOTAL TABUNGAN` | **Cek Rekapitulasi Total Saldo Kelas Anda** | Cukup ketik: `TOTAL TABUNGAN` atau `TABUNGAN` |
| `TABUNGAN <NAMA>` | Cek buku tabungan murid tertentu di kelasnya | `TABUNGAN Ahmad` atau `TABUNGAN Siti` |
| `TABUNGAN <NIS>` | Cek buku tabungan murid berdasarkan nomor NIS | `TABUNGAN 1001` |
| `SETOR <NAMA/NIS> <JUMLAH>` | **Tambah setoran tabungan siswa langsung dari WA** | `SETOR Ahmad 20rb Uang kas jumat` |
| `TARIK <NAMA/NIS> <JUMLAH>` | **Catat penarikan tabungan siswa dari WA** | `TARIK Ahmad 10000 Keperluan fotokopi` |
| `REKAP` atau `URUTAN` | Rekapitulasi urutan kronologis presensi kelas hari ini | Cukup ketik: `REKAP` |
| `BELUM` atau `ALPA` | Daftar siswa kelas yang belum tap presensi hari ini + no WA ortu | Cukup ketik: `BELUM` |

---

### 9. Generator & Cetak Kartu Pelajar Standar CR80
* **Dimensi Standar Internasional CR80**: Ukuran **85.60 mm × 53.98 mm** dengan radius sudut melengkung 3.5 mm (presisi untuk mesin cetak ID Card PVC maupun kertas stiker A4).
* **Layout Kartu Elegan**: Memuat logo sekolah, pasfoto siswa, nama, NIS, NISN, kelas, dan QR Code tajam siap scan.
* **Opsi Pencetakan Fleksibel**:
  * Cetak Satuan (`/dashboard/students/:id/card`).
  * Cetak Berdasarkan Pilihan Checkbox (*Floating Action Bar*).
  * Cetak Seluruh Siswa Sekolah.
  * Cetak Massal Per Rombel Kelas (`/dashboard/classes/:id/cards`).

---

### 10. Manajemen Akademik & Rekapitulasi Excel
* **Role-Based Access Control (RBAC)**:
  * **Administrator**: Kendali penuh seluruh modul, akun pengguna, CMS, pengaturan jam, QRIS, dan rekap total sekolah.
  * **Guru / Wali Kelas**: Kendali presensi rombel, verifikasi izin/sakit siswa, dan pengelolaan tabungan siswa rombel.
* **Import & Export Excel (`.xlsx`)**:
  * Impor data siswa massal dari format template Excel.
  * Ekspor rekapitulasi kehadiran bulanan ke file Microsoft Excel lengkap dengan filter kelas dan tanggal.
* **Kalender Akademik & Hari Libur**: Pengaturan hari libur nasional atau cuti bersama sekolah agar presensi tidak dihitung alpa pada tanggal merah.

---

## 📊 File Presentasi PPT Sistem

Telah disediakan file presentasi resmi dalam format **Microsoft PowerPoint Widescreen 16:9 (`.pptx`)** yang mencakup seluruh fitur, arsitektur, dan cara penggunaan sistem:

* **Nama File**: [`Presentasi_Fitur_Sistem_Sekolah.pptx`](file:///d:/absensi-sekoah/Presentasi_Fitur_Sistem_Sekolah.pptx)
* **Ukuran File**: ~55 KB (13 Slide Presentasi Profesional)
* **Daftar Slide**:
  1. *Cover Slide*: Sistem Informasi Sekolah Modern Terintegrasi.
  2. *Executive Summary*: Arsitektur Sistem & Zero Heavy Database (Node.js + SQLite WAL).
  3. *Modul Presensi*: Kiosk Gerbang, Dual Scanner RFID/QR, Audio FX, & Notifikasi Real-Time.
  4. *Portal Profil Sekolah*: CMS Website & Cek Kehadiran Mandiri Siswa Berisi Saldo Tabungan.
  5. *Layanan Izin/Sakit*: Formulir Digital Online & Verifikasi 4 Digit WA.
  6. *Keuangan SPP*: CRUD Kategori Tagihan, Tagihan Massal, Kasir TU, & Cetak Kuitansi Resmi.
  7. *Inovasi QRIS Dinamis*: Algoritma EMVCo TLV, Kode Unik Anti-Bentrok, & Webhook MacroDroid.
  8. *Tabungan Siswa Digital*: Wewenang Penuh Guru Rombel & Setor/Tarik via Web & WhatsApp.
  9. *WhatsApp Bot Orang Tua*: Panduan Perintah CEK, SPP, BAYAR (Kirim QRIS), TABUNGAN, dll.
  10. *WhatsApp Bot Guru*: Panduan Perintah REKAP, BELUM, TOTAL TABUNGAN, SETOR, & TARIK.
  11. *Matriks Hak Akses (RBAC)*: Pembagian Wewenang Admin, Guru, Kasir TU, & Orang Tua.
  12. *Standar Operasional Prosedur (SOP)*: Alur Penggunaan Harian Pagi, Siang, dan Sore.
  13. *Penutup & Kontak Dukungan*: Nilai Tambah, Kontak Pengembang ALIJAYA-NET, & Lisensi MIT.

> [!TIP]
> File presentasi dapat langsung dibuka dan dipresentasikan menggunakan **Microsoft PowerPoint**, **Google Slides**, **LibreOffice Impress**, atau **WPS Office**.

---

## 💻 Prasyarat Sistem (Prerequisites)

Sebelum melakukan instalasi, pastikan perangkat komputer/server Anda memenuhi syarat berikut:
1. **Node.js**: Versi **18.x** atau **20.x LTS** ([Unduh Node.js](https://nodejs.org/)).
2. **NPM**: Versi **9.x** atau lebih baru (otomatis terpasang bersama Node.js).
3. **Perangkat Scanner (Opsional)**:
   - Barcode Scanner / Kamera Laptop / Kamera HP.
   - Reader RFID USB (13.56 MHz Mifare atau 125 kHz EM) tipe *Plug-and-Play USB Keyboard Wedge*.

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
Salin file template konfigurasi:
* **Windows**:
  ```cmd
  copy env-example.txt .env
  ```
* **Linux / macOS**:
  ```bash
  cp env-example.txt .env
  ```

### 4. Inisialisasi Database & Seeding Data Awal
Jalankan skrip berikut untuk membuat struktur database SQLite WAL dan memasukkan data demo awal:
```bash
npm run seed
```

### 5. Menjalankan Server Aplikasi
* **Mode Foreground**:
  ```bash
  npm start
  ```
* **Mode Pengembangan (Auto-Reload)**:
  ```bash
  npm run dev
  ```

#### 🚀 Mode Background / Daemon dengan PM2 (Rekomendasi Server Produksi)
Agar server tetap berjalan di latar belakang meskipun terminal ditutup:
```bash
# Install PM2 jika belum ada
npm install -g pm2

# Jalankan aplikasi di background
npm run pm2:start

# Perintah manajemen PM2:
npm run pm2:status    # Cek status server & RAM
npm run pm2:logs      # Cek log aplikasi & WhatsApp
npm run pm2:restart   # Restart server
npm run pm2:stop      # Hentikan server
```

Aplikasi siap diakses melalui browser di:
👉 **`http://localhost:3000`**

---

## 📱 Panduan Menghubungkan WhatsApp

1. Buka browser dan login ke Dashboard Admin di `http://localhost:3000/login`.
2. Klik menu **WhatsApp Baileys** pada menu samping (*sidebar*).
3. Tunggu 3–5 detik hingga **QR Code WhatsApp** muncul di layar.
4. Buka aplikasi **WhatsApp** di smartphone Anda:
   - Buka menu titik tiga (Android) atau Pengaturan (iOS).
   - Pilih **Perangkat Tertaut** (*Linked Devices*) -> **Tautkan Perangkat**.
   - Arahkan kamera ke QR Code di layar monitor.
5. Status akan berubah menjadi **"WhatsApp Terhubung"**.
6. Gunakan tombol **Kirim Pesan Uji Coba** untuk menguji pengiriman pesan.

---

## 💳 Panduan Setup QRIS Dinamis & Webhook Bank

1. Buka menu **Pengaturan QRIS** di `/dashboard/finance/qris`.
2. **Unggah Foto QRIS**: Unggah file foto QRIS statis toko/sekolah Anda. Sistem akan otomatis mendeteksi kode EMVCo dan nama merchant.
3. Masukkan **Webhook Secret Key** untuk keamanan endpoint notifikasi.
4. Di smartphone kasir/sekolah yang menerima SMS/notifikasi push m-Banking:
   - Pasang aplikasi **MacroDroid** dari Google Play Store.
   - Buat Macro:
     - **Trigger**: *Notification Received* (Pilih aplikasi m-Banking Anda, misal BCA mobile / BRImo / Mandiri Livin / Dana).
     - **Action**: *HTTP Request* -> Pilih Method **POST**.
     - **URL**: `http://<IP_SERVER_ANDA>:3000/api/webhook/payment-notif`
     - **Body Type**: JSON
     - **Request Body**:
       ```json
       {
         "secret_key": "YOUR_SECRET_KEY_HERE",
         "message": "[notif_title] [notif_text]",
         "sender": "[notif_app_name]"
       }
       ```
5. Begitu wali murid melakukan pembayaran transfer QRIS, sistem otomatis memverifikasi tagihan dan mengirimkan kuitansi pelunasan dalam hitungan detik!

---

## 🔐 Akun Pengguna Bawaan (Default Credentials)

Setelah menjalankan `npm run seed`, gunakan akun demo berikut untuk masuk ke sistem:

| Peran (Role) | Username | Password | Ruang Lingkup Wewenang |
|---|---|---|---|
| **Administrator** | `admin` | `admin123` | Akses penuh sistem, CMS, Keuangan SPP, QRIS, Akun, dan Rekap Total Sekolah |
| **Guru / Wali Kelas** | `guru_ipa1` | `guru123` | Monitoring kehadiran kelas X IPA 1, approve Izin/Sakit, & pegang kas Tabungan Rombel |

*(Kredensial dan kata sandi dapat diubah kapan saja di menu Manajemen Pengguna).*

---

## 🌐 Akses Cepat URL Sistem

| Modul Layanan | URL Akses | Keterangan |
|---|---|---|
| **Website Profil Sekolah** | `http://localhost:3000/` | Beranda, profil, agenda, galeri, dan cek mandiri kehadiran & tabungan siswa |
| **Layar Kiosk Gerbang** | `http://localhost:3000/kiosk` | Layar presensi mandiri RFID & QR Code siswa di pintu masuk gerbang |
| **Login Petugas / Guru** | `http://localhost:3000/login` | Portal masuk otentikasi Admin dan Dewan Guru |
| **Dashboard Utama** | `http://localhost:3000/dashboard` | Statistik kehadiran real-time hari ini dan grafik keaktifan |
| **Manajemen Tagihan SPP** | `http://localhost:3000/dashboard/finance/bills` | CRUD kategori biaya, terbitkan SPP massal, kasir TU, & cetak kuitansi |
| **Pengaturan QRIS & Webhook**| `http://localhost:3000/dashboard/finance/qris` | Upload QRIS statis, auto-decode EMVCo, tester dinamis, & panduan webhook |
| **Buku Tabungan Siswa** | `http://localhost:3000/dashboard/savings` | Pengelolaan tabungan rombel (Guru: Setor/Tarik, Admin: Rekap Total) |
| **WhatsApp Gateway** | `http://localhost:3000/dashboard/whatsapp` | Hubungkan nomor WA bot, monitor status koneksi, & kirim pesan uji coba |
| **CMS Profil Sekolah** | `http://localhost:3000/dashboard/cms` | Pengaturan jam sekolah, banner hero, sambutan kepsek, & galeri foto |

---

## 📁 Struktur Direktori Proyek

```plaintext
website-absen-sekolah/
├── data/
│   ├── absensi.db                 # Database SQLite (Mode WAL aktif)
│   ├── auth_baileys/              # Sesi autentikasi multi-file Baileys WhatsApp
│   └── uploads/                   # Folder penyimpanan aset & foto terunggah
│       ├── banners/               # Foto banner hero sekolah
│       ├── gallery/               # Foto dokumentasi kegiatan & fasilitas
│       ├── leaves/                # Foto bukti surat dokter izin sakit siswa
│       ├── logos/                 # Logo resmi sekolah
│       ├── photos/                # Pasfoto kepala sekolah
│       ├── qris/                  # File gambar barcode QRIS statis sekolah
│       └── students/              # Pasfoto siswa
├── scripts/
│   └── generate_presentation.py   # Generator otomatis file presentasi PowerPoint (.pptx)
├── src/
│   ├── database/
│   │   ├── db.js                  # Koneksi SQLite & inisialisasi WAL Mode
│   │   ├── schema.sql             # Skema tabel lengkap (Siswa, SPP, Tabungan, dll)
│   │   └── seed.js                # Skrip pembuat data demo awal
│   ├── middleware/
│   │   └── auth.js                # Otentikasi sesi login & kontrol hak akses (RBAC)
│   ├── routes/
│   │   ├── api/
│   │   │   └── paymentNotif.js    # Webhook API notifikasi pembayaran bank otomatis
│   │   ├── attendances.js         # Laporan presensi & kalender akademik
│   │   ├── auth.js                # Rute otentikasi login & logout
│   │   ├── classes.js             # Kelola kelas rombel & cetak kartu kelas
│   │   ├── cms.js                 # Kelola konten web profil & jam operasional
│   │   ├── dashboard.js           # Halaman ringkasan eksekutif
│   │   ├── finance.js             # Modul keuangan SPP, tagihan, kasir TU, & QRIS
│   │   ├── holidays.js            # Kelola tanggal merah & cuti bersama
│   │   ├── idcard.js              # Rendering kartu pelajar CR80
│   │   ├── kiosk.js               # Layar kiosk gerbang & API scan presensi
│   │   ├── landing.js             # Halaman beranda, pencarian mandiri, & form izin
│   │   ├── leaves.js              # Kelola verifikasi permohonan izin & sakit
│   │   ├── savings.js             # Modul buku tabungan siswa & mutasi saldo
│   │   ├── students.js            # CRUD siswa, impor Excel, & onboarding WA
│   │   ├── teachers.js            # Manajemen akun guru & wali kelas
│   │   └── whatsapp.js            # Monitoring sesi Baileys WhatsApp
│   ├── services/
│   │   ├── bot.js                 # Layanan WhatsApp Bot interaktif 2-arah
│   │   ├── idcard.js              # Generator QR Code presisi tinggi kartu CR80
│   │   ├── queue.js               # Worker antrean pesan WhatsApp anti-banned
│   │   ├── savingsService.js      # Logika transaksi tabungan, setor, tarik, & mutasi
│   │   └── whatsapp.js            # Core koneksi Baileys, kirim teks & gambar QRIS
│   ├── utils/
│   │   └── qrisUtil.js            # Engine QRIS Statis-ke-Dinamis EMVCo TLV & CRC16
│   ├── views/
│   │   ├── dashboard/             # Template antarmuka pengguna dashboard (EJS)
│   │   │   ├── finance/           # Halaman SPP, tagihan kasir, & kuitansi
│   │   │   ├── savings/           # Halaman buku tabungan siswa rombel
│   │   │   └── ...
│   │   ├── kiosk.ejs              # Template tampilan Kiosk scanner layar gerbang
│   │   ├── landing.ejs            # Template website profil sekolah & cek mandiri
│   │   └── login.ejs              # Formulir login sistem
│   └── server.js                  # Entry point utama aplikasi Express.js
├── test/                          # Kumpulan skrip pengujian integrasi & unit
├── Presentasi_Fitur_Sistem_Sekolah.pptx # File presentasi resmi sistem (13 slide PPTX)
├── env-example.txt                # Template konfigurasi environment
├── .env                           # File konfigurasi environment aktif
├── ecosystem.config.js            # Konfigurasi proses daemon PM2
├── package.json                   # Daftar dependensi & script npm
└── README.md                      # Dokumentasi komprehensif proyek
```

---

## 👨‍💻 Pengembang & Dukungan Resmi

Sistem ini dikembangkan dan dipelihara secara aktif oleh:

* **Pengembang**: **ALIJAYA-NET**
* **WhatsApp**: [**+62 819-4721-5703**](https://wa.me/6281947215703) (`081947215703`)
* **GitHub**: [@alijayanet](https://github.com/alijayanet)
* **Repository**: [alijayanet/website-absen-sekolah](https://github.com/alijayanet/website-absen-sekolah)


---

## 📄 Lisensi

Proyek ini dirilis di bawah lisensi **MIT License** - Anda memiliki kebebasan penuh untuk menggunakan, memodifikasi, dan mengembangkan sistem ini demi kemajuan digitalisasi pendidikan Indonesia.

---

<p align="center">
  Dibuat dengan dedikasi untuk kemajuan digitalisasi pendidikan Indonesia &bull; <strong>ALIJAYA-NET</strong>
</p>
