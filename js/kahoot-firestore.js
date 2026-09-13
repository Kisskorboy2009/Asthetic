/* ═══════════════════════════════════════════════════════════════
   ASTHETIC — Kvízcsata Firestore-on, kiszolgáló nélkül

   A Firebase ingyenes csomagján nem futtatható saját kiszolgáló, ezért a
   játékvezetés a SZOBAVEZETŐ böngészőjében fut: ő választja a dalt, generálja a
   kérdést, méri a kört és értékel. A többiek csak olvassák a szoba állapotát, és
   beírják a saját válaszukat. (A szobavezetőnél amúgy is nála szól a zene, tehát
   neki eddig is nyitva kellett tartania az oldalt.)

   Adatszerkezet — a jogosultsági szabályok erre épülnek (firestore.rules):

     szobak/{kod}                     nyilvános állapot; ÍRNI csak a szobavezető tud
     szobak/{kod}/titkos/host         videoId + helyes válasz — CSAK a szobavezető olvashatja
     szobak/{kod}/jelentkezok/{uid}   "be szeretnék lépni, a nevem X"
     szobak/{kod}/valaszok/{uid}      egy játékos válasza — csak ő és a szobavezető

   Így a helyes válasz a kérdés alatt sehogy sem szedhető ki a böngészőből,
   ugyanúgy, ahogy a szerveres változatban.
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const BEALLITAS = {
    apiKey: 'AIzaSyBiBhnlOmE8Fyw5s_PxGVzTesqITWfZkSg',
    authDomain: 'asthetic-798d1.firebaseapp.com',
    projectId: 'asthetic-798d1',
    storageBucket: 'asthetic-798d1.firebasestorage.app',
    messagingSenderId: '494747985041',
    appId: '1:494747985041:web:b011d8790b5cd2511acb30',
  };

  const SZOBA_ELAVUL_PERC = 90;   // ennél régebben frissült szoba nem kerül a listába
  const MAX_JATEKOS = 40;

  let db = null;
  let uid = null;
  let songs = null;
  let motor = null;

  /* ───────────────────────── indulás ───────────────────────── */

  async function init() {
    if (db) return;
    if (typeof firebase === 'undefined') throw new Error('A Firebase nem töltődött be.');

    if (!firebase.apps.length) firebase.initializeApp(BEALLITAS);
    db = firebase.firestore();

    // A Firestore alapesetben streamelő kapcsolatot nyit. Az Android WebView-ban
    // ez gyakran nem jön létre, és a játék némán "offline" marad. Az automatikus
    // felismerés ilyenkor hosszú lekérdezésre vált. Böngészőben nincs hatása.
    try {
      db.settings({ experimentalAutoDetectLongPolling: true, merge: true });
    } catch { /* ha már el is indult a kapcsolat, marad az alapértelmezés */ }

    const belepes = await firebase.auth().signInAnonymously();
    uid = belepes.user.uid;

    motor = window.AstheticMotor;
    if (!motor) throw new Error('A játékmotor nem töltődött be.');
  }

  /** A daladatbázis csak a szobavezetőnek kell — ne töltsük le feleslegesen. */
  async function dalokBetolt() {
    if (songs) return songs;
    const valasz = await fetch('adatbazis/songs.json');
    if (!valasz.ok) throw new Error('A dalok adatbázisa nem érhető el.');
    songs = await valasz.json();
    return songs;
  }

  const most = () => firebase.firestore.FieldValue.serverTimestamp();
  const szobaHiv = (kod) => db.collection('szobak').doc(kod);

  /* ───────────────────────── szoba létrehozás / csatlakozás ───────────────────────── */

  async function szobaLetrehoz(nev, beallitasNyers) {
    await dalokBetolt();

    const beallitas = motor.tisztitBeallitas(beallitasNyers);
    const hostId = motor.ujAzonosito();

    // Ütközésre újrapróbálunk: a kód négy karakter, ritkán, de egyezhet.
    for (let probalkozas = 0; probalkozas < 8; probalkozas++) {
      const kod = motor.ujKod();
      const hiv = szobaHiv(kod);

      try {
        await db.runTransaction(async (tr) => {
          const meglevo = await tr.get(hiv);
          if (meglevo.exists) throw new Error('foglalt');

          tr.set(hiv, {
            kod,
            hostUid: uid,
            hostJatekosId: hostId,
            letrejott: most(),
            frissitve: most(),
            publikus: beallitas.publikus,
            beallitas,
            allapot: 'lobby',
            kor: 0,
            jatekosok: [{ id: hostId, uid, nev: motor.tisztitNev(nev), pont: 0, host: true }],
            kerdes: null,
            eredmeny: null,
            vegeredmeny: null,
            valaszoltakSzama: 0,
            hasznaltDalok: [],
            kizartDalok: [],
          });
        });

        return { kod, jatekosId: hostId };
      } catch (err) {
        if (String(err.message) !== 'foglalt') throw err;
      }
    }
    throw new Error('Nem sikerült szabad szobakódot találni, próbáld újra.');
  }

  async function csatlakozas(kodNyers, nev) {
    const kod = String(kodNyers || '').trim().toUpperCase();
    const pillanat = await szobaHiv(kod).get();
    if (!pillanat.exists) throw new Error('Nincs ilyen szoba.');

    const szoba = pillanat.data();
    if (szoba.allapot === 'vege') throw new Error('Ez a játék már véget ért.');
    if ((szoba.jatekosok || []).length >= MAX_JATEKOS) throw new Error('A szoba megtelt.');

    // Ha ugyanezzel az eszközzel már bent vagyunk, ne lépjünk be kétszer.
    const meglevo = (szoba.jatekosok || []).find((j) => j.uid === uid);
    if (meglevo) return { kod, jatekosId: meglevo.id };

    // A szobavezető veszi fel a játékosokat — mi csak jelentkezünk.
    await szobaHiv(kod).collection('jelentkezok').doc(uid).set({
      nev: motor.tisztitNev(nev),
      mikor: most(),
    });

    // Megvárjuk, amíg a szobavezető felvesz a listába.
    const jatekosId = await varakozasFelvetelre(kod);
    return { kod, jatekosId };
  }

  function varakozasFelvetelre(kod) {
    return new Promise((teljesit, elutasit) => {
      let kesz = false;
      const idozito = setTimeout(() => {
        if (kesz) return;
        kesz = true;
        leiratkoz();
        elutasit(new Error('A szobavezető nem válaszol. Nyitva van nála az oldal?'));
      }, 15000);

      const leiratkoz = szobaHiv(kod).onSnapshot((pillanat) => {
        if (kesz || !pillanat.exists) return;
        const en = (pillanat.data().jatekosok || []).find((j) => j.uid === uid);
        if (!en) return;
        kesz = true;
        clearTimeout(idozito);
        leiratkoz();
        teljesit(en.id);
      }, () => { /* a hibát az időzítő kezeli */ });
    });
  }

  /* ───────────────────────── állapot figyelése ───────────────────────── */

  /**
   * Ugyanolyan alakú állapotot ad vissza, mint a szerveres SSE — így a
   * megjelenítő kód (js/kahoot.js) változtatás nélkül működik mindkét úton.
   */
  function nezetKeszit(szoba, jatekosId, titkos, sajatValasz) {
    const jatekosok = (szoba.jatekosok || []).slice().sort((a, b) => b.pont - a.pont);
    const en = jatekosok.find((j) => j.id === jatekosId);
    const hostE = Boolean(en && en.host);

    const nezet = {
      kod: szoba.kod,
      allapot: szoba.allapot,
      kor: szoba.kor,
      korokSzama: szoba.beallitas.korokSzama,
      beallitas: szoba.beallitas,
      host: hostE,
      jatekosId,
      jatekosok: jatekosok.map((j) => ({ id: j.id, nev: j.nev, pont: j.pont, host: j.host })),
      valaszoltakSzama: szoba.valaszoltakSzama || 0,
      sajatValasz: sajatValasz === undefined ? null : sajatValasz,
    };

    if (szoba.allapot === 'kerdes' && szoba.kerdes) {
      const k = szoba.kerdes;
      const eltelt = k.indultMs ? Date.now() - k.indultMs : 0;
      nezet.kerdes = {
        tipus: k.tipus,
        szoveg: k.szoveg,
        valaszok: k.valaszok,
        hatralevoMs: Math.max(0, szoba.beallitas.valaszIdoMp * 1000 - eltelt),
        // A szobavezető a titkos dokumentumból kapja meg; a többiek csak akkor,
        // ha a szoba úgy van beállítva, hogy mindenki készülékén szóljon a dal.
        videoId: (hostE && titkos ? titkos.videoId : null) || k.videoId || null,
        kezdesMp: szoba.beallitas.kezdesMp,
      };
    }

    if (szoba.allapot === 'eredmeny' && szoba.eredmeny) nezet.eredmeny = szoba.eredmeny;
    if (szoba.allapot === 'vege') nezet.vegeredmeny = szoba.vegeredmeny || [];

    return nezet;
  }

  function figyel(kod, jatekosId, visszahivas, hibaVisszahivas) {
    let titkos = null;
    let sajatValasz = null;
    let utolsoSzoba = null;

    const frissit = () => {
      if (utolsoSzoba) visszahivas(nezetKeszit(utolsoSzoba, jatekosId, titkos, sajatValasz));
    };

    const leiratkozok = [];

    leiratkozok.push(szobaHiv(kod).onSnapshot((pillanat) => {
      if (!pillanat.exists) {
        // A Firestore először a helyi gyorsítótárból válaszol, és az még
        // "nincs ilyen dokumentum"-ot mondhat, mielőtt a kiszolgáló felelne.
        // Csak a kiszolgálótól jövő hiányt hisszük el — különben a frissen
        // létrehozott szoba azonnal "megszűntnek" látszana.
        if (pillanat.metadata && pillanat.metadata.fromCache) return;
        hibaVisszahivas(new Error('A szoba megszűnt.'));
        return;
      }
      utolsoSzoba = pillanat.data();
      frissit();
    }, hibaVisszahivas));

    // A saját válaszunkat magunk is olvashatjuk, hogy azonnal látszódjon a választás.
    leiratkozok.push(
      szobaHiv(kod).collection('valaszok').doc(uid).onSnapshot((pillanat) => {
        sajatValasz = pillanat.exists ? pillanat.data().valasz : null;
        frissit();
      }, () => { /* nem baj, ha nem tudjuk olvasni */ }),
    );

    // A szobavezetőnek szüksége van a titkos adatokra (videoId, helyes válasz).
    leiratkozok.push(
      szobaHiv(kod).collection('titkos').doc('host').onSnapshot((pillanat) => {
        titkos = pillanat.exists ? pillanat.data() : null;
        frissit();
      }, () => { /* játékosként ez tiltott — így is kell lennie */ }),
    );

    return () => leiratkozok.forEach((f) => { try { f(); } catch { /* mindegy */ } });
  }

  /* ───────────────────────── válaszadás ───────────────────────── */

  async function valaszAd(kod, jatekosId, valaszIndex) {
    const idx = Number(valaszIndex);
    if (!Number.isInteger(idx) || idx < 0 || idx > 3) throw new Error('Érvénytelen válasz.');

    // A dokumentum a saját azonosítónk alatt van: így a szabály egyetlen
    // összehasonlítással eldöntheti, hogy a sajátunkat írjuk-e.
    await szobaHiv(kod).collection('valaszok').doc(uid).set({
      uid,
      jatekosId,
      valasz: idx,
      mikor: most(),
    });
  }

  async function kilep(kod, jatekosId) {
    try {
      const pillanat = await szobaHiv(kod).get();
      if (!pillanat.exists) return;

      if (pillanat.data().hostUid === uid) {
        // A szobavezető kilépésével a játék véget ér — nincs, aki vezesse.
        await szobaHiv(kod).delete();
        return;
      }
      await szobaHiv(kod).collection('valaszok').doc(uid).delete();
      await szobaHiv(kod).collection('jelentkezok').doc(uid).delete();
    } catch { /* kilépéskor már mindegy */ }
  }

  /* ───────────────────────── nyilvános szobák ───────────────────────── */

  async function publikusSzobak() {
    const hatar = new Date(Date.now() - SZOBA_ELAVUL_PERC * 60 * 1000);
    const eredmeny = await db.collection('szobak')
      .where('publikus', '==', true)
      .where('allapot', '==', 'lobby')
      .limit(30)
      .get();

    const szobak = [];
    eredmeny.forEach((doc) => {
      const sz = doc.data();
      const frissitve = sz.frissitve && sz.frissitve.toDate ? sz.frissitve.toDate() : null;
      if (frissitve && frissitve < hatar) return;   // elhagyott szoba

      const host = (sz.jatekosok || []).find((j) => j.host);
      szobak.push({
        kod: sz.kod,
        jatekosok: (sz.jatekosok || []).length,
        korok: sz.beallitas.korokSzama,
        tipusok: sz.beallitas.tipusok,
        hostNev: host ? host.nev : '',
      });
    });
    return { szobak };
  }

  window.AstheticFirestore = {
    init,
    dalokBetolt,
    szobaLetrehoz,
    csatlakozas,
    figyel,
    valaszAd,
    kilep,
    publikusSzobak,
    szobaHiv: (kod) => szobaHiv(kod),
    most,
    get uid() { return uid; },
    get db() { return db; },
    get songs() { return songs; },
  };
})();
