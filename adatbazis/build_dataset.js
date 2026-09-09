// Asthetic / Hitster - adatbazis epito
//
// Bemenet : D:\Hister\KESZ_LINKES.xlsx  (Sorszam | Eloado | Dal cime | Evszam | YouTube FIX)
// Kimenet : songs.json  - tisztitott dallista a Kahoot-modhoz es a QR-modhoz
//
// A tisztitas soran kiszurjuk a hasznalhatatlan sorokat (ervenytelen videoazonosito,
// hianyzo vagy irrealis evszam), es egyseges alakra hozzuk az eloadonevek.

const fs = require('fs');
const path = require('path');
const { readSheet } = require('./lib/parse_xlsx.js');

const FORRAS = process.argv[2] || 'D:/Hister/KESZ_LINKES.xlsx';
const KIMENET = path.join(__dirname, 'songs.json');

// --- videoazonosito kinyerese barmilyen YouTube-linkbol ---
function extractVideoId(url) {
  if (!url) return null;
  const s = String(url).trim();

  let m = s.match(/[?&]v=([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/);
  if (m) return m[1];

  m = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/);
  if (m) return m[1];

  m = s.match(/\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})(?![A-Za-z0-9_-])/);
  if (m) return m[1];

  return null;
}

// --- szoveg normalizalasa osszehasonlitashoz (ekezet- es kisbetu-fuggetlen) ---
function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// A dalcimekbol levagjuk a zarojeles technikai toldalekokat (remaster, video verzio stb.),
// hogy a kviz valaszlehetosegei ne aruljak el maguktol a helyes valaszt.
function cleanTitle(raw) {
  let t = String(raw || '').trim();
  t = t.replace(/\s*[\(\[][^)\]]*(remaster|remastered|official|video|audio|lyric|hd|hq|version|verzio|verzió|live|radio edit|mono|stereo)[^)\]]*[\)\]]\s*/gi, ' ');
  t = t.replace(/\s*-\s*(remaster(ed)?( \d{4})?|\d{4} remaster(ed)?|official (music )?video|lyric video|audio)\s*$/gi, '');
  return t.replace(/\s+/g, ' ').trim();
}

function main() {
  console.log('Forras: ' + FORRAS);
  const rows = readSheet(FORRAS);

  const songs = [];
  const seen = new Set();
  const stats = { osszes: 0, ervenytelenLink: 0, rosszEvszam: 0, duplikatum: 0, hianyzoMezo: 0 };

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;

    const artist = String(r[1] || '').trim();
    const rawTitle = String(r[2] || '').trim();
    const yearRaw = String(r[3] || '').trim();
    const link = String(r[4] || '').trim();

    if (!artist && !rawTitle && !link) continue;
    stats.osszes++;

    if (!artist || !rawTitle) { stats.hianyzoMezo++; continue; }

    const videoId = extractVideoId(link);
    if (!videoId) { stats.ervenytelenLink++; continue; }

    const year = parseInt(yearRaw, 10);
    if (!Number.isFinite(year) || year < 1900 || year > 2030) { stats.rosszEvszam++; continue; }

    // Duplikatum-szures: ugyanaz a video, vagy ugyanaz az eloado+cim paros
    const keyVideo = 'v:' + videoId;
    const keySong = 's:' + normalize(artist) + '|' + normalize(cleanTitle(rawTitle));
    if (seen.has(keyVideo) || seen.has(keySong)) { stats.duplikatum++; continue; }
    seen.add(keyVideo);
    seen.add(keySong);

    songs.push({
      id: songs.length + 1,
      artist,
      title: cleanTitle(rawTitle),
      titleOriginal: rawTitle,
      year,
      videoId,
    });
  }

  songs.sort((a, b) => a.year - b.year || a.artist.localeCompare(a.artist, 'hu'));
  songs.forEach((s, i) => { s.id = i + 1; });

  fs.writeFileSync(KIMENET, JSON.stringify(songs, null, 2), 'utf8');

  // --- statisztika ---
  const years = songs.map((s) => s.year);
  const artistCount = new Map();
  for (const s of songs) artistCount.set(s.artist, (artistCount.get(s.artist) || 0) + 1);
  const tobbDalos = [...artistCount.values()].filter((n) => n >= 4).length;

  console.log('\n=== Feldolgozas kesz ===');
  console.log('Beolvasott sorok        : ' + stats.osszes);
  console.log('Hianyzo eloado/cim      : ' + stats.hianyzoMezo);
  console.log('Ervenytelen videolink   : ' + stats.ervenytelenLink);
  console.log('Rossz/hianyzo evszam    : ' + stats.rosszEvszam);
  console.log('Duplikatum              : ' + stats.duplikatum);
  console.log('--------------------------------');
  console.log('Hasznalhato dal         : ' + songs.length);
  console.log('Evszam-tartomany        : ' + Math.min(...years) + ' - ' + Math.max(...years));
  console.log('Kulonbozo eloado        : ' + artistCount.size);
  console.log('Eloado 4+ dallal        : ' + tobbDalos + '  (ezeknel mukodik a "sajat dalok" cimkviz)');
  console.log('\nKimenet: ' + KIMENET);
}

main();
