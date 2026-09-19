const http = require('http');

function postScan(code) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ code });
    const req = http.request({
      hostname: 'localhost',
      port: 3000,
      path: '/api/attendance/scan',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, body: JSON.parse(data) });
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function testScan() {
  console.log('--- Pengujian API Scan Presensi (RFID / QR) ---');

  // Test 1: Scan Siswa 1002
  const scan1 = await postScan('1002');
  console.log('Scan 1002:', scan1.body);

  // Test 2: Scan Siswa yang sama lagi (Harus terdeteksi sudah absen)
  const scan2 = await postScan('1002');
  console.log('Scan Duplikat 1002:', scan2.body);

  // Test 3: Scan Kartu Tidak Terdaftar
  const scan3 = await postScan('KARTU_PALSU_999');
  console.log('Scan Tidak Terdaftar:', scan3.body);

  process.exit(0);
}

testScan().catch(err => {
  console.error(err);
  process.exit(1);
});
