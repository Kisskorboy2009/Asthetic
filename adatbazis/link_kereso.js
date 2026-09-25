// Asthetic - helyes video keresese egy rossz linkhez
//
// A YouTube keresojeben (InnerTube search) rakeres az "eloado dalcim" parosra,
// es a talalatok kozul azt valasztja, amelyiknek a cime/csatornaja egyertelmuen
// az eloadot ES a dalt tartalmazza, beagyazhato, es Magyarorszagon is elerheto.
//
// Hasznalat:
//   node adatbazis/link_kereso.js 140 1343 ...     - javaslatok a megadott dal-azonositokra
//
// Nem ir semmit: a javaslatokat kiirja, a jovahagyottak a javitott_linkek.json-ba
// kerulnek (azt a build_dataset.js es a javits.js alkalmazza).

'use strict';

const fs = require('fs');
const path = require('path');

const SONGS = path.join(__dirname, 'songs.json');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const KLIENS = { clientName: 'WEB', clientVersion: '2.20260915.01.00', hl: 'hu', gl: 'HU' };

function norm(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function eloadok(artist) {
  return String(artist || '')
    .replace(/\(.*?\)/g, ' ')
    .split(/\s+(?:feat\.?|ft\.?|featuring|vs\.?|x|&|és|and|with)\s+|,\s*/i)
    .map((s) => s.trim()).filter(Boolean);
}

function pont(dal, cim, csatorna) {
  const szoveg = norm(cim + ' ' + csatorna);
  const tomor = szoveg.replace(/ /g, '');
  const eloado = eloadok(dal.artist).some((e) => norm(e) && tomor.includes(norm(e).replace(/ /g, '')));
  const dalcim = norm(String(dal.titleOriginal || dal.title).replace(/\(.*?\)|\[.*?\]/g, ' ')).replace(/ /g, '');
  const cimStimmel = dalcim && tomor.includes(dalcim);
  // Feldolgozasok, elo felvetelek, reakciovideok ne nyerjenek.
  const rossz = /(reag|reaction|cover|karaoke|instrumental|remix|live|elo|koncert|lyrics? video|nightcore|sped up|slowed|feldolgozas|tutorial|lesson)/.test(szoveg);
  return { eloado, cimStimmel, rossz, ertek: (eloado ? 2 : 0) + (cimStimmel ? 2 : 0) - (rossz ? 1.5 : 0) + (/official|hivatalos|topic|vevo/.test(szoveg) ? 0.5 : 0) };
}

function videok(obj, lista = []) {
  if (!obj || typeof obj !== 'object') return lista;
  if (obj.videoRenderer && obj.videoRenderer.videoId) {
    const v = obj.videoRenderer;
    lista.push({
      videoId: v.videoId,
      cim: (v.title && v.title.runs || []).map((r) => r.text).join(''),
      csatorna: (v.ownerText && v.ownerText.runs || []).map((r) => r.text).join(''),
      hossz: v.lengthText ? v.lengthText.simpleText : '',
    });
  }
  for (const k of Object.keys(obj)) videok(obj[k], lista);
  return lista;
}

async function keres(kifejezes) {
  const v = await fetch('https://www.youtube.com/youtubei/v1/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Origin: 'https://www.youtube.com' },
    body: JSON.stringify({ context: { client: KLIENS }, query: kifejezes }),
  });
  if (!v.ok) throw new Error('keresés: HTTP ' + v.status);
  return videok(await v.json());
}

async function beagyazhato(videoId) {
  const v = await fetch('https://www.youtube.com/oembed?format=json&url='
    + encodeURIComponent('https://www.youtube.com/watch?v=' + videoId), { headers: { 'User-Agent': UA } });
  return v.status === 200;
}

async function magyarorszagon(videoId) {
  const v = await fetch('https://www.youtube.com/youtubei/v1/player', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Origin: 'https://www.youtube.com' },
    body: JSON.stringify({ context: { client: KLIENS }, videoId }),
  });
  if (!v.ok) return null;
  const adat = await v.json();
  const mikro = adat.microformat && adat.microformat.playerMicroformatRenderer;
  if (!mikro || !Array.isArray(mikro.availableCountries)) return null;   // nem tudni
  return mikro.availableCountries.includes('HU');
}

function hosszMp(s) {
  return String(s || '').split(':').reduce((a, b) => a * 60 + Number(b), 0);
}

async function javaslat(dal) {
  const talalatok = await keres(`${eloadok(dal.artist)[0]} ${dal.titleOriginal || dal.title}`);
  const jeloltek = talalatok
    .filter((t) => t.videoId !== dal.videoId)
    .filter((t) => { const h = hosszMp(t.hossz); return h === 0 || (h >= 90 && h <= 12 * 60); })
    .map((t) => ({ ...t, ...pont(dal, t.cim, t.csatorna) }))
    .filter((t) => t.eloado && t.cimStimmel)
    .sort((a, b) => b.ertek - a.ertek);

  for (const j of jeloltek.slice(0, 5)) {
    if (!(await beagyazhato(j.videoId))) continue;
    const hu = await magyarorszagon(j.videoId);
    if (hu === false) continue;
    return j;
  }
  return null;
}

async function main() {
  const idk = process.argv.slice(2).map(Number).filter(Boolean);
  const songs = JSON.parse(fs.readFileSync(SONGS, 'utf8'));
  const eredmeny = [];
  for (const id of idk) {
    const dal = songs.find((s) => s.id === id);
    if (!dal) { console.log(`${id}: nincs ilyen dal`); continue; }
    let j = null;
    try { j = await javaslat(dal); } catch (e) { console.log(`${id}: ${e.message}`); }
    eredmeny.push({ id, eloado: dal.artist, cim: dal.title, regi: dal.videoId, uj: j ? j.videoId : null, ujCim: j ? j.cim : null, csatorna: j ? j.csatorna : null, hossz: j ? j.hossz : null });
    console.log(`${String(id).padStart(4)}  ${dal.artist} — ${dal.title}\n      ${j ? `→ ${j.videoId}  "${j.cim}" | ${j.csatorna} (${j.hossz})` : '→ NINCS megbízható találat'}`);
  }
  fs.writeFileSync(path.join(__dirname, 'link_javaslatok.json'), JSON.stringify(eredmeny, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
