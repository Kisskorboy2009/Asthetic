// Asthetic - Kahoot-mod szerveroldali jatekmotor
//
// Szobakezeles, korok, pontozas. Kulso csomag nelkul: a valos ideju frissiteseket
// SSE-vel (Server-Sent Events) toljuk ki a jatekosoknak, a muveleteket sima POST-tal.
//
// FONTOS biztonsagi elv: a helyes valasz indexet SOHA nem kuldjuk ki a kerdes
// alatt - csak a kiertekeleskor. Kulonben a bongeszo konzoljabol lattszana.

const fs = require('fs');
const path = require('path');
const motor = require('./js/jatekmotor.js');

const songs = JSON.parse(fs.readFileSync(path.join(__dirname, 'adatbazis', 'songs.json'), 'utf8'));

// ───────────────────────── alapertelmezett szobabeallitasok ─────────────────────────

const ALAP_BEALLITAS = motor.ALAP_BEALLITAS;

const SZOBA_ELAVUL_MS = 4 * 60 * 60 * 1000; // 4 ora utan takaritunk

// ───────────────────────── segedfuggvenyek ─────────────────────────

const szobak = new Map();

function ujKod() {
  return motor.ujKod((kod) => szobak.has(kod));
}

function ujAzonosito() {
  return motor.ujAzonosito();
}

function tisztitBeallitas(be) {
  return motor.tisztitBeallitas(be);
}

// ───────────────────────── szoba letrehozas / csatlakozas ─────────────────────────

function szobaLetrehoz(hostNev, beallitas) {
  const kod = ujKod();
  const hostId = ujAzonosito();

  const szoba = {
    kod,
    hostId,
    letrejott: Date.now(),
    beallitas: tisztitBeallitas(beallitas),
    jatekosok: new Map(),
    allapot: 'lobby',        // lobby | kerdes | eredmeny | vege
    kor: 0,
    aktualisKerdes: null,
    kerdesIndult: 0,
    valaszok: new Map(),     // playerId -> { valasz, mikorMs }
    hasznaltDalok: new Set(),
    kizartDalok: new Set(),  // a szobavezeto altal kidobott dalok
    figyelok: new Set(),     // SSE kapcsolatok
    idozito: null,
  };

  szoba.jatekosok.set(hostId, { id: hostId, nev: tisztitNev(hostNev), pont: 0, host: true, csatlakozott: Date.now() });
  szobak.set(kod, szoba);
  return { szoba, jatekosId: hostId };
}

function tisztitNev(nev) {
  return motor.tisztitNev(nev);
}

function szobaCsatlakozas(kod, nev) {
  const szoba = szobak.get(String(kod || '').toUpperCase());
  if (!szoba) return { hiba: 'Nincs ilyen szoba.' };
  if (szoba.allapot === 'vege') return { hiba: 'Ez a játék már véget ért.' };
  if (szoba.jatekosok.size >= 40) return { hiba: 'A szoba megtelt.' };

  const id = ujAzonosito();
  szoba.jatekosok.set(id, { id, nev: tisztitNev(nev), pont: 0, host: false, csatlakozott: Date.now() });
  kikuld(szoba);
  return { szoba, jatekosId: id };
}

// ───────────────────────── jatekmenet ─────────────────────────

function jatekIndit(szoba) {
  if (szoba.allapot !== 'lobby') return { hiba: 'A játék már elindult.' };
  szoba.kor = 0;
  for (const j of szoba.jatekosok.values()) j.pont = 0;
  kovetkezoKor(szoba);
  return {};
}

function valaszthatoDalok(szoba) {
  return songs.filter((s) => !szoba.hasznaltDalok.has(s.id) && !szoba.kizartDalok.has(s.id));
}

function kovetkezoKor(szoba) {
  clearTimeout(szoba.idozito);
  szoba.valaszok.clear();

  if (szoba.kor >= szoba.beallitas.korokSzama) return jatekVege(szoba);

  const jeloltek = valaszthatoDalok(szoba);
  if (jeloltek.length === 0) return jatekVege(szoba);

  szoba.kor++;

  const kizart = new Set([...szoba.hasznaltDalok, ...szoba.kizartDalok]);
  const valasztas = motor.kovetkezoKerdes(songs, szoba.beallitas, szoba.kod, szoba.kor, kizart);
  if (!valasztas) return jatekVege(szoba);

  szoba.hasznaltDalok.add(valasztas.dal.id);
  szoba.aktualisKerdes = { ...valasztas.kerdes, dal: valasztas.dal };
  szoba.allapot = 'kerdes';
  szoba.kerdesIndult = Date.now();

  szoba.idozito = setTimeout(() => korKiertekel(szoba), szoba.beallitas.valaszIdoMp * 1000);
  kikuld(szoba);
}


