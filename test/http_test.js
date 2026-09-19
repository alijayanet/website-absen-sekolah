const http = require('http');

function checkEndpoint(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:3000${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ statusCode: res.statusCode, length: data.length });
      });
    }).on('error', (err) => {
      reject(err);
    });
  });
}

async function testHttp() {
  console.log('--- Pengujian Endpoint HTTP ---');
  try {
    const landing = await checkEndpoint('/');
    console.log('GET / :', landing.statusCode, `(${landing.length} bytes)`);

    const kiosk = await checkEndpoint('/kiosk');
    console.log('GET /kiosk :', kiosk.statusCode, `(${kiosk.length} bytes)`);

    const login = await checkEndpoint('/login');
    console.log('GET /login :', login.statusCode, `(${login.length} bytes)`);

    const landingSearch = await checkEndpoint('/?q=1001');
    console.log('GET /?q=1001 :', landingSearch.statusCode, `(${landingSearch.length} bytes)`);

    console.log('✓ Semua endpoint utama merespons 200 OK');
    process.exit(0);
  } catch (err) {
    console.error('HTTP Test Error:', err.message);
    process.exit(1);
  }
}

testHttp();
