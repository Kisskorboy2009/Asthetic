// Asthetic - tartalom-ellenorzo: tenyleg az a dal van-e a linken?
//
// A link_ellenoriz.js azt nezi, lejatszhato-e a video. Ez azt, hogy JO video-e:
// lekeri minden video YouTube-os cimet es csatornajat (oEmbed), es osszeveti az
// adatbazisban szereplo eloadoval es dalcimmel. Igy derulnek ki az olyan
// linkek, amik mogott egy teljesen mas video van (pl. egy fozos musor).
//
// Hasznalat:
//   node adatbazis/tartalom_ellenoriz.js
//
// Eredmeny: tartalom_jelentes.json – a gyanus dalok, pontszam szerint.
// A lekert cimeket a video_cimek.json tarolja, igy az ujrafuttatas gyors.

'use strict';

const fs = require('fs');
const path = require('path');

const SONGS = path.join(__dirname, 'songs.json');
const CIMEK = path.join(__dirname, 'video_cimek.json');
const JELENTES = path.join(__dirname, 'tartalom_jelentes.json');

const PARHUZAM = 10;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const varj = (ms) => new Promise((r) => setTimeout(r, ms));

async function oembed(videoId) {
  const cim = 'https://www.youtube.com/oembed?format=json&url='
    + encodeURIComponent('https://www.youtube.com/watch?v=' + videoId);
  for (let i = 0; i < 4; i++) {
    try {
      const v = await fetch(cim, { headers: { 'User-Agent': UA } });
      if (v.status === 429 || v.status >= 500) { await varj(1000 * (i + 1)); continue; }
      if (v.status !== 200) return { http: v.status };
      const j = await v.json();
      return { http: 200, cim: j.title, csatorna: j.author_name };
    } catch {
      await varj(800 * (i + 1));
    }
  }
  return { http: 0 };
}

/** kisbetus, ekezet nelkul, csak betuk es szamok */
function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/ø/g, 'o').replace(/ß/g, 'ss').replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const TOLTELEK = new Set(['the', 'a', 'an', 'and', 'es', 'feat', 'ft', 'featuring', 'with', 'vs', 'x', 'of', 'le', 'la', 'de', 'az', 'egy', 'band', 'zenekar', 'official', 'video']);

function szavak(s, minHossz) {
  return norm(s).split(' ').filter((w) => w.length >= minHossz && !TOLTELEK.has(w));
}

/** Az eloado nevebol a fo eloado(k): "X feat. Y", "X & Y", "X es Y" szetbontva. */
function eloadok(artist) {
  return String(artist || '')
    .split(/\s+(?:feat\.?|ft\.?|featuring|vs\.?|x|&|és|and|with)\s+|,\s*/i)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 0..1 kozotti egyezes: mennyire illik a video cime + csatornaja a dalhoz.
 * Az eloado VAGY a cim egyertelmu jelenlete mar eleg - a legtobb rossz link
 * egyiket sem tartalmazza.
 */
function egyezes(dal, video) {
  const szoveg = ' ' + norm(video.cim + ' ' + video.csatorna) + ' ';
  const tomor = szoveg.replace(/ /g, '');

  const eloadoTalalat = eloadok(dal.artist).some((e) => {
    const n = norm(e);
    if (!n) return false;
    if (tomor.includes(n.replace(/ /g, ''))) return true;
    const w = szavak(e, 3);
    return w.length > 0 && w.filter((x) => szoveg.includes(' ' + x + ' ')).length / w.length >= 0.5;
  });

  const cim = String(dal.titleOriginal || dal.title).replace(/\(.*?\)|\[.*?\]/g, ' ');
  const cimSzavak = szavak(cim, 2);
  const cimNorm = norm(cim).replace(/ /g, '');
  let cimArany = 0;
  if (cimNorm && tomor.includes(cimNorm)) cimArany = 1;
  else if (cimSzavak.length) cimArany = cimSzavak.filter((x) => szoveg.includes(' ' + x + ' ')).length / cimSzavak.length;

  return { eloado: eloadoTalalat, cim: cimArany };
}

async function main() {
  const songs = JSON.parse(fs.readFileSync(SONGS, 'utf8'));
  const cimek = fs.existsSync(CIMEK) ? JSON.parse(fs.readFileSync(CIMEK, 'utf8')) : {};

  const hianyzik = songs.filter((s) => !cimek[s.videoId] || cimek[s.videoId].http === 0);
  console.log(`${songs.length} dal, ${hianyzik.length} cím lekérése…`);

  let kesz = 0;
  const sor = hianyzik.slice();
  async function munkas() {
    while (sor.length) {
      const dal = sor.shift();
      cimek[dal.videoId] = await oembed(dal.videoId);
      if (++kesz % 100 === 0) {
        console.log(`  ${kesz}/${hianyzik.length}`);
        fs.writeFileSync(CIMEK, JSON.stringify(cimek, null, 1));
      }
    }
  }
  await Promise.all(Array.from({ length: PARHUZAM }, munkas));
  fs.writeFileSync(CIMEK, JSON.stringify(cimek, null, 1));

  const gyanus = [];
  for (const dal of songs) {
    const v = cimek[dal.videoId];
    if (!v || v.http !== 200) {
      gyanus.push({ szint: 'nem-elerheto', id: dal.id, eloado: dal.artist, cim: dal.title, ev: dal.year, videoId: dal.videoId, video: `HTTP ${v ? v.http : '?'}` });
      continue;
    }
    const e = egyezes(dal, v);
    let szint = null;
    if (!e.eloado && e.cim < 0.5) szint = 'rossz';           // se az eloado, se a cim
    else if (!e.eloado || e.cim < 0.5) szint = 'gyanus';      // csak az egyik stimmel
    if (szint) {
      gyanus.push({
        szint, id: dal.id, eloado: dal.artist, cim: dal.title, ev: dal.year, videoId: dal.videoId,
        video: v.cim, csatorna: v.csatorna, eloadoStimmel: e.eloado, cimArany: Math.round(e.cim * 100) / 100,
      });
    }
  }

  const rend = { rossz: 0, 'nem-elerheto': 1, gyanus: 2 };
  gyanus.sort((a, b) => rend[a.szint] - rend[b.szint] || a.cimArany - b.cimArany);
  fs.writeFileSync(JELENTES, JSON.stringify({ keszult: new Date().toISOString(), osszes: songs.length, talalat: gyanus.length, dalok: gyanus }, null, 2));

  const db = (sz) => gyanus.filter((g) => g.szint === sz).length;
  console.log(`\nRossz (se előadó, se cím): ${db('rossz')}`);
  console.log(`Nem elérhető:              ${db('nem-elerheto')}`);
  console.log(`Gyanús (csak az egyik):    ${db('gyanus')}`);
  console.log(`Jelentés: ${JELENTES}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