function valaszAd(szoba, jatekosId, valaszIndex) {
  if (szoba.allapot !== 'kerdes') return { hiba: 'Most nem lehet válaszolni.' };
  if (!szoba.jatekosok.has(jatekosId)) return { hiba: 'Nem vagy a szobában.' };
  if (szoba.valaszok.has(jatekosId)) return { hiba: 'Már válaszoltál.' };

  const idx = Number(valaszIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx > 3) return { hiba: 'Érvénytelen válasz.' };

  szoba.valaszok.set(jatekosId, { valasz: idx, mikorMs: Date.now() - szoba.kerdesIndult });

  // Ha mindenki valaszolt, ne varjunk feleslegesen az idozitore.
  // A szoba beallitasa szerint ez ki is kapcsolhato: olyankor mindig kitelik
  // a teljes valaszido, akkor is, ha mar mindenki dontott.
  if (szoba.beallitas.mindenkiUtanTovabb && szoba.valaszok.size >= szoba.jatekosok.size) {
    clearTimeout(szoba.idozito);
    setTimeout(() => korKiertekel(szoba), 400); // rovid szunet, hogy latszodjon a "megvan"
  } else {
    kikuld(szoba);
  }
  return {};
}

function korKiertekel(szoba) {
  if (szoba.allapot !== 'kerdes') return;
  clearTimeout(szoba.idozito);

  // A pontozás a közös motorban van, hogy a Firestore-os játékban is
  // pontosan ugyanígy számoljunk.
  const valaszok = Object.fromEntries(szoba.valaszok);
  szoba.korEredmeny = motor.korKiertekel(
    [...szoba.jatekosok.values()],
    valaszok,
    szoba.aktualisKerdes.correctIndex,
    szoba.beallitas.valaszIdoMp * 1000,
    szoba.beallitas.alappont,
  );
  szoba.allapot = 'eredmeny';
  kikuld(szoba);
}

function jatekVege(szoba) {
  clearTimeout(szoba.idozito);
  szoba.allapot = 'vege';
  szoba.aktualisKerdes = null;
  kikuld(szoba);
}

/** A szobavezeto kidobja az aktualis dalt (pl. 45 mp utan sincs ertekelheto hang). */
function dalKidob(szoba) {
  if (!szoba.aktualisKerdes) return { hiba: 'Most nincs futó dal.' };
  szoba.kizartDalok.add(szoba.aktualisKerdes.dal.id);
  szoba.hasznaltDalok.add(szoba.aktualisKerdes.dal.id);
  szoba.kor--; // ez a kor nem szamit bele
  kovetkezoKor(szoba);
  return {};
}

function jatekosKilep(szoba, jatekosId) {
  szoba.jatekosok.delete(jatekosId);
  szoba.valaszok.delete(jatekosId);
  if (szoba.jatekosok.size === 0) {
    clearTimeout(szoba.idozito);
    szobak.delete(szoba.kod);
    return;
  }
  kikuld(szoba);
}

// ───────────────────────── allapot kikuldese (SSE) ─────────────────────────

/**
 * A kliensnek kuldott allapot. A `jatekosId` alapjan szemelyre szabjuk:
 * a helyes valaszt csak az eredmeny-fazisban tesszuk bele.
 */
