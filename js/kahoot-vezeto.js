/* ═══════════════════════════════════════════════════════════════
   ASTHETIC — a szobavezető böngészőjében futó játékvezetés (Firestore)

   Kiszolgáló nélkül valakinek vezetnie kell a játékot: ezt a szobavezető
   böngészője végzi. Ő veszi fel a jelentkezőket, választ dalt, generálja a
   kérdést, méri a kört, és értékel. Mindezt a közös js/jatekmotor.js-szel, hogy
   a pontozás pontosan ugyanaz legyen, mint a szerveres úton.

   Csak a szobavezetőnél fut — a többi játékos böngészője semmit nem ír a
   szobadokumentumba (a jogosultsági szabályok sem engednék).
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  const FS = () => window.AstheticFirestore;
  const motor = () => window.AstheticMotor;

  const SZUNET_KIERTEKELES_MS = 400;  // rövid szünet, hogy látszódjon a "megvan"
  const ELETJEL_MS = 60 * 1000;

  let aktiv = null;   // { kod, leiratkozok[], idozito, eletjel }

  /* ───────────────────────── indítás / leállítás ───────────────────────── */

  function indit(kod) {
    if (aktiv && aktiv.kod === kod) return;
    leallit();

    const hiv = FS().szobaHiv(kod);
    aktiv = { kod, leiratkozok: [], idozito: null, eletjel: null, szoba: null, valaszok: {} };

    // 1) A szoba állapotát követjük — ebből tudjuk, mikor kell értékelni.
    aktiv.leiratkozok.push(hiv.onSnapshot((pillanat) => {
      if (!pillanat.exists) { leallit(); return; }
      aktiv.szoba = pillanat.data();
      idozitesUjra();
    }));

    // 2) Jelentkezők felvétele.
    aktiv.leiratkozok.push(hiv.collection('jelentkezok').onSnapshot((pillanat) => {
      pillanat.docChanges().forEach((valtozas) => {
        if (valtozas.type === 'removed') return;
        felvesz(kod, valtozas.doc.id, valtozas.doc.data().nev);
      });
    }));

    // 3) Válaszok gyűjtése — ha mindenki válaszolt, ne várjunk az időzítőre.
    aktiv.leiratkozok.push(hiv.collection('valaszok').onSnapshot((pillanat) => {
      const valaszok = {};
      pillanat.forEach((doc) => { valaszok[doc.id] = doc.data(); });
      aktiv.valaszok = valaszok;
      valaszokValtoztak(kod);
    }));

    // 4) Életjel: ebből látszik a szobalistán, hogy a szoba még él.
    aktiv.eletjel = setInterval(() => {
      hiv.update({ frissitve: FS().most() }).catch(() => { /* törölt szoba */ });
    }, ELETJEL_MS);
  }

  function leallit() {
    if (!aktiv) return;
    aktiv.leiratkozok.forEach((f) => { try { f(); } catch { /* mindegy */ } });
    clearTimeout(aktiv.idozito);
    clearInterval(aktiv.eletjel);
    aktiv = null;
  }

  /* ───────────────────────── jelentkezők ───────────────────────── */

  async function felvesz(kod, jelentkezoUid, nev) {
    const hiv = FS().szobaHiv(kod);
    try {
      await FS().db.runTransaction(async (tr) => {
        const pillanat = await tr.get(hiv);
        if (!pillanat.exists) return;

        const szoba = pillanat.data();
        const jatekosok = szoba.jatekosok || [];
        if (jatekosok.some((j) => j.uid === jelentkezoUid)) return;   // már bent van
        if (jatekosok.length >= 40) return;
        if (szoba.allapot === 'vege') return;

        jatekosok.push({
          id: motor().ujAzonosito(),
          uid: jelentkezoUid,
          nev: motor().tisztitNev(nev),
          pont: 0,
          host: false,
        });
        tr.update(hiv, { jatekosok, frissitve: FS().most() });
      });
      await hiv.collection('jelentkezok').doc(jelentkezoUid).delete().catch(() => {});
    } catch { /* a következő pillanatkép újrapróbálja */ }
  }

  /* ───────────────────────── játékmenet ───────────────────────── */

  async function jatekIndit(kod) {
    const hiv = FS().szobaHiv(kod);
    const pillanat = await hiv.get();
    if (!pillanat.exists) throw new Error('Nincs ilyen szoba.');
    if (pillanat.data().allapot !== 'lobby') throw new Error('A játék már elindult.');

    const jatekosok = (pillanat.data().jatekosok || []).map((j) => ({ ...j, pont: 0 }));
    await hiv.update({ jatekosok, kor: 0, frissitve: FS().most() });
    await kovetkezoKor(kod);
  }

  async function kovetkezoKor(kod) {
    const hiv = FS().szobaHiv(kod);
    const songs = await FS().dalokBetolt();

    const pillanat = await hiv.get();
    if (!pillanat.exists) return;
    const szoba = pillanat.data();

    await valaszokTorol(kod);

    if (szoba.kor >= szoba.beallitas.korokSzama) return jatekVege(kod, szoba);

    const kizart = new Set([...(szoba.hasznaltDalok || []), ...(szoba.kizartDalok || [])]);
    const ujKor = szoba.kor + 1;
    const valasztas = motor().kovetkezoKerdes(songs, szoba.beallitas, szoba.kod, ujKor, kizart);
    if (!valasztas) return jatekVege(kod, szoba);

    const { dal, kerdes } = valasztas;

    // A helyes válasz és a videoId külön dokumentumba megy, amit csak a
    // szobavezető olvashat — a kérdés alatt senki más nem fér hozzá.
    await hiv.collection('titkos').doc('host').set({
      videoId: dal.videoId,
      correctIndex: kerdes.correctIndex,
      correctAnswer: kerdes.correctAnswer,
      dal: { id: dal.id, eloado: dal.artist, cim: dal.title, ev: dal.year, videoId: dal.videoId },
    });

    await hiv.update({
      allapot: 'kerdes',
      kor: ujKor,
      hasznaltDalok: [...(szoba.hasznaltDalok || []), dal.id],
      kerdes: {
        tipus: kerdes.type,
        szoveg: kerdes.kerdes,
        valaszok: kerdes.options,
        indultMs: Date.now(),
      },
      indult: FS().most(),
      eredmeny: null,
      valaszoltakSzama: 0,
      frissitve: FS().most(),
    });
  }

  async function valaszokTorol(kod) {
    const hiv = FS().szobaHiv(kod);
    const regiek = await hiv.collection('valaszok').get();
    if (regiek.empty) return;
    const koteg = FS().db.batch();
    regiek.forEach((doc) => koteg.delete(doc.ref));
    await koteg.commit();
  }

  /** Az időzítő mindig az aktuális kör hátralévő idejére áll be. */
  function idozitesUjra() {
    if (!aktiv || !aktiv.szoba) return;
    clearTimeout(aktiv.idozito);

    const szoba = aktiv.szoba;
    if (szoba.allapot !== 'kerdes' || !szoba.kerdes) return;

    const eltelt = Date.now() - (szoba.kerdes.indultMs || Date.now());
    const hatra = Math.max(0, szoba.beallitas.valaszIdoMp * 1000 - eltelt);
    aktiv.idozito = setTimeout(() => korKiertekel(aktiv.kod), hatra);
  }

  function valaszokValtoztak(kod) {
    if (!aktiv || !aktiv.szoba) return;
    const szoba = aktiv.szoba;
    const db = Object.keys(aktiv.valaszok).length;

    FS().szobaHiv(kod).update({ valaszoltakSzama: db }).catch(() => {});

    if (szoba.allapot === 'kerdes' && db >= (szoba.jatekosok || []).length) {
      clearTimeout(aktiv.idozito);
      aktiv.idozito = setTimeout(() => korKiertekel(kod), SZUNET_KIERTEKELES_MS);
    }
  }

  async function korKiertekel(kod) {
    const hiv = FS().szobaHiv(kod);
    const pillanat = await hiv.get();
    if (!pillanat.exists) return;

    const szoba = pillanat.data();
    if (szoba.allapot !== 'kerdes') return;

    const titkosPillanat = await hiv.collection('titkos').doc('host').get();
    if (!titkosPillanat.exists) return;
    const titkos = titkosPillanat.data();

    // A válaszidőt kiszolgálói időbélyegekből számoljuk, hogy senkinek ne
    // segítsen vagy ártson az órája pontatlansága.
    const kezdet = szoba.indult && szoba.indult.toMillis ? szoba.indult.toMillis() : null;
    const idoKeret = szoba.beallitas.valaszIdoMp * 1000;

    const valaszPillanat = await hiv.collection('valaszok').get();
    const valaszok = {};
    valaszPillanat.forEach((doc) => {
      const v = doc.data();
      const mikor = v.mikor && v.mikor.toMillis ? v.mikor.toMillis() : null;
      // Ha valamiért nincs kiszolgálói időbélyeg, a kör végét feltételezzük:
      // így a hiányzó adat nem hozhat előnyt senkinek.
      const mikorMs = kezdet !== null && mikor !== null
        ? Math.max(0, Math.min(idoKeret, mikor - kezdet))
        : idoKeret;
      if (v.jatekosId) valaszok[v.jatekosId] = { valasz: v.valasz, mikorMs };
    });

    const jatekosok = (szoba.jatekosok || []).map((j) => ({ ...j }));
    const korEredmeny = motor().korKiertekel(
      jatekosok,
      valaszok,
      titkos.correctIndex,
      idoKeret,
      szoba.beallitas.alappont,
    );

    await hiv.update({
      allapot: 'eredmeny',
      jatekosok,
      eredmeny: {
        helyesIndex: titkos.correctIndex,
        helyesValasz: titkos.correctAnswer,
        valaszok: szoba.kerdes.valaszok,
        szoveg: szoba.kerdes.szoveg,
        dal: titkos.dal,
        korEredmeny,
        utolsoKor: szoba.kor >= szoba.beallitas.korokSzama,
      },
      frissitve: FS().most(),
    });
  }

  async function jatekVege(kod, szoba) {
    const vegeredmeny = (szoba.jatekosok || [])
      .map((j) => ({ id: j.id, nev: j.nev, pont: j.pont }))
      .sort((a, b) => b.pont - a.pont);

    await FS().szobaHiv(kod).update({
      allapot: 'vege',
      kerdes: null,
      vegeredmeny,
      frissitve: FS().most(),
    });
  }

  /** A szobavezető kidobja az aktuális dalt (pl. 45 mp után sincs értékelhető hang). */
  async function dalKidob(kod) {
    const hiv = FS().szobaHiv(kod);
    const pillanat = await hiv.get();
    if (!pillanat.exists) return;

    const szoba = pillanat.data();
    const titkosPillanat = await hiv.collection('titkos').doc('host').get();
    if (!titkosPillanat.exists) throw new Error('Most nincs futó dal.');

    const dalId = titkosPillanat.data().dal.id;
    await hiv.update({
      kizartDalok: [...(szoba.kizartDalok || []), dalId],
      kor: Math.max(0, szoba.kor - 1),   // ez a kör nem számít bele
      frissitve: FS().most(),
    });
    await kovetkezoKor(kod);
  }

  window.AstheticVezeto = {
    indit,
    leallit,
    jatekIndit,
    kovetkezoKor,
    korKiertekel,
    dalKidob,
  };
})();
