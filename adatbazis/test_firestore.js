// Végponttól végpontig teszt a Firestore-os Kvízcsatára — az ÉLES adatbázison.
//
// Ugyanazokat a böngészős fájlokat tölti be (js/kahoot-firestore.js,
// js/kahoot-vezeto.js, js/jatekmotor.js), amiket a weboldal, csak Node-ban,
// különálló "böngészőkben" (vm-környezetekben): egy szobavezető és két játékos,
// mindegyik saját névtelen Firebase-felhasználóval. A teszt végén minden
// létrehozott szobát töröl.
//
// A firebase csomag nem függősége a projektnek (a weboldal CDN-ről tölti),
// ezért futtatás előtt egyszer:
//     npm i --no-save firebase@12.4.0
//     node adatbazis/test_firestore.js

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GYOKER = path.join(__dirname, '..');
const firebase = require('firebase/compat/app');
require('firebase/compat/auth');
require('firebase/compat/firestore');

const BEALLITAS = {
  apiKey: 'AIzaSyBiBhnlOmE8Fyw5s_PxGVzTesqITWfZkSg',
  authDomain: 'asthetic-798d1.firebaseapp.com',
  projectId: 'asthetic-798d1',
  storageBucket: 'asthetic-798d1.firebasestorage.app',
  messagingSenderId: '494747985041',
  appId: '1:494747985041:web:b011d8790b5cd2511acb30',
};

let hibak = [];
function ellenoriz(felt, uzenet) {
  if (felt) console.log('  OK   ' + uzenet);
  else { console.log('  HIBA ' + uzenet); hibak.push(uzenet); }
}
const var_ = (ms) => new Promise((r) => setTimeout(r, ms));

/** Addig vár, amíg a feltétel igaz nem lesz; visszaadja az eltelt időt (ms), vagy null-t. */
async function varakozas(felt, maxMs) {
  const kezdet = Date.now();
  while (Date.now() - kezdet < maxMs) {
    if (felt()) return Date.now() - kezdet;
    await var_(100);
  }
  return null;
}

/* ───────── egy "böngésző": saját Firebase-app, saját globális tér ───────── */

let kliensSzam = 0;
function ujBongeszo(nev) {
  const app = firebase.initializeApp(BEALLITAS, 'teszt-' + (++kliensSzam) + '-' + nev);
  const fb = {
    apps: [app],
    initializeApp: () => app,
    firestore: Object.assign(() => app.firestore(), { FieldValue: firebase.firestore.FieldValue }),
    auth: () => app.auth(),
  };

  // A szkriptek a fő környezetben futnak (külön vm-kontextusban a Firestore
  // "idegen" objektumnak látná a bennük létrehozott adatokat), de mindegyik
  // böngésző saját window/globalThis/firebase/fetch változót kap paraméterként.
  const ctx = {};
  const sajatFetch = async (url) => {
    const fajl = path.join(GYOKER, String(url).split('?')[0]);
    const tartalom = fs.readFileSync(fajl, 'utf8');
    return { ok: true, json: async () => JSON.parse(tartalom) };
  };

  for (const f of ['adatbazis/question_engine.js', 'js/jatekmotor.js', 'js/kahoot-firestore.js', 'js/kahoot-vezeto.js']) {
    const forras = fs.readFileSync(path.join(GYOKER, f), 'utf8');
    const burok = vm.runInThisContext(
      '(function (window, globalThis, firebase, fetch, module) {\n' + forras + '\n})',
      { filename: f },
    );
    burok.call(ctx, ctx, ctx, fb, sajatFetch, undefined);
  }
  return { nev, app, FS: ctx.AstheticFirestore, V: ctx.AstheticVezeto, allapot: null, leiratkoz: null };
}

function figyelj(b, kod, jatekosId) {
  b.tortenet = [];
  b.leiratkoz = b.FS.figyel(kod, jatekosId, (a) => {
    b.tortenet.push({
      allapot: a.allapot,
      kor: a.kor,
      videoId: a.kerdes ? a.kerdes.videoId : null,
      valaszok: a.kerdes && a.kerdes.valaszok ? a.kerdes.valaszok.join('|') : null,
      eredmenyVideo: a.eredmeny && a.eredmeny.dal ? a.eredmeny.dal.videoId : null,
      eredmenyValaszok: a.eredmeny && a.eredmeny.valaszok ? a.eredmeny.valaszok.join('|') : null,
    }); const l = a.jatekosok.map((j) => j.nev).join(','); if (process.env.DBG && l !== b._l) { console.log('    [' + b.nev + '] ' + l + ' (' + a.allapot + ')'); b._l = l; } b.allapot = a; }, (h) => { b.hiba = h; });
}

