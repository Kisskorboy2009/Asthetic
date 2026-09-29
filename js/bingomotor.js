/* ═══════════════════════════════════════════════════════════════
   ASTHETIC — Rubik-Bingó: a játék szabályai

   Tiszta függvények, se hálózat, se időzítő. Böngészőben és Node-ban is fut
   (adatbazis/test_bingo.js ezt teszteli).

   A kártya 5×5 mező, minden szín pontosan ötször. A kerék minden körben
   kidob egy színt; aki eltalálja a dalt, ilyen színű mezőt ikszelhet. Aki
   lecsap és eltalálja, bármelyik mezőt. Nyer, akinek 5 X-e van egy vonalban.
   ═══════════════════════════════════════════════════════════════ */

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
  const JOKER = SZINEK.length;   // a kerék fehér mezője: bármelyik szín
  const MERET = 5;

  const ALAP_BEALLITAS = {
    mod: 'online',            // online: mindenki a saját telefonján | helyi: egy telefon körbeadva
    valaszIdoMp: 30,
    kezdesMp: 45,
    evTol: 1900,
    evIg: 2100,
    mitKell: 'mindketto',     // mindketto | barmelyik | cim | eloado
    elfogadas: 'normal',      // pontos | normal | laza
    lecsapas: true,
    lecsapIdoMp: 15,
    joker: false,             // van-e fehér (joker) mező a keréken
    mindenkiUtanTovabb: true,
    vezetoJatszik: true,
  };

  const KUSZOB = { pontos: 1, normal: 0.8, laza: 0.65 };

  /* ───────────── véletlen ───────────── */

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

  /* ───────────── beállítások ───────────── */

  function szamKorlat(ertek, min, max, alap) {
    const n = Number(ertek);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : alap;
  }

  function tisztitBeallitas(be) {
    be = be || {};
    const a = ALAP_BEALLITAS;
    const b = {
      mod: be.mod === 'helyi' ? 'helyi' : 'online',
      valaszIdoMp: szamKorlat(be.valaszIdoMp, 10, 120, a.valaszIdoMp),
      kezdesMp: szamKorlat(be.kezdesMp, 0, 300, a.kezdesMp),
      evTol: szamKorlat(be.evTol, 1900, 2100, a.evTol),
      evIg: szamKorlat(be.evIg, 1900, 2100, a.evIg),
      mitKell: ['mindketto', 'barmelyik', 'cim', 'eloado'].includes(be.mitKell) ? be.mitKell : a.mitKell,
      elfogadas: Object.prototype.hasOwnProperty.call(KUSZOB, be.elfogadas) ? be.elfogadas : a.elfogadas,
      lecsapas: be.lecsapas === undefined ? a.lecsapas : Boolean(be.lecsapas),
      lecsapIdoMp: szamKorlat(be.lecsapIdoMp, 5, 60, a.lecsapIdoMp),
      joker: Boolean(be.joker),
      mindenkiUtanTovabb: be.mindenkiUtanTovabb === undefined ? a.mindenkiUtanTovabb : Boolean(be.mindenkiUtanTovabb),
      vezetoJatszik: be.vezetoJatszik === undefined ? a.vezetoJatszik : Boolean(be.vezetoJatszik),
    };
    if (b.evTol > b.evIg) [b.evTol, b.evIg] = [b.evIg, b.evTol];
    return b;
  }

  /* ───────────── kártya ───────────── */

  /** 25 mező, minden szín pontosan ötször, összekeverve. */
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

  /**
   * Mely mezőket ikszelheti a játékos. Színjognál a kidobott színűeket; ha
   * abból már mind be van ikszelve, bármelyik üreset — a jog nem vész el.
   */
  function jelolhetoMezok(kartya, jelolt, jog, szin) {
    const uresek = kartya.map((_, i) => i).filter((i) => !jelolt[i]);
    if (jog === 'joker' || szin === JOKER) return uresek;
    const szinesek = uresek.filter((i) => kartya[i] === szin);
    return szinesek.length ? szinesek : uresek;
  }

  /** Ha valaki nem választ időben, helyette ez dönt: a vonalakhoz legtöbbet adó mező. */
  function legjobbMezo(kartya, jelolt, jog, szin) {
    const jeloltek = jelolhetoMezok(kartya, jelolt, jog, szin);
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

  /* ───────────── tippek ellenőrzése ───────────── */

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

  /**
   * Az előadó elfogadható alakjai: a teljes név, a „feat.” előtti rész, és ha
   * nem pontos a mód, a közreműködők külön is. Külön tagként csak legalább
   * kétszavas nevet fogadunk el: a „Les Paul & Mary Ford”-ból a „Mary Ford”
   * jó, de a „Mumford & Sons”-ból a „Sons” nem.
   */
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

  /**
   * @param tipp  { eloado, cim }
   * @param dal   { artist, title, titleOriginal } (a songs.json alakja)
   */
  function tippErtekel(tipp, dal, beallitas) {
    const b = beallitas || ALAP_BEALLITAS;
    const eloadoJo = egyezik(tipp && tipp.eloado, eloadoAlakok(dal.artist, b.elfogadas), b.elfogadas);
    const cimJo = egyezik(tipp && tipp.cim, cimAlakok(dal.title, dal.titleOriginal), b.elfogadas);
    let jo;
    if (b.mitKell === 'barmelyik') jo = eloadoJo || cimJo;
    else if (b.mitKell === 'cim') jo = cimJo;
    else if (b.mitKell === 'eloado') jo = eloadoJo;
    else jo = eloadoJo && cimJo;
    return { eloadoJo, cimJo, jo };
  }

  /* ───────────── dalválasztás ───────────── */

  function dalValaszt(songs, beallitas, kizartIdk) {
    const kizart = kizartIdk instanceof Set ? kizartIdk : new Set(kizartIdk || []);
    const jeloltek = songs.filter((s) =>
      !kizart.has(s.id) && s.videoId
      && Number.isFinite(s.year) && s.year >= beallitas.evTol && s.year <= beallitas.evIg);
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
      return u.protocol === 'https:' && /(^|.)googleusercontent.com$/.test(u.hostname) ? u.href.slice(0, 500) : null;
    } catch { return null; }
  }

  function tisztitTipp(s) {
    return String(s || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  return {
    SZINEK,
    JOKER,
    MERET,
    VONALAK,
    ALAP_BEALLITAS,
    KUSZOB,
    veletlenEgesz,
    kever,
    tisztitBeallitas,
    kartyaKeszit,
    teljesVonalak,
    bingoE,
    jelolhetoMezok,
    legjobbMezo,
    szinSorsol,
    normalizal,
    levenshtein,
    hasonlosag,
    eloadoAlakok,
    cimAlakok,
    tippErtekel,
    dalValaszt,
    tisztitNev,
    tisztitKep,
    tisztitTipp,
  };
});
