// A javitasok.json alkalmazasa: kezi javitasok a tablazat hibaira (rossz link,
// elirt cim vagy eloado), az EREDETI videoId szerint azonositva. Igy a
// build_dataset.js ujraepitese utan is ervenyben maradnak.

'use strict';

const fs = require('fs');
const path = require('path');

const FAJL = path.join(__dirname, '..', 'javitasok.json');

function javitasokBetolt() {
  if (!fs.existsSync(FAJL)) return new Map();
  const adat = JSON.parse(fs.readFileSync(FAJL, 'utf8'));
  return new Map((adat.javitasok || []).map((j) => [j.videoId, j]));
}

/** Visszaadja, hanyat javitott. A dalokat helyben modositja. */
function alkalmaz(songs, javitasok) {
  let db = 0;
  for (const dal of songs) {
    const j = javitasok.get(dal.videoId);
    if (!j) continue;
    if (j.ujVideoId) dal.videoId = j.ujVideoId;
    if (j.artist) dal.artist = j.artist;
    if (j.title) { dal.title = j.title; dal.titleOriginal = j.title; }
    if (j.year) dal.year = j.year;
    db++;
  }
  return db;
}

module.exports = { javitasokBetolt, alkalmaz };