const letrehozottSzobak = [];

async function szobaJatekosokkal(beallitas) {
  const host = ujBongeszo('host');
  const p1 = ujBongeszo('p1');
  const p2 = ujBongeszo('p2');
  await Promise.all([host.FS.init(), p1.FS.init(), p2.FS.init()]);

  const { kod, jatekosId } = await host.FS.szobaLetrehoz('Vezető', beallitas);
  letrehozottSzobak.push({ host, kod });
  host.V.indit(kod);
  host.jatekosId = jatekosId;
  figyelj(host, kod, jatekosId);

  const b1 = await p1.FS.csatlakozas(kod, 'Anna');
  const b2 = await p2.FS.csatlakozas(kod, 'Bence');
  p1.jatekosId = b1.jatekosId; p2.jatekosId = b2.jatekosId;
  figyelj(p1, kod, p1.jatekosId);
  figyelj(p2, kod, p2.jatekosId);
  return { host, p1, p2, kod };
}

function takarit(...bongeszok) {
  for (const b of bongeszok) {
    try { b.leiratkoz && b.leiratkoz(); } catch { /* mindegy */ }
    try { b.V.leallit(); } catch { /* mindegy */ }
  }
}

/* ───────────────────────── tesztek ───────────────────────── */

async function tesztMindenkiValaszolt() {
  console.log('\n1) Ha mindenki válaszolt, a kör azonnal lezárul (30 mp-es keretnél)');
  const { host, p1, p2, kod } = await szobaJatekosokkal({
    korokSzama: 2, valaszIdoMp: 30, mindenkiUtanTovabb: true, tipusok: ['year'],
  });

  await host.V.jatekIndit(kod);
  const kerdesIdo = await varakozas(() => [host, p1, p2].every((b) => b.allapot && b.allapot.allapot === 'kerdes'), 15000);
  ellenoriz(kerdesIdo !== null, 'mindhárom kliens megkapta a kérdést');

  await host.FS.valaszAd(kod, host.jatekosId, 0, host.allapot.kor);
  await p1.FS.valaszAd(kod, p1.jatekosId, 1, p1.allapot.kor);
  await var_(1500);
  ellenoriz(host.allapot.allapot === 'kerdes', 'két válasz után (a harmadik még hiányzik) a kör még tart');
  ellenoriz(host.allapot.valaszoltakSzama === 2, `a számláló 2 választ mutat (${host.allapot.valaszoltakSzama})`);

  await p2.FS.valaszAd(kod, p2.jatekosId, 2, p2.allapot.kor);
  const lezaras = await varakozas(() => p2.allapot && p2.allapot.allapot === 'eredmeny', 25000);
  ellenoriz(lezaras !== null && lezaras < 5000,
    `az utolsó válasz után ${lezaras === null ? '25+ mp' : (lezaras / 1000).toFixed(1) + ' mp'} alatt jött az eredmény (elvárt: < 5 mp)`);

  const e = p2.allapot.eredmeny;
  ellenoriz(e && e.korEredmeny.length === 3 && e.korEredmeny.every((r) => r.valaszolt), `az eredményben mindhárom játékos válasza szerepel (${e ? JSON.stringify(e.korEredmeny.map((r) => [r.nev, r.valaszolt])) : "nincs"})`);

  // 2. kör: a régi válaszok nem számíthatnak bele
  await host.V.kovetkezoKor(kod);
  await varakozas(() => [host, p1, p2].every((b) => b.allapot && b.allapot.allapot === 'kerdes' && b.allapot.kor === 2), 15000);
  await var_(800);
  ellenoriz(p1.allapot.sajatValasz === null, 'új körben a játékos korábbi válasza nem látszik kiválasztottnak');
  ellenoriz(host.allapot.valaszoltakSzama === 0, `új körben 0-ról indul a számláló (${host.allapot.valaszoltakSzama})`);

  takarit(host, p1, p2);
}

