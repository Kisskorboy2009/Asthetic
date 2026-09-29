// Rubik-Bingó – a játék szabályai.
//
// Tiszta függvények (se hálózat, se időzítő), böngészőben és Node-ban is
// fut; az adatbazis/test_bingo.js teszteli.
//
// A kártya 5×5 mező, minden szín pontosan ötször. A kerék minden körben
// kidob egy színt; aki eltalálja a dalt, ilyen színű mezőt ikszelhet, aki
// lecsap és eltalálja, bármelyiket.

(function (globalis, keszit) {
  if (typeof module !== 'undefined' && module.exports) module.exports = keszit();
  else globalis.AstheticBingo = keszit();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SZINEK = [
    { kulcs: 'piros', nev: 'piros', hex: '#C62828' },
    { kulcs: 'kek', nev: 'kék', hex: '#1565C0' },
    { kulcs: 'zold', nev: 'zöld', hex: '#2E7D32' },
    { kulcs: 'sarga', nev: 'sárga', hex: '#F2C318' },
    { kulcs: 'narancs', nev: 'narancs', hex: '#E8710A' },
  ];
  const JOKER = SZINEK.length; // a kerék fehér mezője
  const MERET = 5;

  const MEZOK = ['eloado', 'cim', 'ev'];
  const NYERES = ['vonal', 'ketVonal', 'sarkok', 'teli'];
  const SARKOK = [0, 4, 20, 24];

  const ALAP_BEALLITAS = {
    mod: 'online',              // online | helyi (egy telefon körbeadva)
    valaszIdoMp: 30,
    kezdesMp: 45,
    evTol: 1900,
    evIg: 2100,
    tippelheto: ['eloado', 'cim', 'ev'],
    mitKell: 'mindegyik',       // mindegyik | ketto | barmelyik
    evTures: 1,                 // ennyi év eltérés még jónak számít
    elfogadas: 'normal',        // pontos | normal | laza
    nyeres: 'vonal',            // vonal | ketVonal | sarkok | teli
    nyelv: 'mind',              // mind | hu | kulfoldi
    maxKor: 0,                  // 0 = amíg valaki nem nyer
    lecsapas: true,
    lecsapIdoMp: 15,
    joker: false,
    mindenkiUtanTovabb: true,
    vezetoJatszik: true,
  };

  const KUSZOB = { pontos: 1, normal: 0.8, laza: 0.65 };

  // véletlen

  function kripto() {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) return crypto;
    if (typeof require === 'function') return require('crypto').webcrypto;
    return null;
  }

  function veletlenEgesz(max) {
    const k = kripto();
    if (!k) return Math.floor(Math.random() * max);
    const hatar = Math.floor(0xffffffff / max) * max;
    const tomb = new Uint32Array(1);
    do { k.getRandomValues(tomb); } while (tomb[0] >= hatar);
    return tomb[0] % max;
  }

  function kever(tomb, rnd = veletlenEgesz) {
    for (let i = tomb.length - 1; i > 0; i--) {
      const j = rnd(i + 1);
      [tomb[i], tomb[j]] = [tomb[j], tomb[i]];
    }
    return tomb;
  }

  // beállítások

  function szamKorlat(ertek, min, max, alap) {
    const n = Number(ertek);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : alap;
  }

  // A korábbi (évszám nélküli) szobák beállítását is értelmezzük.
  const REGI_MITKELL = {
    mindketto: { tippelheto: ['eloado', 'cim'], mitKell: 'mindegyik' },
    cim: { tippelheto: ['cim'], mitKell: 'mindegyik' },
    eloado: { tippelheto: ['eloado'], mitKell: 'mindegyik' },
  };

  function tisztitBeallitas(be) {
    be = { ...(be || {}) };
    const a = ALAP_BEALLITAS;
    if (REGI_MITKELL[be.mitKell] && !Array.isArray(be.tippelheto)) Object.assign(be, REGI_MITKELL[be.mitKell]);

    let tippelheto = Array.isArray(be.tippelheto) ? MEZOK.filter((m) => be.tippelheto.includes(m)) : a.tippelheto.slice();
    if (!tippelheto.length) tippelheto = a.tippelheto.slice();

    const b = {
      mod: be.mod === 'helyi' ? 'helyi' : 'online',
      valaszIdoMp: szamKorlat(be.valaszIdoMp, 10, 120, a.valaszIdoMp),
      kezdesMp: szamKorlat(be.kezdesMp, 0, 300, a.kezdesMp),
      evTol: szamKorlat(be.evTol, 1900, 2100, a.evTol),
      evIg: szamKorlat(be.evIg, 1900, 2100, a.evIg),
      tippelheto,
      mitKell: ['mindegyik', 'ketto', 'barmelyik'].includes(be.mitKell) ? be.mitKell : a.mitKell,
      evTures: szamKorlat(be.evTures, 0, 10, a.evTures),
      elfogadas: Object.prototype.hasOwnProperty.call(KUSZOB, be.elfogadas) ? be.elfogadas : a.elfogadas,
      nyeres: NYERES.includes(be.nyeres) ? be.nyeres : a.nyeres,
      nyelv: ['mind', 'hu', 'kulfoldi'].includes(be.nyelv) ? be.nyelv : a.nyelv,
      maxKor: szamKorlat(be.maxKor, 0, 100, a.maxKor),
      lecsapas: be.lecsapas === undefined ? a.lecsapas : Boolean(be.lecsapas),
      lecsapIdoMp: szamKorlat(be.lecsapIdoMp, 5, 60, a.lecsapIdoMp),
      joker: Boolean(be.joker),
      mindenkiUtanTovabb: be.mindenkiUtanTovabb === undefined ? a.mindenkiUtanTovabb : Boolean(be.mindenkiUtanTovabb),
      vezetoJatszik: be.vezetoJatszik === undefined ? a.vezetoJatszik : Boolean(be.vezetoJatszik),
    };
    if (b.evTol > b.evIg) [b.evTol, b.evIg] = [b.evIg, b.evTol];
    // Két mezőnél a „legalább kettő” ugyanaz, mint a „mindegyik”; egynél
    // pedig csak az az egy számít.
    if (b.mitKell === 'ketto' && b.tippelheto.length < 3) b.mitKell = 'mindegyik';
    if (b.tippelheto.length === 1) b.mitKell = 'mindegyik';
    return b;
  }

  // kártya

  function kartyaKeszit(rnd) {
    const mezok = [];
    for (let szin = 0; szin < SZINEK.length; szin++) {
      for (let i = 0; i < MERET; i++) mezok.push(szin);
    }
    return kever(mezok, rnd);
  }

  const VONALAK = (() => {
    const v = [];
    for (let s = 0; s < MERET; s++) v.push([0, 1, 2, 3, 4].map((o) => s * MERET + o));
    for (let o = 0; o < MERET; o++) v.push([0, 1, 2, 3, 4].map((s) => s * MERET + o));
    v.push([0, 6, 12, 18, 24]);
    v.push([4, 8, 12, 16, 20]);
    return v;
  })();

  function teljesVonalak(jelolt) {
    return VONALAK.filter((vonal) => vonal.every((i) => jelolt[i]));
  }

  function bingoE(jelolt) {
    return teljesVonalak(jelolt).length > 0;
  }

  /** Kirakta-e a játékos a szobában beállított alakzatot. */
  function nyertE(jelolt, nyeres = 'vonal') {
    if (!jelolt) return false;
    if (nyeres === 'ketVonal') return teljesVonalak(jelolt).length >= 2;
    if (nyeres === 'sarkok') return SARKOK.every((i) => jelolt[i]);
    if (nyeres === 'teli') return jelolt.every(Boolean);
    return bingoE(jelolt);
  }

  /** A kiemelendő mezők a végén (a nyerő vonal, a sarkok vagy az egész kártya). */
  function nyeroMezok(jelolt, nyeres = 'vonal') {
    if (nyeres === 'sarkok') return SARKOK.filter((i) => jelolt[i]);
    if (nyeres === 'teli') return jelolt.map((x, i) => (x ? i : -1)).filter((i) => i >= 0);
    return [...new Set(teljesVonalak(jelolt).flat())];
  }

  /**
   * Mennyire járt közel a nyeréshez – ez dönt, ha a körök elfogynak.
   * Egy vonalnál a legjobb vonal X-ei, kettőnél a két legjobbé, sarkoknál a
   * megszerzett sarkok, teli kártyánál az összes X.
   */
  function haladas(jelolt, nyeres = 'vonal') {
    if (!jelolt) return 0;
    const vonalak = VONALAK.map((v) => v.filter((i) => jelolt[i]).length).sort((x, y) => y - x);
    if (nyeres === 'ketVonal') return vonalak[0] + vonalak[1];
    if (nyeres === 'sarkok') return SARKOK.filter((i) => jelolt[i]).length;
    if (nyeres === 'teli') return jelolt.filter(Boolean).length;
    return vonalak[0];
  }

  // Színjognál a kidobott színű mezők jelölhetők; ha abból már mind be van
  // ikszelve, bármelyik üres – a jog nem vész el.
  function jelolhetoMezok(kartya, jelolt, jog, szin) {
    const uresek = kartya.map((_, i) => i).filter((i) => !jelolt[i]);
    if (jog === 'joker' || szin === JOKER) return uresek;
    const szinesek = uresek.filter((i) => kartya[i] === szin);
    return szinesek.length ? szinesek : uresek;
  }

  /** Ha valaki nem választ időben, a gép ikszel helyette: ami a legtöbbet ér. */
  function legjobbMezo(kartya, jelolt, jog, szin, nyeres = 'vonal') {
    const jeloltek = jelolhetoMezok(kartya, jelolt, jog, szin);
    if (nyeres === 'sarkok') {
      const sarok = jeloltek.find((i) => SARKOK.includes(i));
      if (sarok !== undefined) return sarok;
    }
    let legjobb = null;
    let legjobbPont = -1;
    for (const i of jeloltek) {
      let pont = 0;
      for (const vonal of VONALAK) {
        if (!vonal.includes(i)) continue;
        const megvan = vonal.filter((m) => jelolt[m]).length;
        pont += (megvan + 1) * (megvan + 1);
      }
      if (pont > legjobbPont) { legjobbPont = pont; legjobb = i; }
    }
    return legjobb;
  }

  function szinSorsol(beallitas, rnd = veletlenEgesz) {
    return rnd(SZINEK.length + (beallitas && beallitas.joker ? 1 : 0));
  }

  // tippek ellenőrzése

  function ekezetNelkul(s) {
    return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }

  function normalizal(s) {
    return ekezetNelkul(s)
      .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^(the|a|az) /, '');
  }

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let elozo = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const sor = [i];
      for (let j = 1; j <= b.length; j++) {
        const csere = a[i - 1] === b[j - 1] ? 0 : 1;
        sor[j] = Math.min(elozo[j] + 1, sor[j - 1] + 1, elozo[j - 1] + csere);
      }
      elozo = sor;
    }
    return elozo[b.length];
  }

  function hasonlosag(a, b) {
    if (!a || !b) return 0;
    return 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  }

  const TARSSZERZO = /\s*(?:\bfeat\b\.?|\bft\b\.?|\bfeaturing\b|\bwith\b|\bvs\b\.?|&|\/|\bes\b|\band\b)\s*/;

  // Az előadó elfogadható alakjai: a teljes név, a „feat.” előtti rész, és ha
  // nem pontos a mód, a közreműködők külön is – de csak legalább kétszavas
  // név: a „Les Paul & Mary Ford”-ból a „Mary Ford” jó, a „Mumford & Sons”-ból
  // a „Sons” nem.
  function eloadoAlakok(eloado, elfogadas) {
    const nyers = ekezetNelkul(eloado);
    const alakok = new Set([normalizal(nyers)]);
    alakok.add(normalizal(nyers.split(/\s*(?:\bfeat\b\.?|\bft\b\.?|\bfeaturing\b)\s*/)[0]));
    if (elfogadas !== 'pontos') {
      for (const resz of nyers.split(TARSSZERZO)) {
        const n = normalizal(resz);
        if (n.includes(' ') && n.length >= 5) alakok.add(n);
      }
    }
    alakok.delete('');
    return [...alakok];
  }

  function cimAlakok(cim, eredetiCim) {
    const alakok = new Set();
    for (const c of [cim, eredetiCim]) {
      if (!c) continue;
      alakok.add(normalizal(c));
      alakok.add(normalizal(String(c).split(/\s+-\s+/)[0]));
      alakok.add(normalizal(String(c).split('/')[0]));
    }
    alakok.delete('');
    return [...alakok];
  }

  function egyezik(tipp, alakok, elfogadas) {
    const t = normalizal(tipp);
    if (!t) return false;
    const kuszob = KUSZOB[elfogadas] || KUSZOB.normal;
    return alakok.some((a) => (kuszob >= 1 ? a === t : hasonlosag(a, t) >= kuszob));
  }

  function evSzam(ertek) {
    const n = parseInt(String(ertek ?? '').replace(/\D/g, ''), 10);
    return Number.isFinite(n) && n >= 1000 && n <= 2999 ? n : null;
  }

  /**
   * @param tipp  { eloado, cim, ev }
   * @param dal   { artist, title, titleOriginal, year } (a songs.json alakja)
   */
  function tippErtekel(tipp, dal, beallitas) {
    const b = tisztitBeallitas(beallitas || ALAP_BEALLITAS);
    const t = tipp || {};
    const eloadoJo = egyezik(t.eloado, eloadoAlakok(dal.artist, b.elfogadas), b.elfogadas);
    const cimJo = egyezik(t.cim, cimAlakok(dal.title, dal.titleOriginal), b.elfogadas);
    const ev = evSzam(t.ev);
    const evJo = ev !== null && Number.isFinite(dal.year) && Math.abs(ev - dal.year) <= b.evTures;

    const talalat = { eloado: eloadoJo, cim: cimJo, ev: evJo };
    const jok = b.tippelheto.filter((m) => talalat[m]).length;
    const kell = b.mitKell === 'barmelyik' ? 1 : b.mitKell === 'ketto' ? 2 : b.tippelheto.length;
    return { eloadoJo, cimJo, evJo, jok, jo: jok >= kell };
  }

  // dalválasztás

  function dalValaszt(songs, beallitas, kizartIdk) {
    const kizart = kizartIdk instanceof Set ? kizartIdk : new Set(kizartIdk || []);
    const nyelv = beallitas.nyelv || 'mind';
    const jeloltek = songs.filter((s) =>
      !kizart.has(s.id) && s.videoId
      && Number.isFinite(s.year) && s.year >= beallitas.evTol && s.year <= beallitas.evIg
      && (nyelv === 'mind' || (nyelv === 'hu' ? s.nyelv === 'hu' : s.nyelv !== 'hu')));
    if (!jeloltek.length) return null;
    return jeloltek[veletlenEgesz(jeloltek.length)];
  }

  function tisztitNev(nev) {
    return String(nev || '').trim().replace(/\s+/g, ' ').slice(0, 20) || 'Névtelen';
  }

  /** Csak a Google saját képszerveréről fogadunk el profilképet. */
  function tisztitKep(url) {
    try {
      const u = new URL(String(url || ''));
      return u.protocol === 'https:' && /(^|\.)googleusercontent\.com$/.test(u.hostname) ? u.href.slice(0, 500) : null;
    } catch { return null; }
  }

  function tisztitTipp(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  return {
    SZINEK,
    JOKER,
    MERET,
    MEZOK,
    NYERES,
    SARKOK,
    VONALAK,
    ALAP_BEALLITAS,
    KUSZOB,
    veletlenEgesz,
    kever,
    tisztitBeallitas,
    kartyaKeszit,
    teljesVonalak,
    bingoE,
    nyertE,
    nyeroMezok,
    haladas,
    jelolhetoMezok,
    legjobbMezo,
    szinSorsol,
    normalizal,
    levenshtein,
    hasonlosag,
    eloadoAlakok,
    cimAlakok,
    evSzam,
    tippErtekel,
    dalValaszt,
    tisztitNev,
    tisztitKep,
    tisztitTipp,
  };
});
