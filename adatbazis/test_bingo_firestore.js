// A Rubik-Bingó online útjának tesztje a Firebase-emulátoron (auth + firestore):
// jogosultsági szabályok, szobanyitás, csatlakozás, tipp, lecsapás, ikszelés,
// és a szobavezető újratöltése. Az éles adatbázishoz nem nyúl.
//
//     npm i --no-save --legacy-peer-deps firebase@12.4.0
//     firebase emulators:exec --only auth,firestore --project asthetic-798d1 "node adatbazis/test_bingo_firestore.js"
//
// (A Firestore-emulátorhoz legalább Java 11 kell.)

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GYOKER = path.join(__dirname, '..');
const firebase = require('firebase/compat/app');
require('firebase/compat/auth');
require('firebase/compat/firestore');

const BEALLITAS = { apiKey: 'emulator', authDomain: 'localhost', projectId: 'asthetic-798d1', appId: 'emulator' };
const { PORGETES_MS, MINDENKI_KESZ_MS } = require('../js/bingo-asztal.js');

let hibak = 0;
function ellenoriz(felt, uzenet) {
  if (felt) console.log('  OK   ' + uzenet);
  else { console.log('  HIBA ' + uzenet); hibak++; }
}
const var_ = (ms) => new Promise((r) => setTimeout(r, ms));
async function varakozas(felt, maxMs = 10000) {
  const kezdet = Date.now();
  while (Date.now() - kezdet < maxMs) {
    if (felt()) return true;
    await var_(100);
  }
  return false;
}
async function tiltottE(igeret) {
  try { await igeret; return false; } catch (e) { return /permission|PERMISSION/.test(String(e.code || e.message)); }
}

let szamlalo = 0;
async function ujBongeszo(email) {
  const app = firebase.initializeApp(BEALLITAS, 'b' + (++szamlalo));
  app.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
  app.firestore().useEmulator('127.0.0.1', 8080);
  if (email === null) await app.auth().signInAnonymously();
  else {
    const token = JSON.stringify({ sub: 'u-' + email, email, email_verified: true });
    await app.auth().signInWithCredential(firebase.auth.GoogleAuthProvider.credential(token));
  }
  const fb = {
    apps: [app],
    firestore: Object.assign(() => app.firestore(), { FieldValue: firebase.firestore.FieldValue }),
    auth: () => app.auth(),
  };
  const ctx = {
    firebase: fb,
    ASTHETIC: { firebaseIndit: () => fb },
    AstheticFiok: { kesz: async () => {} },
  };
  const sajatFetch = async (url) => {
    const tartalom = fs.readFileSync(path.join(GYOKER, String(url)), 'utf8');
    return { ok: true, json: async () => JSON.parse(tartalom) };
  };
  for (const f of ['js/bingomotor.js', 'js/bingo-asztal.js', 'js/bingo-firestore.js']) {
    const forras = fs.readFileSync(path.join(GYOKER, f), 'utf8');
    vm.runInThisContext('(function (window, globalThis, fetch, module) {\n' + forras + '\n})', { filename: f })
      .call(ctx, ctx, ctx, sajatFetch, undefined);
  }
  return { app, db: app.firestore(), uid: app.auth().currentUser.uid, O: ctx.AstheticBingoOnline, allapot: null };
}

function figyelj(b, kod, jatekosId) {
  b.leiratkoz = b.O.figyel(kod, jatekosId, (n) => { b.allapot = n; }, (h) => { b.hiba = h; });
}

