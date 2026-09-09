// Asthetic — helyi webkiszolgáló + a Kahoot-mód API-ja.
//
// A böngésző a kamerát és a Web Bluetooth-t csak "biztonságos kontextusban" engedi:
// ez a localhost vagy a HTTPS. Ezért nem elég a fájlt duplán kattintani, ezen a kis
// szerveren keresztül kell megnyitni.
//
// A Kahoot-mód viszont NEM használ kamerát és Bluetooth-t, ezért a telefonok a helyi
// hálózatról is csatlakozhatnak sima http-vel — emiatt kötünk 0.0.0.0-ra.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const kahoot = require('./kahoot-server.js');

const PORT = Number(process.argv[2]) || 4173;
const ROOT = __dirname;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

// ───────────────────────── segédfüggvények ─────────────────────────

function json(res, status, adat) {
  const szoveg = JSON.stringify(adat);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(szoveg);
}

function torzsetOlvas(req) {
  return new Promise((resolve, reject) => {
    let adat = '';
    let meret = 0;
    req.on('data', (c) => {
      meret += c.length;
      if (meret > 64 * 1024) { reject(new Error('Túl nagy kérés')); req.destroy(); return; }
      adat += c;
    });
    req.on('end', () => {
      if (!adat) return resolve({});
      try { resolve(JSON.parse(adat)); } catch { reject(new Error('Hibás JSON')); }
    });
    req.on('error', reject);
  });
}

function sendNotFound(res) {
  fs.readFile(path.join(ROOT, '404.html'), (err, page) => {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(err ? 'Nincs ilyen oldal' : page);
  });
}

function helyiCimek() {
  const cimek = [];
  for (const lista of Object.values(os.networkInterfaces())) {
    for (const i of lista || []) {
      if (i.family === 'IPv4' && !i.internal) cimek.push(i.address);
    }
  }
  return cimek;
}

// ───────────────────────── API ─────────────────────────

async function apiKezelo(req, res, url) {
  const ut = url.pathname.replace(/^\/api\//, '');

  // --- publikus szobák listája ---
  if (ut === 'szobak' && req.method === 'GET') {
    return json(res, 200, { szobak: kahoot.publikusSzobak() });
  }

  // --- valós idejű állapotcsatorna (SSE) ---
  if (ut === 'stream' && req.method === 'GET') {
    const kod = String(url.searchParams.get('kod') || '').toUpperCase();
    const jatekosId = url.searchParams.get('jatekos') || '';
    const szoba = kahoot.szobak.get(kod);
    if (!szoba) return json(res, 404, { hiba: 'Nincs ilyen szoba.' });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');

    const leiratkozas = kahoot.figyeloHozzaad(szoba, jatekosId, res);

    // Életben tartó jelzés, hogy a kapcsolat ne aludjon el
    const pulzus = setInterval(() => {
      try { res.write(': pulzus\n\n'); } catch { /* zárt kapcsolat */ }
    }, 20000);

    req.on('close', () => {
      clearInterval(pulzus);
      leiratkozas();
    });
    return undefined;
  }

  // innentől POST műveletek
  if (req.method !== 'POST') return json(res, 405, { hiba: 'Nem támogatott művelet.' });

  let torzs;
  try {
    torzs = await torzsetOlvas(req);
  } catch (e) {
    return json(res, 400, { hiba: e.message });
  }

  if (ut === 'szoba/letrehoz') {
    const { szoba, jatekosId } = kahoot.szobaLetrehoz(torzs.nev, torzs.beallitas);
    return json(res, 200, { kod: szoba.kod, jatekosId });
  }

  if (ut === 'szoba/csatlakoz') {
    const eredmeny = kahoot.szobaCsatlakozas(torzs.kod, torzs.nev);
    if (eredmeny.hiba) return json(res, 400, { hiba: eredmeny.hiba });
    return json(res, 200, { kod: eredmeny.szoba.kod, jatekosId: eredmeny.jatekosId });
  }

  // A további műveletekhez szoba + játékos kell
  const szoba = kahoot.szobak.get(String(torzs.kod || '').toUpperCase());
  if (!szoba) return json(res, 404, { hiba: 'Nincs ilyen szoba.' });
  const jatekos = szoba.jatekosok.get(torzs.jatekosId);
  if (!jatekos) return json(res, 403, { hiba: 'Nem vagy tagja ennek a szobának.' });

  if (ut === 'valasz') {
    const eredmeny = kahoot.valaszAd(szoba, torzs.jatekosId, torzs.valasz);
    return json(res, eredmeny.hiba ? 400 : 200, eredmeny.hiba ? { hiba: eredmeny.hiba } : { ok: true });
  }

  if (ut === 'kilep') {
    kahoot.jatekosKilep(szoba, torzs.jatekosId);
    return json(res, 200, { ok: true });
  }

  // Innentől csak a szobavezető
  if (!jatekos.host) return json(res, 403, { hiba: 'Ehhez szobavezetőnek kell lenned.' });

  if (ut === 'indit') {
    const eredmeny = kahoot.jatekIndit(szoba);
    return json(res, eredmeny.hiba ? 400 : 200, eredmeny.hiba ? { hiba: eredmeny.hiba } : { ok: true });
  }

  if (ut === 'kovetkezo') {
    kahoot.kovetkezoKor(szoba);
    return json(res, 200, { ok: true });
  }

  if (ut === 'kihagy') {
    const eredmeny = kahoot.dalKidob(szoba);
    return json(res, eredmeny.hiba ? 400 : 200, eredmeny.hiba ? { hiba: eredmeny.hiba } : { ok: true });
  }

  if (ut === 'kiertekel') {
    kahoot.korKiertekel(szoba);
    return json(res, 200, { ok: true });
  }

  return json(res, 404, { hiba: 'Ismeretlen művelet.' });
}

// ───────────────────────── kiszolgáló ─────────────────────────

const server = http.createServer((req, res) => {
  let url;
  try {
    url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  } catch {
    res.writeHead(400).end('Hibás kérés');
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    apiKezelo(req, res, url).catch((e) => {
      try { json(res, 500, { hiba: 'Szerverhiba: ' + e.message }); } catch { /* már elment a válasz */ }
    });
    return;
  }

  const relative = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).replace(/^\/+/, '');
  const filePath = path.join(ROOT, relative);

  // Ne lehessen kilépni a mappából
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) { sendNotFound(res); return; }
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n  ASTHETIC fut — ${kahoot.songs.length} dal betöltve\n`);
  console.log(`  Ezen a gépen : http://localhost:${PORT}`);
  for (const cim of helyiCimek()) {
    console.log(`  Telefonról   : http://${cim}:${PORT}   (azonos wifin)`);
  }
  console.log('\n  A leállításhoz: Ctrl + C\n');
});
