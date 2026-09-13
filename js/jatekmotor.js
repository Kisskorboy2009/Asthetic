/* ═══════════════════════════════════════════════════════════════
   ASTHETIC — a Kvízcsata közös játéklogikája

   Ez a fájl mindkét helyen fut:
     • Node-ban  (kahoot-server.js, helyi hálózaton játszva)
     • böngészőben (a szobavezetőnél, amikor Firestore-on megy a játék)

   Csak tiszta függvények vannak benne — se hálózat, se időzítő, se állapot.
   Így a pontozás és a kérdésválasztás garantáltan ugyanaz a két úton, és a
   meglévő tesztek (adatbazis/test_pontozas.js) mindkettőt lefedik.
   ═══════════════════════════════════════════════════════════════ */

(function (globalis, keszit) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = keszit(require('../adatbazis/question_engine.js'));
  } else {
    globalis.AstheticMotor = keszit(globalis.AstheticKerdesek);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (kerdesMotor) {
  const { generateQuestion, pickType, makeRng } = kerdesMotor;

  const ALAP_BEALLITAS = {
    korokSzama: 10,        // hány dal legyen egy játékban
    valaszIdoMp: 30,       // ennyi ideig szól a dal / lehet válaszolni
    kezdesMp: 45,          // a dal hányadik másodperctől induljon
    tipusok: ['year', 'artist', 'title'],
    publikus: false,
    mindenkiHallja: false,  // szoljon-e a dal minden jatekos keszuleken
    alappont: 1000,        // helyes válaszért járó maximum
  };

  const KOD_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  // 0/O és 1/I kihagyva

  /** Kriptográfiailag erős véletlen egész 0..max-1 között, Node-ban és böngészőben is. */
  function veletlenEgesz(max) {
    const kripto = typeof crypto !== 'undefined' && crypto.getRandomValues
      ? crypto
      : (typeof require === 'function' ? require('crypto').webcrypto : null);

    if (kripto && kripto.getRandomValues) {
      // Elutasításos mintavétel, hogy ne torzuljon az eloszlás.
      const hatar = Math.floor(0xffffffff / max) * max;
      const tomb = new Uint32Array(1);
      let ertek;
      do {
        kripto.getRandomValues(tomb);
        ertek = tomb[0];
      } while (ertek >= hatar);
      return ertek % max;
    }
    return Math.floor(Math.random() * max);
  }

  function ujKod(foglaltE) {
    let kod;
    do {
      kod = Array.from({ length: 4 }, () => KOD_ABC[veletlenEgesz(KOD_ABC.length)]).join('');
    } while (typeof foglaltE === 'function' && foglaltE(kod));
    return kod;
  }

  function ujAzonosito() {
    const tomb = new Uint8Array(9);
    const kripto = typeof crypto !== 'undefined' && crypto.getRandomValues
      ? crypto
      : (typeof require === 'function' ? require('crypto').webcrypto : null);
    if (kripto && kripto.getRandomValues) kripto.getRandomValues(tomb);
    else for (let i = 0; i < tomb.length; i++) tomb[i] = Math.floor(Math.random() * 256);

    let s = '';
    for (const b of tomb) s += String.fromCharCode(b);
    return btoaBiztos(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function btoaBiztos(s) {
    if (typeof btoa === 'function') return btoa(s);
    return Buffer.from(s, 'binary').toString('base64');
  }

  function tisztitNev(nev) {
    const n = String(nev || '').trim().replace(/\s+/g, ' ').slice(0, 20);
    return n || 'Névtelen';
  }

  function tisztitBeallitas(be) {
    const b = Object.assign({}, ALAP_BEALLITAS);
    be = be || {};

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
    b.mindenkiHallja = Boolean(be.mindenkiHallja);
    return b;
  }

  /** Determinisztikus seed: ugyanaz a szoba + kör + dal mindig ugyanazt a kérdést adja. */
  function hashSeed(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  /**
   * Kiválaszt egy dalt és kérdést a következő körhöz.
   * @returns {{dal, kerdes}|null}  null, ha nincs több játszható dal
   */
  function kovetkezoKerdes(songs, beallitas, kod, korSorszam, kizartIdk) {
    const kizart = kizartIdk instanceof Set ? kizartIdk : new Set(kizartIdk || []);
    const jeloltek = songs.filter((s) => !kizart.has(s.id));
    if (jeloltek.length === 0) return null;

    const dal = jeloltek[veletlenEgesz(jeloltek.length)];
    const seed = hashSeed(kod + ':' + korSorszam + ':' + dal.id);
    const rng = makeRng(seed);
    const tipus = pickType(beallitas.tipusok, rng);

    let kerdes = generateQuestion(dal, songs, tipus, seed);
    if (!kerdes) {
      // Elméletileg nem fordulhat elő; ha mégis, próbáljunk másik típust.
      for (const t of ['year', 'artist', 'title']) {
        kerdes = generateQuestion(dal, songs, t, seed);
        if (kerdes) break;
      }
    }
    if (!kerdes) return null;

    return { dal, kerdes };
  }

  /**
   * Kahoot-szerű pontozás: az azonnali válasz ~teljes pontot ér, az idő végén ~felét.
   * Így több jó válasz esetén automatikusan a gyorsabb kap többet.
   */
  function pontSzamit(mikorMs, idoKeretMs, alappont) {
    const arany = Math.min(1, Math.max(0, mikorMs / idoKeretMs));
    return Math.round(alappont * (1 - arany / 2));
  }

  /**
   * Egy kör kiértékelése.
   * @param jatekosok  [{id, nev, pont}]  — a pont helyben frissül
   * @param valaszok   { [jatekosId]: {valasz, mikorMs} }
   * @returns a kör eredménylistája, gyorsaság szerint rendezve
   */
  function korKiertekel(jatekosok, valaszok, helyesIndex, idoKeretMs, alappont) {
    const korEredmeny = [];

    for (const j of jatekosok) {
      const v = valaszok[j.id];
      const jo = Boolean(v) && v.valasz === helyesIndex;
      const szerzett = jo ? pontSzamit(v.mikorMs, idoKeretMs, alappont) : 0;

      j.pont = (j.pont || 0) + szerzett;
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

    korEredmeny.sort((a, b) => b.szerzett - a.szerzett || (a.idoMs === null ? 1e9 : a.idoMs) - (b.idoMs === null ? 1e9 : b.idoMs));
    return korEredmeny;
  }

  return {
    ALAP_BEALLITAS,
    ujKod,
    ujAzonosito,
    tisztitNev,
    tisztitBeallitas,
    hashSeed,
    kovetkezoKerdes,
    pontSzamit,
    korKiertekel,
    veletlenEgesz,
  };
});
