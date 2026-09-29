// A szobavezető böngészőjében futó játékvezetés (Firestore)
//
// Kiszolgáló nélkül valakinek vezetnie kell a játékot: ezt a szobavezető
// böngészője végzi. Ő veszi fel a jelentkezőket, választ dalt, generálja a
// kérdést, méri a kört, és értékel. Mindezt a közös js/jatekmotor.js-szel, hogy
// a pontozás pontosan ugyanaz legyen, mint a szerveres úton.
//
// Csak a szobavezetőnél fut – a többi játékos böngészője semmit nem ír a
// szobadokumentumba (a jogosultsági szabályok sem engednék).
//
// Két szabály:
// 1. Ha a szoba korábbi tartalmára építünk (játékoslista, pontok, kör), az
//    írás tranzakcióban történik: a sima get() a saját, épp lezárult
//    tranzakciónk előtti állapotot is visszaadhatja.
// 2. Időzítő csak egy helyen áll be (utemez), mindig a szoba teljes
//    állapotából számolva, így egy közbenső írás nem állítja vissza.

(function () {
  'use strict';

  const FS = () => window.AstheticFirestore;
  const motor = () => window.AstheticMotor;

  const SZUNET_KIERTEKELES_MS = 600;  // rövid szünet, hogy látszódjon a "megvan"
  const ELETJEL_MS = 60 * 1000;
  const MAX_JATEKOS = 40;

  let aktiv = null;

  // indítás / leállítás

  function indit(kod) {
    if (aktiv && aktiv.kod === kod) return;
    leallit();

    const hiv = FS().szobaHiv(kod);
    aktiv = {
      kod,
      hiv,
      leiratkozok: [],
      idozito: null,
      cel: null,            // { tipus, kor, ido } – mire áll most az időzítő
      eletjel: null,
      szoba: null,
      valaszok: {},
      sor: Promise.resolve(),
    };
    const sajat = aktiv;

    // 1) A szoba állapotát követjük – ebből tudjuk, mikor mi következik.
    sajat.leiratkozok.push(hiv.onSnapshot((pillanat) => {
      if (aktiv !== sajat) return;
      if (!pillanat.exists) {
        if (pillanat.metadata && pillanat.metadata.fromCache) return;
        leallit();
        return;
      }
      sajat.szoba = pillanat.data();
      szamlaloFrissit();
      utemez();
    }, () => { /* a kliens oldali figyelő úgyis jelzi a hibát */ }));

    // 2) Jelentkezők felvétele és a kilépők eltávolítása.
    sajat.leiratkozok.push(hiv.collection('jelentkezok').onSnapshot((pillanat) => {
      if (aktiv !== sajat) return;
      pillanat.docChanges().forEach((valtozas) => {
        if (valtozas.type === 'removed') return;
        const adat = valtozas.doc.data() || {};
        const uid = valtozas.doc.id;
        if (adat.kilep) sorba(() => eltavolit(kod, uid));
        else sorba(() => felvesz(kod, uid, adat.nev, adat.kep));
      });
    }, () => {}));

    // 3) Válaszok gyűjtése – ha mindenki válaszolt, ne várjunk az időzítőre.
    sajat.leiratkozok.push(hiv.collection('valaszok').onSnapshot((pillanat) => {
      if (aktiv !== sajat) return;
      const valaszok = {};
      pillanat.forEach((doc) => { valaszok[doc.id] = doc.data(); });
      sajat.valaszok = valaszok;
      szamlaloFrissit();
      utemez();
    }, () => {}));

    // 4) Életjel: ebből látszik a szobalistán, hogy a szoba még él.
    sajat.eletjel = setInterval(() => {
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

  /**
   * A szobát módosító műveletek egymás után futnak, soha nem egyszerre –
   * így egy dupla kattintás vagy egy épp beérkező jelentkező nem tud
   * két, egymásról nem tudó írást elindítani.
   */
  function sorba(muvelet) {
    const cel = aktiv;
    const kovetkezo = (cel ? cel.sor : Promise.resolve()).then(muvelet, muvelet);
    if (cel) cel.sor = kovetkezo.catch(() => {});
    return kovetkezo;
  }

  // segédfüggvények

  /** Egy válasz csak az aktuális körre érvényes, és csak ha tényleges játékostól jön. */
  function ervenyesValaszok(szoba, valaszok) {
    const jatszoIdk = new Set(motor().jatszok(szoba.jatekosok).map((j) => j.id));
    const eredmeny = {};
    for (const v of Object.values(valaszok || {})) {
      if (!v || !jatszoIdk.has(v.jatekosId)) continue;
      // A régebbi kliensek még nem írják bele a kört – a körváltáskor úgyis
      // töröljük a válaszokat, ezért náluk elfogadjuk.
      if (v.kor !== undefined && v.kor !== szoba.kor) continue;
      eredmeny[v.jatekosId] = v;
    }
    return eredmeny;
  }

  /** A "hányan válaszoltak" kijelzés – csak akkor írunk, ha tényleg változott. */
  function szamlaloFrissit() {
    if (!aktiv || !aktiv.szoba || aktiv.szoba.allapot !== 'kerdes') return;
    const db = Object.keys(ervenyesValaszok(aktiv.szoba, aktiv.valaszok)).length;
    const kulcs = aktiv.szoba.kor + ':' + db;
    if (db === aktiv.szoba.valaszoltakSzama || aktiv.utolsoSzamlalo === kulcs) return;
    aktiv.utolsoSzamlalo = kulcs;
    aktiv.hiv.update({ valaszoltakSzama: db }).catch(() => {});
  }

  // időzítés – egyetlen helyen

  function utemez() {
    if (!aktiv || !aktiv.szoba) return;
    const szoba = aktiv.szoba;

    if (szoba.allapot !== 'kerdes' || !szoba.kerdes) {
      clearTimeout(aktiv.idozito);
      aktiv.cel = null;
      return;
    }

    const most = Date.now();
    const kor = szoba.kor;
    let cel;

    if (szoba.kerdes.valaszNyitva === false) {
      // Hallgatási szakasz. Ha a szobavezető közben újratöltötte az oldalt,
      // az időzítő elveszett – ezért mindig a kör kezdetéből számolunk újra.
      const hallgatasMs = (szoba.beallitas.elobbZeneMp || 0) * 1000;
      const kezdet = szoba.kerdes.indultMs || most;
      cel = { tipus: 'nyitas', kor, ido: kezdet + hallgatasMs };
    } else {
      const kezdet = szoba.kerdes.indultMs || most;
      cel = { tipus: 'kiertekeles', kor, ido: kezdet + szoba.beallitas.valaszIdoMp * 1000 };

      const jatszokSzama = motor().jatszok(szoba.jatekosok).length;
      const valaszolt = Object.keys(ervenyesValaszok(szoba, aktiv.valaszok)).length;
      // Ha egyetlen játszó sincs (a szobavezető csak levezet, és még senki nem
      // lépett be), ne ugorjunk azonnal – különben végigpörögnének a körök.
      if (szoba.beallitas.mindenkiUtanTovabb && jatszokSzama > 0 && valaszolt >= jatszokSzama) {
        const gyors = most + SZUNET_KIERTEKELES_MS;
        // Ha már áll egy korábbi rövid időzítő ugyanerre a körre, azt hagyjuk.
        const elozo = aktiv.cel;
        const marGyors = elozo && elozo.tipus === 'kiertekeles' && elozo.kor === kor && elozo.gyors;
        cel = { tipus: 'kiertekeles', kor, ido: marGyors ? Math.min(elozo.ido, gyors) : Math.min(cel.ido, gyors), gyors: true };
      }
    }

    const regi = aktiv.cel;
    if (regi && regi.tipus === cel.tipus && regi.kor === cel.kor && Math.abs(regi.ido - cel.ido) < 30) return;

    clearTimeout(aktiv.idozito);
    aktiv.cel = cel;
    const kod = aktiv.kod;
    aktiv.idozito = setTimeout(() => {
      const muvelet = cel.tipus === 'nyitas'
        ? () => valaszokatNyit(kod, cel.kor)
        : () => korKiertekel(kod, cel.kor);
      sorba(muvelet).catch(() => {
        // Hálózati hiba: pár másodperc múlva újrapróbáljuk, különben a kör
        // örökre nyitva maradna.
        if (aktiv && aktiv.cel === cel) {
          aktiv.cel = null;
          setTimeout(utemez, 2000);
        }
      });
    }, Math.max(0, cel.ido - most));
  }

  // jelentkezők

  async function felvesz(kod, jelentkezoUid, nev, kep) {
    const hiv = FS().szobaHiv(kod);
    try {
      await FS().db.runTransaction(async (tr) => {
        const pillanat = await tr.get(hiv);
        if (!pillanat.exists) return;

        const szoba = pillanat.data();
        const jatekosok = (szoba.jatekosok || []).slice();
        if (jatekosok.some((j) => j.uid === jelentkezoUid)) return;   // már bent van
        if (jatekosok.length >= MAX_JATEKOS) return;
        if (szoba.allapot === 'vege') return;

        jatekosok.push({
          id: motor().ujAzonosito(),
          uid: jelentkezoUid,
          nev: motor().tisztitNev(nev),
          kep: motor().tisztitKep(kep),
          pont: 0,
          host: false,
        });
        tr.update(hiv, { jatekosok, frissitve: FS().most() });
      });
      await hiv.collection('jelentkezok').doc(jelentkezoUid).delete().catch(() => {});
    } catch { /* a következő pillanatkép újrapróbálja */ }
  }

  /** A kilépő játékos lekerül a listáról – ettől a "mindenki válaszolt" is helyesen számol. */
  async function eltavolit(kod, jatekosUid) {
    const hiv = FS().szobaHiv(kod);
    try {
      await FS().db.runTransaction(async (tr) => {
        const pillanat = await tr.get(hiv);
        if (!pillanat.exists) return;
        const szoba = pillanat.data();
        if (szoba.hostUid === jatekosUid) return;   // a szobavezetőt nem dobjuk ki
        const jatekosok = (szoba.jatekosok || []).filter((j) => j.uid !== jatekosUid);
        if (jatekosok.length === (szoba.jatekosok || []).length) return;
        tr.update(hiv, { jatekosok, frissitve: FS().most() });
      });
      await hiv.collection('valaszok').doc(jatekosUid).delete().catch(() => {});
      await hiv.collection('jelentkezok').doc(jatekosUid).delete().catch(() => {});
    } catch { /* a következő pillanatkép újrapróbálja */ }
  }

  // játékmenet

  function jatekIndit(kod) {
    return sorba(() => korInditas(kod, { inditas: true }));
  }

  function kovetkezoKor(kod) {
    return sorba(() => korInditas(kod, {}));
  }

  function dalKidob(kod) {
    return sorba(() => korInditas(kod, { kidobas: true }));
  }

  function ujraJatszas(kod) {
    return sorba(async () => {
      const hiv = FS().szobaHiv(kod);
      await FS().db.runTransaction(async (tr) => {
        const pillanat = await tr.get(hiv);
        if (!pillanat.exists) throw new Error('Nincs ilyen szoba.');
        const szoba = pillanat.data();
        if (szoba.allapot !== 'vege') return;
        tr.update(hiv, {
          allapot: 'lobby',
          kor: 0,
          kerdes: null,
          eredmeny: null,
          vegeredmeny: null,
          valaszoltakSzama: 0,
          // A már lejátszott dalok kimaradnak – az új menetben friss dalok jönnek.
          jatekosok: (szoba.jatekosok || []).map((j) => ({ ...j, pont: 0 })),
          frissitve: FS().most(),
        });
      });
    });
  }

  /**
   * Új kör indítása. Három helyről hívódik:
   *   inditas – a váróból indul a játék (pontok nullázása)
   *   kidobas – a szobavezető kidobja a futó dalt; a kör nem számít bele
   *   (alap) – az eredmény után jön a következő kör
   */
  async function korInditas(kod, { inditas = false, kidobas = false }) {
    const hiv = FS().szobaHiv(kod);
    const songs = await FS().dalokBetolt();

    const engedett = inditas ? ['lobby'] : kidobas ? ['kerdes'] : ['eredmeny'];

    // Az állapotot a tranzakción belül ellenőrizzük: a kör eredményét
    // tranzakció írja, és amíg a szoba figyelője meg nem kapja, a get() (még
    // source: 'server'-rel is) a figyelő régi nézetét adja vissza.
    await FS().db.runTransaction(async (tr) => {
      const pillanat = await tr.get(hiv);
      if (!pillanat.exists) throw new Error('Nincs ilyen szoba.');
      const szoba = pillanat.data();
      if (!engedett.includes(szoba.allapot)) {
        if (inditas) throw new Error('A játék már elindult.');
        return;
      }

      const titkosHiv = hiv.collection('titkos').doc('host');
      let kor = szoba.kor || 0;
      let jatekosok = szoba.jatekosok || [];
      const kizartDalok = (szoba.kizartDalok || []).slice();

      if (inditas) {
        kor = 0;
        jatekosok = jatekosok.map((j) => ({ ...j, pont: 0 }));
      }
      if (kidobas) {
        const titkos = await tr.get(titkosHiv);
        if (titkos.exists && titkos.data().dal) kizartDalok.push(titkos.data().dal.id);
        kor = Math.max(0, kor - 1);   // ez a kör nem számít bele
      }

      // Az előző kör válaszai ugyanebben a tranzakcióban törlődnek: így csak
      // akkor, ha tényleg új kör indul – egy dupla kattintás nem söpörheti ki
      // a már futó kör válaszait. (Minden olvasás után kell jönnie.)
      for (const j of szoba.jatekosok || []) {
        if (j.uid) tr.delete(hiv.collection('valaszok').doc(j.uid));
      }

      const vege = (szobaAllapot) => {
        const vegeredmeny = motor().jatszok(szobaAllapot.jatekosok)
          .map((j) => ({ id: j.id, nev: j.nev, kep: j.kep || null, pont: j.pont || 0 }))
          .sort((a, b) => b.pont - a.pont);
        tr.update(hiv, {
          allapot: 'vege',
          kerdes: null,
          jatekosok: szobaAllapot.jatekosok,
          vegeredmeny,
          kizartDalok,
          frissitve: FS().most(),
        });
      };

      if (kor >= szoba.beallitas.korokSzama) { vege({ jatekosok }); return; }

      const kizart = new Set([...(szoba.hasznaltDalok || []), ...kizartDalok]);
      const ujKor = kor + 1;
      const valasztas = motor().kovetkezoKerdes(songs, szoba.beallitas, szoba.kod, ujKor, kizart);
      if (!valasztas) { vege({ jatekosok }); return; }

      const { dal, kerdes } = valasztas;
      const hallgatasMs = (szoba.beallitas.elobbZeneMp || 0) * 1000;

      // A helyes válasz és a videoId külön dokumentumba megy, amit csak a
      // szobavezető olvashat – a kérdés alatt senki más nem fér hozzá.
      tr.set(titkosHiv, {
        videoId: dal.videoId,
        correctIndex: kerdes.correctIndex,
        correctAnswer: kerdes.correctAnswer,
        kor: ujKor,
        // "Csak szinek" modban innen olvassa ki a szobavezeto a kerdest.
        szoveg: kerdes.kerdes,
        valaszok: kerdes.options,
        dal: { id: dal.id, eloado: dal.artist, cim: dal.title, ev: dal.year, videoId: dal.videoId },
      });

      tr.update(hiv, {
        allapot: 'kerdes',
        kor: ujKor,
        jatekosok,
        kizartDalok,
        hasznaltDalok: [...(szoba.hasznaltDalok || []), dal.id],
        kerdes: {
          tipus: kerdes.type,
          // "Elobb a zene" mod: a valaszok csak a hallgatas utan nyilnak meg.
          valaszNyitva: hallgatasMs === 0,
          // "Csak szinek" modban a szoveg es a valaszok nem kerulnek a nyilvanos
          // dokumentumba - csak a titkosba, amit egyedul a szobavezeto olvashat.
          csakSzinek: Boolean(szoba.beallitas.csakSzinek),
          szoveg: szoba.beallitas.csakSzinek ? null : kerdes.kerdes,
          valaszok: szoba.beallitas.csakSzinek ? null : kerdes.options,
          indultMs: Date.now(),
          // Csak akkor kerul a nyilvanos allapotba, ha a szoba ugy van beallitva,
          // hogy mindenki keszuleken szoljon a dal.
          videoId: szoba.beallitas.mindenkiHallja ? dal.videoId : null,
        },
        indult: FS().most(),
        eredmeny: null,
        vegeredmeny: null,
        valaszoltakSzama: 0,
        frissitve: FS().most(),
      });
    });
  }

  /** A hallgatasi szakasz vege: innentol lehet valaszolni, es indul a valaszido. */
  async function valaszokatNyit(kod, kor) {
    const hiv = FS().szobaHiv(kod);
    await FS().db.runTransaction(async (tr) => {
      const pillanat = await tr.get(hiv);
      if (!pillanat.exists) return;
      const szoba = pillanat.data();
      if (szoba.allapot !== 'kerdes' || !szoba.kerdes || szoba.kor !== kor) return;
      if (szoba.kerdes.valaszNyitva) return;

      tr.update(hiv, {
        'kerdes.valaszNyitva': true,
        'kerdes.indultMs': Date.now(),
        // A pontozas a valaszok megnyitasatol szamit, nem a dal kezdetetol.
        indult: FS().most(),
        frissitve: FS().most(),
      });
    });
  }


  function korKiertekel(kod, korSzam) {
    // Kézi hívásnál (pl. a régi "kiertekel" művelet) a sorban futunk.
    if (korSzam === undefined) return sorba(() => korKiertekel(kod, null));
    return kiertekelesFuttat(kod, korSzam);
  }

  async function kiertekelesFuttat(kod, korSzam) {
    const hiv = FS().szobaHiv(kod);

    // A válaszokat a tranzakció előtt olvassuk be (lekérdezést tranzakcióban
    // nem lehet futtatni). A szobát és a titkos adatot viszont már benne.
    const valaszPillanat = await hiv.collection('valaszok').get();
    const nyersValaszok = {};
    valaszPillanat.forEach((doc) => { nyersValaszok[doc.id] = doc.data(); });

    await FS().db.runTransaction(async (tr) => {
      const pillanat = await tr.get(hiv);
      if (!pillanat.exists) return;
      const szoba = pillanat.data();
      if (szoba.allapot !== 'kerdes') return;
      if (korSzam !== null && szoba.kor !== korSzam) return;   // közben már továbbléptünk

      const titkosPillanat = await tr.get(hiv.collection('titkos').doc('host'));
      if (!titkosPillanat.exists) return;
      const titkos = titkosPillanat.data();

      // A válaszidőt kiszolgálói időbélyegekből számoljuk, hogy senkinek ne
      // segítsen vagy ártson az órája pontatlansága.
      const kezdet = szoba.indult && szoba.indult.toMillis ? szoba.indult.toMillis() : null;
      const idoKeret = szoba.beallitas.valaszIdoMp * 1000;

      const valaszok = {};
      for (const v of Object.values(ervenyesValaszok(szoba, nyersValaszok))) {
        const mikor = v.mikor && v.mikor.toMillis ? v.mikor.toMillis() : null;
        // Ha valamiért nincs kiszolgálói időbélyeg, a kör végét feltételezzük:
        // így a hiányzó adat nem hozhat előnyt senkinek.
        const mikorMs = kezdet !== null && mikor !== null
          ? Math.max(0, Math.min(idoKeret, mikor - kezdet))
          : idoKeret;
        valaszok[v.jatekosId] = { valasz: v.valasz, mikorMs };
      }

      const jatekosok = (szoba.jatekosok || []).map((j) => ({ ...j }));
      const korEredmeny = motor().korKiertekel(
        jatekosok,
        valaszok,
        titkos.correctIndex,
        idoKeret,
        szoba.beallitas.alappont,
      );

      tr.update(hiv, {
        allapot: 'eredmeny',
        jatekosok,
        eredmeny: {
          helyesIndex: titkos.correctIndex,
          helyesValasz: titkos.correctAnswer,
          // A kiertekeleskor mar mindenki lathatja a valaszokat, ezert itt a
          // titkos dokumentumbol vesszuk - "csak szinek" modban a nyilvanosban
          // nincsenek is benne.
          valaszok: titkos.valaszok || szoba.kerdes.valaszok,
          szoveg: titkos.szoveg || szoba.kerdes.szoveg,
          dal: titkos.dal,
          korEredmeny,
          utolsoKor: szoba.kor >= szoba.beallitas.korokSzama,
        },
        valaszoltakSzama: Object.keys(valaszok).length,
        frissitve: FS().most(),
      });
    });
  }

  window.AstheticVezeto = {
    indit,
    leallit,
    jatekIndit,
    kovetkezoKor,
    korKiertekel,
    dalKidob,
    ujraJatszas,
  };
})();
