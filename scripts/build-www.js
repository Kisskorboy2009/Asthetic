// A statikus weboldalt átmásolja a www/ mappába, amit a Capacitor becsomagol az APK-ba.
//
// A weboldal gyökere maga a projektmappa (így a server.js-t nem kellett átalakítani),
// de a Capacitornak egy külön, tiszta mappa kell, amiben NINCS benne a node_modules,
// az android/ vagy a szerveroldali kód.

const fs = require('fs');
const path = require('path');

const GYOKER = path.join(__dirname, '..');
const CEL = path.join(GYOKER, 'www');

// Ezek kerülnek bele az alkalmazásba.
const MASOLANDO = [
  'index.html',
  'jatek.html',
  'kahoot.html',
  'szabalyok.html',
  'adatvedelem.html',
  'feltetelek.html',
  '404.html',
  'css',
  'js',
  'assets',
  'robots.txt',
  'sitemap.xml',
];

function torol(cel) {
  if (fs.existsSync(cel)) fs.rmSync(cel, { recursive: true, force: true });
}

function masol(honnan, hova) {
  const allapot = fs.statSync(honnan);
  if (allapot.isDirectory()) {
    fs.mkdirSync(hova, { recursive: true });
    for (const nev of fs.readdirSync(honnan)) masol(path.join(honnan, nev), path.join(hova, nev));
  } else {
    fs.copyFileSync(honnan, hova);
  }
}

torol(CEL);
fs.mkdirSync(CEL, { recursive: true });

let db = 0;
for (const nev of MASOLANDO) {
  const forras = path.join(GYOKER, nev);
  if (!fs.existsSync(forras)) {
    console.warn('  ! hiányzik, kihagyva: ' + nev);
    continue;
  }
  masol(forras, path.join(CEL, nev));
  db++;
}

console.log(`www/ elkészült — ${db} elem bemásolva.`);
