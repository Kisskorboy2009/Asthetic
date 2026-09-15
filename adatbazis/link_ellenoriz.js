// Asthetic - YouTube link-ellenorzo
//
// Vegigmegy a songs.json osszes dalan, es megnezi, hasznalhato-e meg a link:
//
//   1) letezik-e egyaltalan a video (torolt / privat / rossz azonosito)
//   2) elerheto-e Magyarorszagon (orszagkorlatozas)
//   3) beagyazhato-e (a jatek iframe-ben jatssza le)
//
// Ket fuggetlen forrasbol dolgozik, hogy egy elirt vagy eppen akadozo valasz
// miatt NE dobjunk ki jo dalt:
//
//   * oEmbed  (youtube.com/oembed)   - 200 = letezik es beagyazhato
//   * InnerTube player (WEB kliens)  - innen jon az orszaglista es a cim
//
// Csak akkor jelolunk meg egy dalt hibasnak, ha MINDKETTO egyetert abban, hogy
// gond van vele (vagy az orszaglistabol egyertelmuen hianyzik a HU).
//
// Hasznalat:
//   node adatbazis/link_ellenoriz.js                 - ellenoriz es jelentest ir
//   node adatbazis/link_ellenoriz.js --frissit       - a talalatokat be is irja
//                                                      a tiltott_videok.json-ba
//
// A tiltott_videok.json-t a build_dataset.js es a takarits.js is figyelembe
// veszi, tehat az adatbazis ujraepitese utan sem jonnek vissza a rossz linkek.

'use strict';

const fs = require('fs');
const path = require('path');

const SONGS = path.join(__dirname, 'songs.json');
const TILTOTT = path.join(__dirname, 'tiltott_videok.json');
const JELENTES = path.join(__dirname, 'link_jelentes.json');

const PARHUZAM = 12;
const UJRAPROBA = 2;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const varj = (ms) => new Promise((r) => setTimeout(r, ms));

/** oEmbed: 200 = letezik es beagyazhato; 401/403 = beagyazas tiltva; 404/400 = nincs ilyen video. */
async function oembed(videoId) {
  const cim = 'https://www.youtube.com/oembed?format=json&url='
    + encodeURIComponent('https://www.youtube.com/watch?v=' + videoId);

  for (let i = 0; i <= UJRAPROBA; i++) {
    try {
      const valasz = await fetch(cim, { headers: { 'User-Agent': UA } });
      if (valasz.status === 429 || valasz.status >= 500) { await varj(800 * (i + 1)); continue; }
      let cimSzoveg = null;
      if (valasz.status === 200) {
        try { cimSzoveg = JSON.parse(await valasz.text()).title; } catch { /* mindegy */ }
      }
      return { http: valasz.status, cim: cimSzoveg };
    } catch {
      await varj(600 * (i + 1));
    }
  }
  return { http: 0, cim: null };   // nem tudtuk eldonteni
}

/** InnerTube: innen derul ki, mely orszagokban erheto el a video. */
async function orszagok(videoId) {
  for (let i = 0; i <= UJRAPROBA; i++) {
    try {
      const valasz = await fetch('https://www.youtube.com/youtubei/v1/player', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': UA,
          'Accept-Language': 'hu-HU,hu;q=0.9',
          Origin: 'https://www.youtube.com',
          Referer: 'https://www.youtube.com/',
        },
        body: JSON.stringify({
          context: { client: { clientName: 'WEB', clientVersion: '2.20260915.01.00', hl: 'hu', gl: 'HU' } },
          videoId,
        }),
      });
      if (valasz.status === 429 || valasz.status >= 500) { await varj(800 * (i + 1)); continue; }

      const adat = await valasz.json();
      const mikro = adat.microformat && adat.microformat.playerMicroformatRenderer;
      return {
        vanAdat: Boolean(adat.videoDetails),
        cim: adat.videoDetails ? adat.videoDetails.title : null,
        beagyazhato: adat.videoDetails ? adat.videoDetails.isPlayableInEmbed : undefined,
        lista: mikro && Array.isArray(mikro.availableCountries) ? mikro.availableCountries : null,
      };
    } catch {
      await varj(600 * (i + 1));
    }
  }
  return { vanAdat: null, cim: null, beagyazhato: undefined, lista: null };
}

/**
 * Egy dal kiertekelese.
 * @returns {{ok: boolean, ok_e: string, indok: string|null}}
 */