(async () => {
  console.log('Jogosultság');
  const idegen = await ujBongeszo('valaki.mas@gmail.com');
  const nevtelen = await ujBongeszo(null);
  const vezeto = await ujBongeszo('kisskorboy1990@gmail.com');
  const jatekos = await ujBongeszo('richardszenti@gmail.com');

  ellenoriz(await tiltottE(idegen.db.collection('bingo').doc('ZZZZ').set({ hostUid: idegen.uid })), 'idegen Google-fiók nem nyithat szobát');
  ellenoriz(await tiltottE(nevtelen.db.collection('bingo').doc('ZZZZ').set({ hostUid: nevtelen.uid })), 'névtelen felhasználó nem nyithat szobát');

  const { kod, jatekosId: vezetoId } = await vezeto.O.szobaLetrehoz('Kisskorboy', { valaszIdoMp: 12, lecsapIdoMp: 8 });
  ellenoriz(/^[A-Z0-9]{4}$/.test(kod), 'a tesztelő szobát nyitott: ' + kod);
  ellenoriz(await tiltottE(idegen.db.collection('bingo').doc(kod).get()), 'idegen fiók a szobát sem olvashatja');
  ellenoriz(await tiltottE(idegen.O.csatlakozas(kod, 'Betolakodó')), 'idegen fiók nem tud csatlakozni');

  figyelj(vezeto, kod, vezetoId);
  const { jatekosId } = await jatekos.O.csatlakozas(kod, 'Richárd');
  figyelj(jatekos, kod, jatekosId);
  ellenoriz(await varakozas(() => jatekos.allapot && jatekos.allapot.p.jatekosok.length === 2), 'a második tesztelő bekerült a szobába');

  ellenoriz(await tiltottE(jatekos.db.collection('bingo').doc(kod).update({ kor: 99 })), 'játékos nem írhatja a szobát');

  console.log('Kör: tippek és ikszelés');
  const asztal = vezeto.O.vezetettAsztal;
  asztal.indit();
  ellenoriz(await varakozas(() => jatekos.allapot.p.fazis === 'porget'), 'a játékosnál is pörög a kerék');
  ellenoriz(await varakozas(() => jatekos.allapot.p.fazis === 'szol', PORGETES_MS + 3000), 'utána szól a dal');
  ellenoriz(await tiltottE(jatekos.db.collection('bingo').doc(kod).collection('titkos').doc('host').get()), 'a játékos nem olvashatja a dal adatait');
  ellenoriz(jatekos.allapot.titkos === null && !JSON.stringify(jatekos.allapot.p).includes(asztal.t.videoId), 'a játékoshoz nem jut el a videó azonosítója');
  ellenoriz(await varakozas(() => vezeto.allapot.titkos && vezeto.allapot.titkos.videoId === asztal.t.videoId), 'a szobavezető megkapja a dalt');

  const dal = asztal.t.dal;
  await jatekos.O.tipp(kod, jatekosId, jatekos.allapot.p.kor, { eloado: dal.eloado, cim: dal.cim });
  ellenoriz(await varakozas(() => vezeto.allapot.p.bekuldtek.includes(jatekosId)), 'a játékos tippje beérkezett');
  ellenoriz(await tiltottE(vezeto.db.collection('bingo').doc(kod).collection('lepesek').doc(jatekos.uid).set({ tipp: { kor: 1 } })),
    'más nevében nem lehet tippelni (a szobavezető sem írhatja a játékos lépéseit)');
  asztal.tipp(vezetoId, { eloado: 'Senki', cim: 'Semmi' });
  ellenoriz(await varakozas(() => jatekos.allapot.p.allapot === 'eredmeny', MINDENKI_KESZ_MS + 4000), 'mindenki tippelt → eredmény');
  const e = jatekos.allapot.p.eredmeny;
  ellenoriz(e.jogok[jatekosId] === 'szin' && !e.jogok[vezetoId], 'a jó tipp színjogot ad, a rossz nem');
  ellenoriz(e.dal.cim === dal.cim, 'az eredményben már látszik a dal');

  const en = jatekos.allapot.p.jatekosok.find((j) => j.id === jatekosId);
  const mezo = en.kartya.findIndex((s, i) => s === jatekos.allapot.p.szin && !en.jelolt[i]);
  await jatekos.O.jelol(kod, jatekosId, 1, mezo);
  ellenoriz(await varakozas(() => {
    const j = jatekos.allapot.p.jatekosok.find((x) => x.id === jatekosId);
    return j.jelolt[mezo] === 1;
  }), 'a játékos ikszelése megjelent a kártyáján');

  console.log('Lecsapás');
  asztal.kovetkezo();
  ellenoriz(await varakozas(() => jatekos.allapot.p.kor === 2 && jatekos.allapot.p.fazis === 'szol', PORGETES_MS + 4000), '2. kör: szól a dal');
  await jatekos.O.lecsap(kod, jatekosId, 2);
  ellenoriz(await varakozas(() => jatekos.allapot.p.fazis === 'lecsap' && jatekos.allapot.p.lecsapas.jatekosId === jatekosId), 'a lecsapás beérkezett, megállt a dal');
  ellenoriz(await varakozas(() => vezeto.allapot.p.fazis === 'lecsap'), 'a szobavezetőnél is lecsapás látszik');
  const dal2 = asztal.t.dal;
  await jatekos.O.tipp(kod, jatekosId, 2, { eloado: dal2.eloado, cim: dal2.cim });
  ellenoriz(await varakozas(() => jatekos.allapot.p.allapot === 'eredmeny'), 'helyes lecsapás → a kör véget ér');
  ellenoriz(jatekos.allapot.p.eredmeny.jogok[jatekosId] === 'joker', 'a lecsapó jokerjogot kap');

  console.log('A szobavezető újratölti az oldalt');
  vezeto.leiratkoz();
  vezeto.O.vezetesLeallit();
  const vezeto2 = await ujBongeszo('kisskorboy1990@gmail.com');
  const asztal2 = await vezeto2.O.vezetesFolytat(kod);
  ellenoriz(asztal2.p.kor === 2 && asztal2.p.allapot === 'eredmeny', 'a vezetés ugyanott folytatódik');
  const en2 = asztal2.p.jatekosok.find((j) => j.id === jatekosId);
  const mezo2 = en2.kartya.findIndex((s, i) => !en2.jelolt[i] && s !== asztal2.p.szin);
  await jatekos.O.jelol(kod, jatekosId, 2, mezo2);
  ellenoriz(await varakozas(() => jatekos.allapot.p.jatekosok.find((x) => x.id === jatekosId).jelolt[mezo2] === 1),
    'az új vezető feldolgozza a jokeres ikszelést (más színű mező)');
  const regiTipp = asztal2.tippek[jatekosId];
  ellenoriz(!asztal2.jelol(jatekosId, mezo2), 'a korábbi lépések nem futnak le még egyszer');
  void regiTipp;

  console.log('Kilépés');
  await vezeto2.O.kilep(kod);
  const maradt = await jatekos.db.collection('bingo').doc(kod).get().then((d) => d.exists, () => true);
  ellenoriz(!maradt, 'a szobavezető kilépésével a szoba törlődik');
  ellenoriz(await varakozas(() => jatekos.hiba), 'a játékos értesül, hogy a szoba megszűnt');

  jatekos.leiratkoz();
  console.log(hibak ? `\n${hibak} HIBA` : '\nMinden rendben.');
  process.exit(hibak ? 1 : 0);
})().catch((e) => { console.error("VÉGZETES:", e && e.stack ? e.stack : e); process.exit(1); });
