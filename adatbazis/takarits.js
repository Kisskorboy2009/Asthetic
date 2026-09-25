// Asthetic - a tiltolistara kerult dalok kivetele a songs.json-bol, es a
// javitasok.json kezi javitasainak alkalmazasa
//
// A link_ellenoriz.js --frissit kapcsoloval a rossz linkeket a
// tiltott_videok.json-ba irja. Ez a szkript ezeket veszi ki a songs.json-bol,
// es ujraszamozza az azonositokat.
//
// Miert kulon fajlban all a tiltolista? Mert a songs.json-t a build_dataset.js
// barmikor ujraepitheti az eredeti tablazatbol - ha csak innen torolnenk, a
// rossz linkek a kovetkezo epiteskor visszajonnenek. A build_dataset.js is
// beleneze a tiltolistaba.
//
// Hasznalat: node adatbazis/takarits.js

'use strict';

const fs = require('fs');
const path = require('path');

const SONGS = path.join(__dirname, 'songs.json');
const TILTOTT = path.join(__dirname, 'tiltott_videok.json');
const { javitasokBetolt, alkalmaz } = require('./lib/javitasok.js');

function tiltottHalmaz() {
  if (!fs.existsSync(TILTOTT)) return new Set();
  const adat = JSON.parse(fs.readFileSync(TILTOTT, 'utf8'));
  return new Set((adat.videok || []).map((v) => v.videoId));
}

function main() {
  const tiltott = tiltottHalmaz();
  const songs = JSON.parse(fs.readFileSync(SONGS, 'utf8'));

  const javitva = alkalmaz(songs, javitasokBetolt());
  if (javitva) console.log('Javitott dalok: ' + javitva);

  const maradok = songs.filter((s) => !tiltott.has(s.videoId));
  const kidobott = songs.filter((s) => tiltott.has(s.videoId));

  if (kidobott.length === 0) {
    if (javitva) fs.writeFileSync(SONGS, JSON.stringify(songs, null, 2), 'utf8');
    console.log('Nincs kivenni valo (' + songs.length + ' dal).');
    return;
  }

  maradok.forEach((s, i) => { s.id = i + 1; });
  fs.writeFileSync(SONGS, JSON.stringify(maradok, null, 2), 'utf8');

  console.log('Kivett dalok (' + kidobott.length + '):');
  for (const s of kidobott) console.log('  - ' + s.artist + ' - ' + s.title + ' (' + s.year + ')');
  console.log('\nMaradt: ' + maradok.length + ' dal.  (' + SONGS + ')');
}

main();
