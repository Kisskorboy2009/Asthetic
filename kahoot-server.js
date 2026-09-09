// Asthetic - Kahoot-mod szerveroldali jatekmotor
//
// Szobakezeles, korok, pontozas. Kulso csomag nelkul: a valos ideju frissiteseket
// SSE-vel (Server-Sent Events) toljuk ki a jatekosoknak, a muveleteket sima POST-tal.
//
// FONTOS biztonsagi elv: a helyes valasz indexet SOHA nem kuldjuk ki a kerdes
// alatt - csak a kiertekeleskor. Kulonben a bongeszo konzoljabol lattszana.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { generateQuestion, pickType, makeRng } = require('./adatbazis/question_engine.js');

const songs = JSON.parse(fs.readFileSync(path.join(__dirname, 'adatbazis', 'songs.json'), 'utf8'));

// ───────────────────────── alapertelmezett szobabeallitasok ─────────────────────────

const ALAP_BEALLITAS = {
  korokSzama: 10,        // hany dal legyen egy jatekban
  valaszIdoMp: 30,       // ennyi ideig szol a dal / lehet valaszolni
  kezdesMp: 45,          // a dal hanyadik masodperctol induljon
  tipusok: ['year', 'artist', 'title'],
  publikus: false,
  alappont: 1000,        // helyes valaszert jaro maximum
};

const SZOBA_ELAVUL_MS = 4 * 60 * 60 * 1000; // 4 ora utan takaritunk

// ───────────────────────── segedfuggvenyek ─────────────────────────

const szobak = new Map();

function ujKod() {
  // Osszetevesztheto karakterek (0/O, 1/I) kihagyva
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let kod;
  do {
    kod = Array.from({ length: 4 }, () => abc[crypto.randomInt(abc.length)]).join('');
  } while (szobak.has(kod));
  return kod;
}

function ujAzonosito() {
  return crypto.randomBytes(9).toString('base64url');
}

function tisztitBeallitas(be = {}) {
  const b = { ...ALAP_BEALLITAS };

  const korok = Number(be.korokSzama);
  if (Number.isFinite(korok)) b.korokSzama = Math.min(50, Math.max(1, Math.round(korok)));

  const ido = Number(be.valaszIdoMp);
  if (Number.isFinite(ido)) b.valaszIdoMp = Math.min(120, Math.max(5, Math.round(ido)));

  const kezdes = Number(be.kezdesMp);
  if (Number.isFinite(kezdes)) b.kezdesMp = Math.min(300, Math.max(0, Math.round(kezdes)));

  const alappont = Number(be.alappont);
  if (Number.isFinite(alappont)) b.alappont = Math.min(5000, Math.max(100, Math.round(alappont)));

  if (Array.isArray(be.tipusok)) {
    const engedett = be.tipusok.filter((t) => ['year', 'artist', 'title'].includes(t));
    if (engedett.length) b.tipusok = engedett;
  }

  b.publikus = Boolean(be.publikus);
  return b;
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
  const n = String(nev || '').trim().replace(/\s+/g, ' ').slice(0, 20);
  return n || 'Névtelen';
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
  const dal = jeloltek[crypto.randomInt(jeloltek.length)];
  szoba.hasznaltDalok.add(dal.id);

  // A seed a szoba kodjabol es a kor sorszamabol all -> minden kliens ugyanazt latja,
  // es ugyanaz a jatek ujrajatszva is ugyanazt adna.
  const seed = hashSeed(szoba.kod + ':' + szoba.kor + ':' + dal.id);
  const rng = makeRng(seed);
  const tipus = pickType(szoba.beallitas.tipusok, rng);

  let kerdes = generateQuestion(dal, songs, tipus, seed);
  if (!kerdes) {
    // Ha valamiert nem sikerult (elmeletileg nem fordulhat elo), probaljunk mas tipust
    for (const t of ['year', 'artist', 'title']) {
      kerdes = generateQuestion(dal, songs, t, seed);
      if (kerdes) break;
    }
  }
  if (!kerdes) return kovetkezoKor(szoba); // vegso esetben ugrunk egyet

  szoba.aktualisKerdes = { ...kerdes, dal };
  szoba.allapot = 'kerdes';
  szoba.kerdesIndult = Date.now();

  szoba.idozito = setTimeout(() => korKiertekel(szoba), szoba.beallitas.valaszIdoMp * 1000);
  kikuld(szoba);
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function valaszAd(szoba, jatekosId, valaszIndex) {
  if (szoba.allapot !== 'kerdes') return { hiba: 'Most nem lehet válaszolni.' };
  if (!szoba.jatekosok.has(jatekosId)) return { hiba: 'Nem vagy a szobában.' };
  if (szoba.valaszok.has(jatekosId)) return { hiba: 'Már válaszoltál.' };

  const idx = Number(valaszIndex);
  if (!Number.isInteger(idx) || idx < 0 || idx > 3) return { hiba: 'Érvénytelen válasz.' };

  szoba.valaszok.set(jatekosId, { valasz: idx, mikorMs: Date.now() - szoba.kerdesIndult });

  // Ha mindenki valaszolt, ne varjunk feleslegesen az idozitore
  if (szoba.valaszok.size >= szoba.jatekosok.size) {
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

  const helyes = szoba.aktualisKerdes.correctIndex;
  const idoKeret = szoba.beallitas.valaszIdoMp * 1000;
  const alappont = szoba.beallitas.alappont;

  const korEredmeny = [];
  for (const j of szoba.jatekosok.values()) {
    const v = szoba.valaszok.get(j.id);
    let szerzett = 0;
    const jo = v && v.valasz === helyes;

    if (jo) {
      // Kahoot-szeru pontozas: azonnali valasz ~teljes pont, az ido vegen ~fele.
      // Igy tobb jo valasz eseten automatikusan a gyorsabb kap tobbet.
      const arany = Math.min(1, Math.max(0, v.mikorMs / idoKeret));
      szerzett = Math.round(alappont * (1 - arany / 2));
    }

    j.pont += szerzett;
    korEredmeny.push({
      id: j.id,
      nev: j.nev,
      valaszolt: Boolean(v),
      valasz: v ? v.valasz : null,
      jo,
      szerzett,
      idoMs: v ? v.mikorMs : null,
      osszpont: j.pont,
    });
  }

  korEredmeny.sort((a, b) => b.szerzett - a.szerzett || (a.idoMs ?? 1e9) - (b.idoMs ?? 1e9));
  szoba.korEredmeny = korEredmeny;
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
    nezet.kerdes = {
      tipus: k.type,
      szoveg: k.kerdes,
      valaszok: k.options,
      hatralevoMs: Math.max(0, szoba.beallitas.valaszIdoMp * 1000 - (Date.now() - szoba.kerdesIndult)),
      // A videoId-t csak a szobavezeto kapja meg - nala szol a zene.
      videoId: nezet.host ? k.dal.videoId : null,
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
