// A kerdesgenerator ellenorzese a teljes adatbazison.
// Nem "hisszuk", hogy jo - vegigfuttatjuk mind az 1751 dalon, es szamszeruen megnezzuk.

const fs = require('fs');
const path = require('path');
const { generateQuestion, normalize } = require('./question_engine.js');

const songs = JSON.parse(fs.readFileSync(path.join(__dirname, 'songs.json'), 'utf8'));

const hibak = [];

// Eloadonev a kozremukodok nelkul - ugyanaz a szabaly, mint a generatorban.
function foEloado(nev) {
  return normalize(String(nev || '').replace(/\s*(?:feat\.?|ft\.?|featuring|vs\.?|&|,|\bx\b|\bés\b)\s+.*$/i, ''));
}

// Melyik eloado melyik nyelvi korbe tartozik.
const nyelvSzerint = new Map(songs.map((d) => [d.artist, d.nyelv]));
const stat = {
  year: { ok: 0, nincs: 0 },
  artist: { ok: 0, nincs: 0 },
  title: { ok: 0, nincs: 0, sajat: 0, vegyes: 0, korszak: 0 },
};

// --- 0) normalize ekezet-teszt ---
const normTest = normalize('Árvíztűrő TÜKÖRFÚRÓGÉP');
if (normTest !== 'arvizturo tukorfurogep') {
  hibak.push('normalize() rosszul kezeli az ekezeteket: "' + normTest + '"');
}

// --- 1) minden dalra, minden tipusra ---
for (const song of songs) {
  for (const type of ['year', 'artist', 'title']) {
    const q = generateQuestion(song, songs, type, song.id * 7919 + type.length);

    if (!q) { stat[type].nincs++; continue; }
    stat[type].ok++;
    if (type === 'title' && q.source) stat.title[q.source]++;

    // --- ellenorzesek, amiknek MINDIG teljesulniuk kell ---
    if (q.options.length !== 4) hibak.push(`#${song.id} ${type}: nem 4 valasz (${q.options.length})`);

    const uniq = new Set(q.options.map((o) => normalize(o)));
    if (uniq.size !== 4) hibak.push(`#${song.id} ${type}: ismetlodo valasz -> ${JSON.stringify(q.options)}`);

    if (q.correctIndex < 0 || q.correctIndex > 3) hibak.push(`#${song.id} ${type}: rossz correctIndex`);
    if (q.options[q.correctIndex] !== q.correctAnswer) hibak.push(`#${song.id} ${type}: correctIndex nem a helyes valaszra mutat`);

    if (type === 'year') {
      const ys = q.options.map(Number);
      if (ys[q.correctIndex] !== song.year) hibak.push(`#${song.id} year: nem a dal evszama a helyes valasz`);
      const sorted = ys.slice().sort((a, b) => a - b);
      if (JSON.stringify(sorted) !== JSON.stringify(ys)) hibak.push(`#${song.id} year: nem novekvo sorrend`);
      for (let i = 1; i < 4; i++) {
        const d = sorted[i] - sorted[i - 1];
        if (d < 5 || d > 10) hibak.push(`#${song.id} year: szomszedos evek tavolsaga ${d} (5-10 kellene) -> ${ys.join(', ')}`);
      }
      // Egyetlen evszam sem lehet jovobeli vagy irrealisan regi - az azonnal elarulna magat.
      const MOST = new Date().getFullYear();
      for (const y of ys) {
        if (y > MOST) hibak.push(`#${song.id} year: JOVOBELI evszam a valaszok kozott (${y}) -> ${ys.join(', ')}`);
        if (y < 1900) hibak.push(`#${song.id} year: irrealisan regi evszam (${y}) -> ${ys.join(', ')}`);
      }
    }

    if (type === 'artist') {
      if (q.options[q.correctIndex] !== song.artist) hibak.push(`#${song.id} artist: nem a dal eloadoja a helyes valasz`);
      // egyik elterito sem lehet ugyanaz az eloado - a kozremukodos valtozatai sem,
      // kulonben mind a negy valasz ugyanaz az eloado lehetne
      const fok = q.options.map(foEloado);
      if (new Set(fok).size !== 4) {
        hibak.push(`#${song.id} artist: ugyanaz a fo eloado tobbszor -> ${JSON.stringify(q.options)}`);
      }
      // nyelvi kor: angol dal melle ne kerulhessen magyar eloado (es forditva)
      for (const o of q.options) {
        const ny = nyelvSzerint.get(o);
        if (ny && song.nyelv && ny !== song.nyelv) {
          hibak.push(`#${song.id} artist: mas nyelvi korbol valo elterito (${o} = ${ny}, a dal = ${song.nyelv})`);
        }
      }
    }

    if (type === 'title') {
      if (q.options[q.correctIndex] !== song.title) hibak.push(`#${song.id} title: nem a dal cime a helyes valasz`);
    }
  }
}

// --- 2) determinisztikussag: ugyanaz a seed = ugyanaz a kerdes ---
const s = songs[42];
const a = generateQuestion(s, songs, 'year', 12345);
const b = generateQuestion(s, songs, 'year', 12345);
if (JSON.stringify(a) !== JSON.stringify(b)) hibak.push('Nem determinisztikus: ugyanaz a seed mas kerdest adott!');

const c = generateQuestion(s, songs, 'year', 999);
if (JSON.stringify(a) === JSON.stringify(c)) hibak.push('Gyanus: kulonbozo seed ugyanazt adta.');

// --- eredmenyek ---
console.log('=== Lefedettseg (' + songs.length + ' dal) ===');
console.log(`evszam  : ${stat.year.ok} sikeres, ${stat.year.nincs} sikertelen`);
console.log(`eloado  : ${stat.artist.ok} sikeres, ${stat.artist.nincs} sikertelen`);
console.log(`dalcim  : ${stat.title.ok} sikeres, ${stat.title.nincs} sikertelen`);
console.log(`   ebbol sajat eloado dalaibol : ${stat.title.sajat}`);
console.log(`         vegyes (reszben sajat): ${stat.title.vegyes}`);
console.log(`         csak korszak alapjan  : ${stat.title.korszak}`);

console.log('\n=== Peldak ===');
for (const type of ['year', 'artist', 'title']) {
  const song = songs[Math.floor(songs.length / 2) + type.length];
  const q = generateQuestion(song, songs, type, 2026);
  console.log(`\n[${type}] ${song.artist} - ${song.title} (${song.year})`);
  console.log('  ' + q.kerdes);
  q.options.forEach((o, i) => console.log(`   ${i === q.correctIndex ? '>' : ' '} ${String.fromCharCode(65 + i)}) ${o}`));
  if (q.source) console.log('  (elteritok forrasa: ' + q.source + ')');
}

console.log('\n=== Hibak ===');
if (hibak.length === 0) {
  console.log('Nincs hiba. Mind a ' + (songs.length * 3) + ' generalt kerdes atment az ellenorzeseken.');
} else {
  console.log('HIBAK SZAMA: ' + hibak.length);
  hibak.slice(0, 25).forEach((h) => console.log(' - ' + h));
  if (hibak.length > 25) console.log(' ... es meg ' + (hibak.length - 25));
  process.exitCode = 1;
}
