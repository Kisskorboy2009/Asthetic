// Rubik-Bingó online (Firestore)
//
// A játékot a szobavezető készüléke vezeti (js/bingo-asztal.js), ez a fájl
// csak összeköti a többiekkel:
//
//   bingo/{kod}                   nyilvános állapot – csak a szobavezető írja
//   bingo/{kod}/titkos/host       a dal adatai – csak a szobavezető olvassa
//   bingo/{kod}/jelentkezok/{uid} belépési kérés / kilépés
//   bingo/{kod}/lepesek/{uid}     egy játékos lépései: tipp, lecsapás, ikszelés
//
// A lépéseket a játékos a saját dokumentumába írja, mindegyiket egyedi
// azonosítóval. A szobavezető mindet egyszer dolgozza fel, és a játékost a
// dokumentum azonosítójából (a bejelentkezett felhasználóból) ismeri fel –
// más nevében tehát nem lehet lépni.
//
// Csak a tesztelők érhetik el; a szabályok a firestore.rules-ban vannak.

(function () {
  'use strict';

  const B = () => window.AstheticBingo;
  const GYUJTEMENY = 'bingo';
  const KOD_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  let db = null;
  let uid = null;
  let songs = null;

  async function init() {
    if (db) return;
    await window.AstheticFiok.kesz();
    const fb = window.ASTHETIC.firebaseIndit();
    const u = fb.auth().currentUser;
    if (!u || u.isAnonymous) throw new Error('Előbb jelentkezz be a Google-fiókoddal.');
    db = fb.firestore();
    try {
      db.settings({ experimentalAutoDetectLongPolling: true, merge: true });
    } catch { /* ha már el is indult a kapcsolat, marad az alapértelmezés */ }
    uid = u.uid;
  }

  async function dalokBetolt() {
    if (songs) return songs;
    if (window.AstheticDalok) { songs = await window.AstheticDalok.betolt(); return songs; }
    const valasz = await fetch('adatbazis/songs.json');
    if (!valasz.ok) throw new Error('A dalok adatbázisa nem érhető el.');
    songs = await valasz.json();
    return songs;
  }

  const most = () => window.firebase.firestore.FieldValue.serverTimestamp();
  const szobaHiv = (kod) => db.collection(GYUJTEMENY).doc(kod);
  const ujKod = () => Array.from({ length: 4 }, () => KOD_ABC[B().veletlenEgesz(KOD_ABC.length)]).join('');
  const ujAzon = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  // a szobavezető oldala

  let vezetes = null;

  /**
   * Az asztal állapotát írja ki. Egyszerre mindig csak egy írás fut; ha közben
   * újabb állapot jön, az előzőt kihagyjuk – mindig a legfrissebb kerül ki.
   */
  function iro(kod) {
    let varakozo = null;
    let fut = false;
    let utolsoTitkos = null;

    async function kiir() {
      if (fut) return;
      fut = true;
      try {
        while (varakozo) {
          const { publikus, titkos } = varakozo;
          varakozo = null;
          const koteg = db.batch();
          koteg.set(szobaHiv(kod), { ...publikus, frissitve: most() });
          const titkosSzoveg = JSON.stringify(titkos);
          if (titkosSzoveg !== utolsoTitkos) {
            koteg.set(szobaHiv(kod).collection('titkos').doc('host'), titkos);
            utolsoTitkos = titkosSzoveg;
          }
          try { await koteg.commit(); } catch (e) {
            // Hálózati hiba: a következő változás úgyis újra kiírja az egészet.
            utolsoTitkos = null;
            console.warn('Bingó: nem sikerült kiírni az állapotot', e);
          }
        }
      } finally { fut = false; }
    }

    return (allapot) => { varakozo = allapot; kiir(); };
  }

  function vezetesIndit(kod, asztal) {
    vezetesLeallit();
    const sajat = { kod, asztal, leiratkozok: [], feldolgozott: new Set() };
    vezetes = sajat;

    sajat.leiratkozok.push(szobaHiv(kod).collection('jelentkezok').onSnapshot((pillanat) => {
      if (vezetes !== sajat) return;
      pillanat.docChanges().forEach((v) => {
        if (v.type === 'removed') return;
        const adat = v.doc.data() || {};
        const jelentkezo = v.doc.id;
        try {
          if (adat.kilep) asztal.jatekosTorol(jelentkezo);
          else asztal.jatekosFelvesz({ uid: jelentkezo, nev: adat.nev, kep: adat.kep });
        } catch (e) {
          console.warn('Bingó: jelentkezés elutasítva', e.message);
        }
        v.doc.ref.delete().catch(() => {});
      });
    }, () => {}));

    sajat.leiratkozok.push(szobaHiv(kod).collection('lepesek').onSnapshot((pillanat) => {
      if (vezetes !== sajat) return;
      pillanat.docChanges().forEach((v) => {
        if (v.type === 'removed') return;
        lepesFeldolgoz(sajat, v.doc.id, v.doc.data() || {});
      });
    }, () => {}));
  }

  function lepesFeldolgoz(sajat, jatekosUid, adat) {
    const { asztal, feldolgozott } = sajat;
    const j = asztal.p.jatekosok.find((x) => x.uid === jatekosUid);
    if (!j) return;
    const kor = asztal.p.kor;
    const uj = (lepes) => lepes && lepes.kor === kor && lepes.azon && !feldolgozott.has(lepes.azon);

    // A lecsapást a tipp előtt: aki lecsap, rögtön utána küldi a tippjét.
    if (uj(adat.lecsap)) {
      feldolgozott.add(adat.lecsap.azon);
      asztal.lecsap(j.id);
    }
    if (uj(adat.tipp)) {
      // Az elutasított tippet (pl. más lecsapása alatt érkezett) nem jelöljük
      // feldolgozottnak: a játékos a saját felületén látja, hogy nem ment át.
      if (asztal.tipp(j.id, adat.tipp)) feldolgozott.add(adat.tipp.azon);
    }
    if (uj(adat.jeloles)) {
      feldolgozott.add(adat.jeloles.azon);
      asztal.jelol(j.id, adat.jeloles.mezo);
    }
  }

  function vezetesLeallit() {
    if (!vezetes) return;
    vezetes.leiratkozok.forEach((f) => { try { f(); } catch { /* mindegy */ } });
    vezetes.asztal.leallit();
    vezetes = null;
  }

  async function szobaLetrehoz(nev, beallitasNyers, kep = null) {
    await init();
    const dalok = await dalokBetolt();
    const beallitas = B().tisztitBeallitas({ ...beallitasNyers, mod: 'online' });

    for (let probalkozas = 0; probalkozas < 8; probalkozas++) {
      const kod = ujKod();
      const foglalt = await szobaHiv(kod).get().then((d) => d.exists, () => false);
      if (foglalt) continue;

      const asztal = new window.AstheticBingoAsztal.Asztal({
        kod, hostUid: uid, beallitas, songs: dalok, valtozas: () => {},
      });
      const jatekosId = asztal.jatekosFelvesz({ uid, nev, kep, host: true, nezo: !beallitas.vezetoJatszik });
      // Az első kiírás létrehozza a szobát – utána kapcsoljuk be a folyamatos írást.
      const kezdo = { publikus: JSON.parse(JSON.stringify({ ...asztal.p, iroMs: Date.now() })) };
      await szobaHiv(kod).set({ ...kezdo.publikus, letrejott: most(), frissitve: most() });
      asztal.valtozas = iro(kod);
      vezetesIndit(kod, asztal);
      return { kod, jatekosId, asztal };
    }
    throw new Error('Nem sikerült szabad szobakódot találni, próbáld újra.');
  }

  /** Újratöltés után a szobavezető innen folytatja a vezetést. */
  async function vezetesFolytat(kod) {
    await init();
    if (vezetes && vezetes.kod === kod) return vezetes.asztal;
    const [szoba, titkos, lepesek, dalok] = await Promise.all([
      szobaHiv(kod).get(),
      szobaHiv(kod).collection('titkos').doc('host').get(),
      szobaHiv(kod).collection('lepesek').get(),
      dalokBetolt(),
    ]);
    if (!szoba.exists) throw new Error('A szoba megszűnt.');
    const publikus = szoba.data();
    if (publikus.hostUid !== uid) throw new Error('Ezt a szobát nem te vezeted.');
    delete publikus.frissitve;
    delete publikus.letrejott;

    const asztal = new window.AstheticBingoAsztal.Asztal({ kod, hostUid: uid, songs: dalok, valtozas: iro(kod) });
    const tippek = {};
    const feldolgozott = new Set();
    lepesek.forEach((d) => {
      const adat = d.data() || {};
      const j = (publikus.jatekosok || []).find((x) => x.uid === d.id);
      for (const lepes of [adat.tipp, adat.lecsap, adat.jeloles]) if (lepes && lepes.azon) feldolgozott.add(lepes.azon);
      if (j && adat.tipp && adat.tipp.kor === publikus.kor) tippek[j.id] = { eloado: adat.tipp.eloado, cim: adat.tipp.cim, ev: adat.tipp.ev ?? null, lecsap: false };
    });
    asztal.visszaallit(publikus, titkos.exists ? titkos.data() : null, tippek);
    vezetesIndit(kod, asztal);
    vezetes.feldolgozott = feldolgozott;
    return asztal;
  }

  // a játékosok oldala

  async function csatlakozas(kodNyers, nev, kep = null) {
    await init();
    const kod = String(kodNyers || '').trim().toUpperCase();
    const pillanat = await szobaHiv(kod).get();
    if (!pillanat.exists) throw new Error('Nincs ilyen szoba.');
    const szoba = pillanat.data();
    if (szoba.allapot === 'vege') throw new Error('Ez a játék már véget ért.');

    const meglevo = (szoba.jatekosok || []).find((j) => j.uid === uid);
    if (meglevo) return { kod, jatekosId: meglevo.id };

    const hiv = szobaHiv(kod).collection('jelentkezok').doc(uid);
    await hiv.delete().catch(() => {});
    await hiv.set({ nev: B().tisztitNev(nev), kep: B().tisztitKep(kep), mikor: most() });

    const jatekosId = await new Promise((kesz, hiba) => {
      let vege = false;
      const idozito = setTimeout(() => {
        if (vege) return;
        vege = true;
        leiratkoz();
        hiba(new Error('A szobavezető nem válaszol. Nyitva van nála az alkalmazás?'));
      }, 15000);
      const leiratkoz = szobaHiv(kod).onSnapshot((d) => {
        const en = d.exists && (d.data().jatekosok || []).find((j) => j.uid === uid);
        if (vege || !en) return;
        vege = true;
        clearTimeout(idozito);
        leiratkoz();
        kesz(en.id);
      }, () => {});
    });
    return { kod, jatekosId };
  }

  /**
   * A szoba állapotát figyeli. A szobavezető a titkos adatot is megkapja; ez
   * külön figyelőn jön, ezért csak akkor érvényes, ha ugyanahhoz a körhöz tartozik.
   */
  function figyel(kod, jatekosId, visszahivas, hibaVisszahivas) {
    let szoba = null;
    let titkos = null;
    let sajatLepes = null;
    let bentVoltam = false;
    const leiratkozok = [];

    const frissit = () => {
      if (!szoba) return;
      const t = titkos && titkos.kor === szoba.kor ? titkos : null;
      visszahivas({ p: szoba, titkos: t, sajatLepes, jatekosId });
    };

    leiratkozok.push(szobaHiv(kod).onSnapshot((d) => {
      if (!d.exists) {
        if (d.metadata && d.metadata.fromCache) return;
        hibaVisszahivas(new Error('A szoba megszűnt.'));
        return;
      }
      szoba = d.data();
      const bent = (szoba.jatekosok || []).some((j) => j.id === jatekosId);
      if (bent) bentVoltam = true;
      else if (bentVoltam) { hibaVisszahivas(new Error('Kikerültél a szobából.')); return; }
      frissit();
    }, hibaVisszahivas));

    leiratkozok.push(szobaHiv(kod).collection('lepesek').doc(uid).onSnapshot((d) => {
      sajatLepes = d.exists ? d.data() : null;
      frissit();
    }, () => {}));

    leiratkozok.push(szobaHiv(kod).collection('titkos').doc('host').onSnapshot((d) => {
      titkos = d.exists ? d.data() : null;
      frissit();
    }, () => { /* játékosként ez tiltott – így is kell lennie */ }));

    return () => leiratkozok.forEach((f) => { try { f(); } catch { /* mindegy */ } });
  }

  async function lep(kod, jatekosId, mezo, adat) {
    await szobaHiv(kod).collection('lepesek').doc(uid).set({
      jatekosId,
      [mezo]: { ...adat, azon: ujAzon(), mikor: most() },
    }, { merge: true });
  }

  const tipp = (kod, jatekosId, kor, { eloado, cim, ev }) =>
    lep(kod, jatekosId, 'tipp', { kor, eloado: B().tisztitTipp(eloado), cim: B().tisztitTipp(cim), ev: B().evSzam(ev) });
  const lecsap = (kod, jatekosId, kor) => lep(kod, jatekosId, 'lecsap', { kor });
  const jelol = (kod, jatekosId, kor, mezo) => lep(kod, jatekosId, 'jeloles', { kor, mezo: Number(mezo) });

  async function kilep(kod) {
    try {
      const hiv = szobaHiv(kod);
      const d = await hiv.get();
      if (!d.exists) return;
      if (d.data().hostUid === uid) {
        vezetesLeallit();
        for (const gyujtemeny of ['lepesek', 'jelentkezok', 'titkos']) {
          const docs = await hiv.collection(gyujtemeny).get().catch(() => null);
          if (!docs || docs.empty) continue;
          const koteg = db.batch();
          docs.forEach((x) => koteg.delete(x.ref));
          await koteg.commit().catch(() => {});
        }
        await hiv.delete();
        return;
      }
      await hiv.collection('lepesek').doc(uid).delete().catch(() => {});
      await hiv.collection('jelentkezok').doc(uid).delete().catch(() => {});
      await hiv.collection('jelentkezok').doc(uid).set({ kilep: true, mikor: most() });
    } catch { /* kilépéskor már mindegy */ }
  }

  window.AstheticBingoOnline = {
    init,
    dalokBetolt,
    szobaLetrehoz,
    vezetesFolytat,
    vezetesLeallit,
    csatlakozas,
    figyel,
    tipp,
    lecsap,
    jelol,
    kilep,
    get vezetettAsztal() { return vezetes ? vezetes.asztal : null; },
    get uid() { return uid; },
  };
})();
