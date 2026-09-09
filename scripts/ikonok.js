// Android alkalmazásikonok előállítása az assets/asthetic-logo.png-ből.
//
// Szándékosan nincs hozzá külső könyvtár (a sharp natív bináris, a telepítése
// pedig ezen a gépen tiltott): a PNG-t a beépített zlib-bel olvassuk és írjuk.
// Csak azt az egy esetet kezeli, ami a logónkra igaz: 8 bites RGBA, nem interlaced.
//
// Futtatás:  node scripts/ikonok.js

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const GYOKER = path.join(__dirname, '..');
const RES = path.join(GYOKER, 'android', 'app', 'src', 'main', 'res');
const FORRAS = path.join(GYOKER, 'assets', 'asthetic-logo.png');

const HATTER = [0x1a, 0x1d, 0x21, 255];  // --night

/* ───────────────────────── PNG olvasás ───────────────────────── */

function pngOlvas(fajl) {
  const b = fs.readFileSync(fajl);
  if (b.readUInt32BE(0) !== 0x89504e47) throw new Error('nem PNG: ' + fajl);

  const sz = b.readUInt32BE(16);
  const ma = b.readUInt32BE(20);
  if (b[24] !== 8 || b[25] !== 6 || b[28] !== 0) {
    throw new Error('csak 8 bites, nem interlaced RGBA PNG-t tudok olvasni');
  }

  const idat = [];
  let o = 8;
  while (o < b.length) {
    const hossz = b.readUInt32BE(o);
    const tipus = b.toString('ascii', o + 4, o + 8);
    if (tipus === 'IDAT') idat.push(b.subarray(o + 8, o + 8 + hossz));
    if (tipus === 'IEND') break;
    o += 12 + hossz;
  }

  const nyers = zlib.inflateSync(Buffer.concat(idat));
  return { sz, ma, adat: szuresVissza(nyers, sz, ma) };
}

// A PNG soronként egy szűrőbájtot tárol; ezt kell visszafejteni.
function szuresVissza(nyers, sz, ma) {
  const BPP = 4;
  const sorHossz = sz * BPP;
  const ki = Buffer.alloc(sorHossz * ma);

  for (let y = 0; y < ma; y++) {
    const szuro = nyers[y * (sorHossz + 1)];
    const be = nyers.subarray(y * (sorHossz + 1) + 1, (y + 1) * (sorHossz + 1));
    const most = ki.subarray(y * sorHossz, (y + 1) * sorHossz);
    const elozo = y > 0 ? ki.subarray((y - 1) * sorHossz, y * sorHossz) : null;

    for (let i = 0; i < sorHossz; i++) {
      const a = i >= BPP ? most[i - BPP] : 0;          // balra
      const b = elozo ? elozo[i] : 0;                  // fölé
      const c = elozo && i >= BPP ? elozo[i - BPP] : 0; // átlósan
      let ertek = be[i];

      if (szuro === 1) ertek += a;
      else if (szuro === 2) ertek += b;
      else if (szuro === 3) ertek += (a + b) >> 1;
      else if (szuro === 4) ertek += paeth(a, b, c);
      else if (szuro !== 0) throw new Error('ismeretlen szűrő: ' + szuro);

      most[i] = ertek & 0xff;
    }
  }
  return ki;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/* ───────────────────────── PNG írás ───────────────────────── */

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function darab(tipus, adat) {
  const fej = Buffer.alloc(4);
  fej.writeUInt32BE(adat.length);
  const test = Buffer.concat([Buffer.from(tipus, 'ascii'), adat]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(test));
  return Buffer.concat([fej, test, crc]);
}

function pngIr(fajl, sz, ma, rgba) {
  const sorHossz = sz * 4;
  const szurt = Buffer.alloc((sorHossz + 1) * ma);
  for (let y = 0; y < ma; y++) {
    szurt[y * (sorHossz + 1)] = 0;   // "None" szűrő — a zlib úgyis tömöríti
    rgba.copy(szurt, y * (sorHossz + 1) + 1, y * sorHossz, (y + 1) * sorHossz);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(sz, 0);
  ihdr.writeUInt32BE(ma, 4);
  ihdr[8] = 8;   // bitmélység
  ihdr[9] = 6;   // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  fs.mkdirSync(path.dirname(fajl), { recursive: true });
  fs.writeFileSync(fajl, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    darab('IHDR', ihdr),
    darab('IDAT', zlib.deflateSync(szurt, { level: 9 })),
    darab('IEND', Buffer.alloc(0)),
  ]));
}

/* ───────────────────────── kép műveletek ───────────────────────── */

// Területátlagoló kicsinyítés: a nagy logóból így lesz éles kis ikon
// (egyszerű mintavételezéssel recés és zajos lenne).
function kicsinyit(kep, ujSz, ujMa) {
  const ki = Buffer.alloc(ujSz * ujMa * 4);
  const xArany = kep.sz / ujSz;
  const yArany = kep.ma / ujMa;

  for (let y = 0; y < ujMa; y++) {
    const y0 = Math.floor(y * yArany);
    const y1 = Math.max(y0 + 1, Math.ceil((y + 1) * yArany));
    for (let x = 0; x < ujSz; x++) {
      const x0 = Math.floor(x * xArany);
      const x1 = Math.max(x0 + 1, Math.ceil((x + 1) * xArany));

      let r = 0, g = 0, b = 0, a = 0, db = 0;
      for (let sy = y0; sy < Math.min(y1, kep.ma); sy++) {
        for (let sx = x0; sx < Math.min(x1, kep.sz); sx++) {
          const i = (sy * kep.sz + sx) * 4;
          const alfa = kep.adat[i + 3] / 255;
          // Előre szorzott átlagolás, hogy az átlátszó szélek ne szürküljenek be.
          r += kep.adat[i] * alfa;
          g += kep.adat[i + 1] * alfa;
          b += kep.adat[i + 2] * alfa;
          a += kep.adat[i + 3];
          db++;
        }
      }

      const ki_i = (y * ujSz + x) * 4;
      const atlagA = a / db;
      const suly = atlagA > 0 ? db * (atlagA / 255) : 1;
      ki[ki_i] = Math.round(r / suly);
      ki[ki_i + 1] = Math.round(g / suly);
      ki[ki_i + 2] = Math.round(b / suly);
      ki[ki_i + 3] = Math.round(atlagA);
    }
  }
  return { sz: ujSz, ma: ujMa, adat: ki };
}