async function tesztKilepes() {
  console.log('\n2) Ha egy játékos kilép, a maradék válaszai után is továbblép a kör');
  const { host, p1, p2, kod } = await szobaJatekosokkal({
    korokSzama: 2, valaszIdoMp: 30, mindenkiUtanTovabb: true, tipusok: ['year'],
  });
  await host.V.jatekIndit(kod);
  await varakozas(() => [host, p1, p2].every((b) => b.allapot && b.allapot.allapot === 'kerdes'), 15000);

  await p2.FS.kilep(kod);
  const kiveve = await varakozas(() => host.allapot.jatekosok.length === 2, 10000);
  ellenoriz(kiveve !== null, 'a kilépett játékos lekerült a játékoslistáról');

  await host.FS.valaszAd(kod, host.jatekosId, 0, host.allapot.kor);
  await p1.FS.valaszAd(kod, p1.jatekosId, 1, p1.allapot.kor);
  const lezaras = await varakozas(() => p1.allapot && p1.allapot.allapot === 'eredmeny', 25000);
  ellenoriz(lezaras !== null && lezaras < 5000,
    `a két bent maradt válasza után ${lezaras === null ? '25+ mp' : (lezaras / 1000).toFixed(1) + ' mp'} alatt jött az eredmény`);

  takarit(host, p1, p2);
}

async function tesztKikapcsolva() {
  console.log('\n3) Ellenpróba: kikapcsolt "mindenki után tovább" mellett kivárjuk az időt');
  const { host, p1, p2, kod } = await szobaJatekosokkal({
    korokSzama: 1, valaszIdoMp: 8, mindenkiUtanTovabb: false, tipusok: ['year'],
  });
  await host.V.jatekIndit(kod);
  await varakozas(() => [host, p1, p2].every((b) => b.allapot && b.allapot.allapot === 'kerdes'), 15000);
  const indult = Date.now();
  await Promise.all([
    host.FS.valaszAd(kod, host.jatekosId, 0, host.allapot.kor),
    p1.FS.valaszAd(kod, p1.jatekosId, 0, p1.allapot.kor),
    p2.FS.valaszAd(kod, p2.jatekosId, 0, p2.allapot.kor),
  ]);
  await var_(3000);
  ellenoriz(host.allapot.allapot === 'kerdes', 'mindenki válaszolt, de a kör még tart (ki van kapcsolva)');
  await varakozas(() => host.allapot.allapot === 'eredmeny', 15000);
  const eltelt = (Date.now() - indult) / 1000;
  ellenoriz(eltelt >= 7, `az eredmény a keret végén jött (${eltelt.toFixed(1)} mp)`);
  takarit(host, p1, p2);
}

async function tesztHallgatasUjratoltes() {
  console.log('\n4) Hallgatási szakasz alatt újratöltött szobavezető után is megnyílnak a válaszok');
  const { host, p1, p2, kod } = await szobaJatekosokkal({
    korokSzama: 1, valaszIdoMp: 10, elobbZeneMp: 4, tipusok: ['year'],
  });
  await host.V.jatekIndit(kod);
  await varakozas(() => p1.allapot && p1.allapot.allapot === 'kerdes', 15000);
  ellenoriz(p1.allapot.kerdes.valaszNyitva === false, 'a hallgatás alatt a válaszok zárva vannak');

  // "Oldalfrissítés": a vezetés leáll, majd újraindul — elvesznek az időzítők.
  host.V.leallit();
  await var_(500);
  host.V.indit(kod);

  const nyilt = await varakozas(() => p1.allapot.kerdes && p1.allapot.kerdes.valaszNyitva === true, 12000);
  ellenoriz(nyilt !== null, `a válaszok megnyíltak az újraindult vezetésnél is (${nyilt === null ? 'nem' : (nyilt / 1000).toFixed(1) + ' mp'})`);
  takarit(host, p1, p2);
}