function allapotNezet(szoba, jatekosId) {
  const jatekos = szoba.jatekosok.get(jatekosId);
  const nezet = {
    kod: szoba.kod,
    allapot: szoba.allapot,
    kor: szoba.kor,
    korokSzama: szoba.beallitas.korokSzama,
    beallitas: szoba.beallitas,
    host: jatekos ? jatekos.host : false,
    jatekosId,
    jatekosok: [...szoba.jatekosok.values()]
      .map((j) => ({ id: j.id, nev: j.nev, pont: j.pont, host: j.host }))
      .sort((a, b) => b.pont - a.pont),
    valaszoltakSzama: szoba.valaszok.size,
    sajatValasz: szoba.valaszok.has(jatekosId) ? szoba.valaszok.get(jatekosId).valasz : null,
  };

  if (szoba.allapot === 'kerdes' && szoba.aktualisKerdes) {
    const k = szoba.aktualisKerdes;
    // "Csak szinek" modban a kerdes szovege es a valaszok CSAK a szobavezetohoz
    // jutnak el - a tobbiek keszuleken meg a bongeszo konzoljabol sem olvashatok.
    const csakSzinek = szoba.beallitas.csakSzinek && !nezet.host;
    nezet.kerdes = {
      tipus: k.type,
      csakSzinek,
      szoveg: csakSzinek ? null : k.kerdes,
      valaszok: csakSzinek ? null : k.options,
      hatralevoMs: Math.max(0, szoba.beallitas.valaszIdoMp * 1000 - (Date.now() - szoba.kerdesIndult)),
      // Alapbol csak a szobavezeto kapja meg a videoId-t - nala szol a zene.
      // Ha a szoba beallitasaban be van kapcsolva, mindenki megkapja, es minden
      // keszuleken szol. Ilyenkor a videoId elmeletileg kiolvashato a bongeszobol,
      // de a dal maga ugyis hallhato - a helyes valasz tovabbra sem kerul ki.
      videoId: nezet.host || szoba.beallitas.mindenkiHallja ? k.dal.videoId : null,
      kezdesMp: szoba.beallitas.kezdesMp,
    };
  }

  if (szoba.allapot === 'eredmeny' && szoba.aktualisKerdes) {
    const k = szoba.aktualisKerdes;
    nezet.eredmeny = {
      helyesIndex: k.correctIndex,
      helyesValasz: k.correctAnswer,
      valaszok: k.options,
      szoveg: k.kerdes,
      dal: { eloado: k.dal.artist, cim: k.dal.title, ev: k.dal.year, videoId: k.dal.videoId },
      korEredmeny: szoba.korEredmeny || [],
      utolsoKor: szoba.kor >= szoba.beallitas.korokSzama,
    };
  }

  if (szoba.allapot === 'vege') {
    nezet.vegeredmeny = [...szoba.jatekosok.values()]
      .map((j) => ({ id: j.id, nev: j.nev, pont: j.pont }))
      .sort((a, b) => b.pont - a.pont);
  }

  return nezet;
}

function kikuld(szoba) {
  for (const figyelo of szoba.figyelok) {
    try {
      const adat = JSON.stringify(allapotNezet(szoba, figyelo.jatekosId));
      figyelo.res.write(`data: ${adat}\n\n`);
    } catch {
      szoba.figyelok.delete(figyelo);
    }
  }
}

function figyeloHozzaad(szoba, jatekosId, res) {
  const figyelo = { jatekosId, res };
  szoba.figyelok.add(figyelo);
  try {
    res.write(`data: ${JSON.stringify(allapotNezet(szoba, jatekosId))}\n\n`);
  } catch { /* a kapcsolat mar bezarult */ }
  return () => szoba.figyelok.delete(figyelo);
}

// ───────────────────────── publikus szobalista + takaritas ─────────────────────────

function publikusSzobak() {
  return [...szobak.values()]
    .filter((sz) => sz.beallitas.publikus && sz.allapot === 'lobby')
    .map((sz) => ({
      kod: sz.kod,
      jatekosok: sz.jatekosok.size,
      korok: sz.beallitas.korokSzama,
      tipusok: sz.beallitas.tipusok,
      hostNev: [...sz.jatekosok.values()].find((j) => j.host)?.nev || '',
    }));
}

setInterval(() => {
  const most = Date.now();
  for (const [kod, sz] of szobak) {
    if (most - sz.letrejott > SZOBA_ELAVUL_MS) {
      clearTimeout(sz.idozito);
      szobak.delete(kod);
    }
  }
}, 10 * 60 * 1000).unref();

module.exports = {
  songs,
  szobak,
  szobaLetrehoz,
  szobaCsatlakozas,
  jatekIndit,
  kovetkezoKor,
  valaszAd,
  korKiertekel,
  dalKidob,
  jatekosKilep,
  figyeloHozzaad,
  allapotNezet,
  publikusSzobak,
  ALAP_BEALLITAS,
};