// A logót négyzetes vászonra teszi, középre, a megadott kitöltési aránnyal.
function vasznon(kep, meret, kitoltes, hatter, kerek) {
  const belso = meret * kitoltes;
  const arany = Math.min(belso / kep.sz, belso / kep.ma);
  const sz = Math.max(1, Math.round(kep.sz * arany));
  const ma = Math.max(1, Math.round(kep.ma * arany));
  const kicsi = kicsinyit(kep, sz, ma);

  const ki = Buffer.alloc(meret * meret * 4);
  const kx = Math.round((meret - sz) / 2);
  const ky = Math.round((meret - ma) / 2);
  const sugar = meret / 2;

  for (let y = 0; y < meret; y++) {
    for (let x = 0; x < meret; x++) {
      const i = (y * meret + x) * 4;

      // háttér
      let hr = 0, hg = 0, hb = 0, ha = 0;
      if (hatter) {
        let benne = 1;
        if (kerek) {
          const t = Math.hypot(x + 0.5 - sugar, y + 0.5 - sugar);
          benne = t <= sugar - 1 ? 1 : t >= sugar ? 0 : sugar - t;  // lágy perem
        }
        hr = HATTER[0]; hg = HATTER[1]; hb = HATTER[2]; ha = 255 * benne;
      }

      // logó
      let lr = 0, lg = 0, lb = 0, la = 0;
      if (x >= kx && x < kx + sz && y >= ky && y < ky + ma) {
        const j = ((y - ky) * sz + (x - kx)) * 4;
        lr = kicsi.adat[j]; lg = kicsi.adat[j + 1]; lb = kicsi.adat[j + 2]; la = kicsi.adat[j + 3];
      }

      // a logó a háttér fölé (source-over)
      const lA = la / 255, hA = ha / 255;
      const kiA = lA + hA * (1 - lA);
      ki[i + 3] = Math.round(kiA * 255);
      if (kiA > 0) {
        ki[i] = Math.round((lr * lA + hr * hA * (1 - lA)) / kiA);
        ki[i + 1] = Math.round((lg * lA + hg * hA * (1 - lA)) / kiA);
        ki[i + 2] = Math.round((lb * lA + hb * hA * (1 - lA)) / kiA);
      }
    }
  }
  return ki;
}

/* ───────────────────────── futtatás ───────────────────────── */

// A logófájl körül jókora átlátszó margó van; ha ezzel együtt méreteznénk,
// az ikonon elveszne a rajz. Ezért előbb levágjuk a látható részre.
function levag(kep) {
  let minX = kep.sz, minY = kep.ma, maxX = -1, maxY = -1;
  for (let y = 0; y < kep.ma; y++) {
    for (let x = 0; x < kep.sz; x++) {
      if (kep.adat[(y * kep.sz + x) * 4 + 3] > 16) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return kep;   // teljesen átlátszó — hagyjuk békén

  const sz = maxX - minX + 1;
  const ma = maxY - minY + 1;
  const ki = Buffer.alloc(sz * ma * 4);
  for (let y = 0; y < ma; y++) {
    kep.adat.copy(ki, y * sz * 4, ((y + minY) * kep.sz + minX) * 4, ((y + minY) * kep.sz + minX + sz) * 4);
  }
  return { sz, ma, adat: ki };
}

const eredeti = pngOlvas(FORRAS);
const logo = levag(eredeti);
console.log(`forrás: ${eredeti.sz}×${eredeti.ma} → levágva: ${logo.sz}×${logo.ma}`);

const SURUSEGEK = [
  ['mdpi', 48, 108],
  ['hdpi', 72, 162],
  ['xhdpi', 96, 216],
  ['xxhdpi', 144, 324],
  ['xxxhdpi', 192, 432],
];

let db = 0;
for (const [nev, ikon, eloter] of SURUSEGEK) {
  const konyvtar = path.join(RES, 'mipmap-' + nev);
  pngIr(path.join(konyvtar, 'ic_launcher.png'), ikon, ikon, vasznon(logo, ikon, 0.78, true, false));
  pngIr(path.join(konyvtar, 'ic_launcher_round.png'), ikon, ikon, vasznon(logo, ikon, 0.72, true, true));
  // Az adaptív ikon előtere háttér nélkül: a külső harmadot a rendszer levághatja,
  // ezért a logó csak a közepét foglalja el.
  pngIr(path.join(konyvtar, 'ic_launcher_foreground.png'), eloter, eloter, vasznon(logo, eloter, 0.52, false, false));
  db += 3;
}

// Indítóképernyő minden sűrűséghez (a Capacitor sablon fájljait cseréljük le).
for (const nev of fs.readdirSync(RES)) {
  if (!nev.startsWith('drawable')) continue;
  const fajl = path.join(RES, nev, 'splash.png');
  if (!fs.existsSync(fajl)) continue;
  const fekvo = nev.includes('-land-');
  const meret = fekvo ? 1280 : 1024;
  pngIr(fajl, meret, meret, vasznon(logo, meret, 0.45, true, false));
  db++;
}

console.log(`${db} kép elkészült.`);