async function tesztKesoValasz() {
  console.log('\n5) Az előző körből ottmaradt válasz nem számít bele az új körbe');
  const { host, p1, p2, kod } = await szobaJatekosokkal({
    korokSzama: 3, valaszIdoMp: 30, mindenkiUtanTovabb: true, tipusok: ['year'],
  });
  await host.V.jatekIndit(kod);
  await varakozas(() => [host, p1, p2].every((b) => b.allapot && b.allapot.allapot === 'kerdes'), 15000);
  await Promise.all([
    host.FS.valaszAd(kod, host.jatekosId, 0, host.allapot.kor),
    p1.FS.valaszAd(kod, p1.jatekosId, 0, p1.allapot.kor),
    p2.FS.valaszAd(kod, p2.jatekosId, 0, p2.allapot.kor),
  ]);
  await varakozas(() => host.allapot.allapot === 'eredmeny', 25000);

  // Késve beérkező válasz az eredmény-szakaszban (pl. lassú hálózat).
  await p2.FS.valaszAd(kod, p2.jatekosId, 3, p2.allapot.kor).catch(() => {});
  await host.V.kovetkezoKor(kod);
  await varakozas(() => host.allapot.allapot === 'kerdes' && host.allapot.kor === 2, 15000);
  await var_(1500);
  ellenoriz(host.allapot.valaszoltakSzama === 0, `az új kör 0 válasszal indul (${host.allapot.valaszoltakSzama})`);
  ellenoriz(host.allapot.allapot === 'kerdes', 'az új kör nem zárult le magától');
  takarit(host, p1, p2);
}

async function tesztZeneKorhoz() {
  console.log('\n6) A szobavezetőnél mindig az aktuális kör dala szól (nem az előzőé)');
  for (const csakSzinek of [false, true]) {
    const { host, p1, p2, kod } = await szobaJatekosokkal({
      korokSzama: 3, valaszIdoMp: 30, mindenkiUtanTovabb: true, tipusok: ['year', 'title'], csakSzinek,
    });
    await host.V.jatekIndit(kod);
    for (let kor = 1; kor <= 3; kor++) {
      await varakozas(() => host.allapot && host.allapot.allapot === 'kerdes' && host.allapot.kor === kor, 15000);
      await var_(800);
      await Promise.all([host, p1, p2].map((b) => b.FS.valaszAd(kod, b.jatekosId, 0, kor)));
      await varakozas(() => host.allapot.allapot === 'eredmeny' && host.allapot.kor === kor, 15000);
      if (kor < 3) await host.V.kovetkezoKor(kod);
    }

    const mod = csakSzinek ? ' (csak színek)' : '';
    for (let kor = 1; kor <= 3; kor++) {
      const eredmeny = host.tortenet.find((t) => t.allapot === 'eredmeny' && t.kor === kor);
      const helyesDal = eredmeny && eredmeny.eredmenyVideo;
      const latott = host.tortenet.filter((t) => t.allapot === 'kerdes' && t.kor === kor && t.videoId);
      const rossz = latott.filter((t) => t.videoId !== helyesDal);
      ellenoriz(latott.length > 0 && rossz.length === 0,
        `${kor}. kör${mod}: a szobavezető ${latott.length ? 'csak a kör saját dalát kapta' : 'NEM kapott dalt'}${rossz.length ? ` — ${rossz.length}× egy másik kör dalát (${rossz[0].videoId} ≠ ${helyesDal})` : ''}`);

      const latottValasz = host.tortenet.filter((t) => t.allapot === 'kerdes' && t.kor === kor && t.valaszok);
      const rosszValasz = latottValasz.filter((t) => t.valaszok !== eredmeny.eredmenyValaszok);
      ellenoriz(latottValasz.length > 0 && rosszValasz.length === 0,
        `${kor}. kör${mod}: a szobavezető a kör saját válaszait látta${rosszValasz.length ? ' — HIBA: egy másik körét is' : ''}`);
    }
    takarit(host, p1, p2);
  }
}

async function torlesMindent() {
  for (const { host, kod } of letrehozottSzobak) {
    try { await host.FS.kilep(kod); } catch { /* már nincs */ }
  }
}

(async () => {
  const csak = process.argv[2];
  const tesztek = { 1: tesztMindenkiValaszolt, 2: tesztKilepes, 3: tesztKikapcsolva, 4: tesztHallgatasUjratoltes, 5: tesztKesoValasz, 6: tesztZeneKorhoz };
  try {
    for (const [szam, teszt] of Object.entries(tesztek)) {
      if (!csak || csak === szam) await teszt();
    }
  } catch (e) {
    hibak.push('kivétel: ' + (e && e.stack || e));
    console.error(e);
  } finally {
    await torlesMindent();
  }

  console.log('\n================================');
  if (hibak.length) { console.log(`${hibak.length} HIBA:`); hibak.forEach((h) => console.log('  - ' + h)); }
  else console.log('MINDEN TESZT ATMENT.');
  process.exit(hibak.length ? 1 : 0);
})();