async function ellenoriz(dal) {
  const [oe, it] = await Promise.all([oembed(dal.videoId), orszagok(dal.videoId)]);

  // 1) Orszagkorlatozas - ez a legbiztosabb jel, es onmagaban is dont.
  if (it.lista && !it.lista.includes('HU')) {
    return { ok: false, indok: 'orszagkorlat', reszlet: `${it.lista.length} orszagban erheto el, HU nincs kozte` };
  }

  // 2) Beagyazas kifejezetten tiltva.
  if (it.beagyazhato === false) {
    return { ok: false, indok: 'nem-beagyazhato', reszlet: 'a feltolto letiltotta a beagyazast' };
  }

  // 3) Torolt / privat / rossz azonosito. Csak akkor hisszuk el, ha az
  //    InnerTube sem talalta meg - igy egy elakadt oEmbed-hivas nem dob ki dalt.
  if ((oe.http === 404 || oe.http === 400) && it.vanAdat === false) {
    return { ok: false, indok: 'nincs-ilyen-video', reszlet: `oEmbed ${oe.http}` };
  }

  // 4) oEmbed 401/403 = beagyazas tiltva. Ezt maganak az oEmbednek elhisszuk.
  if (oe.http === 401 || oe.http === 403) {
    return { ok: false, indok: 'nem-beagyazhato', reszlet: `oEmbed ${oe.http}` };
  }

  // 5) Nem tudtuk eldonteni (halozati hiba mindket oldalon) - NEM dobjuk ki.
  if (oe.http === 0 && it.vanAdat === null) {
    return { ok: true, indok: 'bizonytalan', reszlet: 'nem sikerult lekerdezni' };
  }

  return { ok: true, indok: null, reszlet: null, cim: oe.cim || it.cim };
}

async function main() {
  const frissit = process.argv.includes('--frissit');
  // Proba futtatashoz: --elso=50 csak az elso 50 dalt nezi meg.
  const elsoKapcsolo = process.argv.find((a) => a.startsWith('--elso='));
  let songs = JSON.parse(fs.readFileSync(SONGS, 'utf8'));
  if (elsoKapcsolo) songs = songs.slice(0, Number(elsoKapcsolo.split('=')[1]) || 50);

  console.log(`Ellenorzes indul: ${songs.length} dal, ${PARHUZAM} parhuzamos lekerdezes.\n`);

  const hibasak = [];
  const bizonytalanok = [];
  let kesz = 0;
  let mutato = 0;

  async function munkas() {
    while (mutato < songs.length) {
      const dal = songs[mutato++];
      const eredmeny = await ellenoriz(dal);
      kesz++;

      if (!eredmeny.ok) {
        hibasak.push({
          videoId: dal.videoId,
          eloado: dal.artist,
          cim: dal.title,
          ev: dal.year,
          indok: eredmeny.indok,
          reszlet: eredmeny.reszlet,
        });
        console.log(`  HIBAS  ${dal.artist} - ${dal.title} (${eredmeny.indok}: ${eredmeny.reszlet})`);
      } else if (eredmeny.indok === 'bizonytalan') {
        bizonytalanok.push({ videoId: dal.videoId, eloado: dal.artist, cim: dal.title });
      }

      if (kesz % 100 === 0) console.log(`  ... ${kesz}/${songs.length}  (eddig ${hibasak.length} hibas)`);
    }
  }

  await Promise.all(Array.from({ length: PARHUZAM }, munkas));

  const jelentes = {
    keszult: new Date().toISOString(),
    osszes: songs.length,
    hibas: hibasak.length,
    bizonytalan: bizonytalanok.length,
    hibasak,
    bizonytalanok,
  };
  fs.writeFileSync(JELENTES, JSON.stringify(jelentes, null, 2), 'utf8');

  console.log('\n=== Kesz ===');
  console.log('Osszes dal      : ' + songs.length);
  console.log('Hibas link      : ' + hibasak.length);
  console.log('Bizonytalan     : ' + bizonytalanok.length + '  (halozati hiba - nem dobtuk ki)');
  const okok = {};
  for (const h of hibasak) okok[h.indok] = (okok[h.indok] || 0) + 1;
  for (const [ok, db] of Object.entries(okok)) console.log('  - ' + ok + ': ' + db);
  console.log('\nJelentes: ' + JELENTES);

  if (!frissit) {
    console.log('\nA --frissit kapcsoloval a talalatok bekerulnek a tiltott_videok.json-ba.');
    return;
  }

  const regi = fs.existsSync(TILTOTT) ? JSON.parse(fs.readFileSync(TILTOTT, 'utf8')) : { videok: [] };
  const terkep = new Map((regi.videok || []).map((v) => [v.videoId, v]));
  for (const h of hibasak) {
    terkep.set(h.videoId, {
      videoId: h.videoId,
      eloado: h.eloado,
      cim: h.cim,
      indok: h.indok,
      reszlet: h.reszlet,
      felvitel: new Date().toISOString().slice(0, 10),
    });
  }
  fs.writeFileSync(TILTOTT, JSON.stringify({
    leiras: 'Nem hasznalhato YouTube-videok. A build_dataset.js es a takarits.js kihagyja oket.',
    videok: [...terkep.values()].sort((a, b) => a.videoId.localeCompare(b.videoId)),
  }, null, 2), 'utf8');
  console.log('Tiltolista frissitve: ' + TILTOTT + '  (' + terkep.size + ' video)');
}

main().catch((hiba) => { console.error(hiba); process.exit(1); });
