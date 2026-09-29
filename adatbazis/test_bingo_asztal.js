// A Rubik-Bingó játékvezetésének tesztje (js/bingo-asztal.js), gyorsított órával.
//     node adatbazis/test_bingo_asztal.js

const B = require('../js/bingomotor.js');
const { Asztal, PORGETES_MS, JELOLES_MS, MINDENKI_KESZ_MS } = require('../js/bingo-asztal.js');
const songs = require('./songs.json');

let hibak = 0;
function ellenoriz(felt, uzenet) {
  if (felt) console.log('  OK   ' + uzenet);
  else { console.log('  HIBA ' + uzenet); hibak++; }
}

/** Kézzel léptetett óra: az időzítők csak akkor futnak le, amikor előre tekerjük. */
function ujOra() {
  let most = 1_000_000;
  let sorszam = 0;
  const feladatok = new Map();
  return {
    most: () => most,
    utemez: (fn, ms) => { const azon = ++sorszam; feladatok.set(azon, { fn, ido: most + ms }); return azon; },
    torol: (azon) => feladatok.delete(azon),
    teker(ms) {
      const cel = most + ms;
      for (;;) {
        let kov = null;
        for (const [azon, f] of feladatok) if (f.ido <= cel && (!kov || f.ido < kov[1].ido)) kov = [azon, f];
        if (!kov) break;
        feladatok.delete(kov[0]);
        most = kov[1].ido;
        kov[1].fn();
      }
      most = cel;
    },
  };
}

function ujAsztal(beallitas = {}) {
  const ora = ujOra();
  let utolso = null;
  let n = 0;
  const asztal = new Asztal({
    kod: 'TESZT', beallitas, songs, ora,
    azonosito: () => 'j' + (++n),
    valtozas: (a) => { utolso = a; },
  });
  return { asztal, ora, allapot: () => utolso };
}

/** A dal tényleges adataival tippel – ez biztosan jó. */
const joTipp = (asztal) => ({ eloado: asztal.t.dal.eloado, cim: asztal.t.dal.cim, ev: asztal.t.dal.ev });
const rosszTipp = { eloado: 'Senki Sem', cim: 'Nincs ilyen dal', ev: 1901 };

function mezoSzinnel(j, szin, jelolt = j.jelolt) {
  return j.kartya.findIndex((s, i) => s === szin && !jelolt[i]);
}
function mezoMasSzinnel(j, szin) {
  return j.kartya.findIndex((s, i) => s !== szin && !j.jelolt[i]);
}

console.log('Kör: pörgetés, dal, tippek');
{
  const { asztal, ora, allapot } = ujAsztal();
  const a = asztal.jatekosFelvesz({ nev: 'Anna', host: true });
  const b = asztal.jatekosFelvesz({ nev: 'Bence' });
  const c = asztal.jatekosFelvesz({ nev: 'Csilla' });
  asztal.indit();

  let p = allapot().publikus;
  ellenoriz(p.allapot === 'kor' && p.fazis === 'porget' && p.kor === 1, 'indítás után pörög a kerék');
  ellenoriz(p.szin >= 0 && p.szin < 5, 'a kerék egy színt dobott ki (joker nélkül)');
  ellenoriz(p.jatekosok.every((j) => j.kartya.length === 25 && j.jelolt.every((x) => x === 0)), 'mindenki kapott üres kártyát');
  ellenoriz(!asztal.tipp(a, joTipp(asztal)), 'pörgetés közben még nem lehet tippelni');

  const nyilvanos = JSON.stringify(p);
  ellenoriz(!nyilvanos.includes(asztal.t.videoId) && !nyilvanos.includes(JSON.stringify(asztal.t.dal.cim)),
    'a nyilvános állapotban nincs benne a dal címe és videója');

  ora.teker(PORGETES_MS);
  p = allapot().publikus;
  ellenoriz(p.fazis === 'szol' && p.hatralevoMs === 30000, 'a pörgetés után szól a dal, 30 mp van hátra');
  ellenoriz(allapot().titkos.videoId && allapot().titkos.kor === 1, 'a titkos állapotban ott a videó és a kör száma');

  const szin = p.szin;
  asztal.tipp(a, joTipp(asztal));
  asztal.tipp(b, rosszTipp);
  ora.teker(5000);
  ellenoriz(allapot().publikus.bekuldtek.length === 2 && allapot().publikus.allapot === 'kor', 'két tipp után még szól a dal');
  asztal.tipp(c, { eloado: asztal.t.dal.eloado.toLowerCase(), cim: asztal.t.dal.cim + '!', ev: String(asztal.t.dal.ev + 1) });
  ellenoriz(allapot().publikus.hatralevoMs === MINDENKI_KESZ_MS, 'a harmadik tipp után már csak a rövid szünet van hátra');
  ora.teker(MINDENKI_KESZ_MS);
  p = allapot().publikus;
  ellenoriz(p.allapot === 'eredmeny', 'ha mindenki beküldte, rögtön jön az eredmény');
  ellenoriz(p.eredmeny.jogok[a] === 'szin' && p.eredmeny.jogok[c] === 'szin' && !p.eredmeny.jogok[b], 'a jó tippelők színjogot kapnak, a rossz nem');
  ellenoriz(p.eredmeny.dal.cim === asztal.t.dal.cim, 'az eredményben már látszik a dal');

  const anna = asztal.jatekos(a);
  ellenoriz(!asztal.jelol(a, mezoMasSzinnel(anna, szin)), 'más színű mezőt nem ikszelhet');
  ellenoriz(!asztal.jelol(b, mezoSzinnel(asztal.jatekos(b), szin)), 'aki nem találta el, nem ikszelhet');
  const annaMezo = mezoSzinnel(anna, szin);
  ellenoriz(asztal.jelol(a, annaMezo) && anna.jelolt[annaMezo] === 1, 'a kidobott színű mezőt beikszelheti');
  ellenoriz(!asztal.jelol(a, mezoSzinnel(anna, szin)), 'egy körben csak egyszer ikszelhet');
  ora.teker(JELOLES_MS);
  p = allapot().publikus;
  const csilla = asztal.jatekos(c);
  ellenoriz(p.eredmeny.jelolesek[c] !== undefined && csilla.kartya[p.eredmeny.jelolesek[c]] === szin, 'aki nem választott időben, annak a gép ikszel a kidobott színből');
  ellenoriz(p.allapot === 'eredmeny', 'bingó nélkül a szobavezetőre vár');

  const elsoDal = allapot().titkos.dal.id;
  asztal.kovetkezo();
  ellenoriz(allapot().publikus.kor === 2 && allapot().publikus.fazis === 'porget', 'következő kör: újra pörög a kerék');
  ellenoriz(allapot().titkos.dal.id !== elsoDal && allapot().titkos.kor === 2, 'új dal jön');
  const hasznalt = allapot().publikus.hasznaltDalok;
  ellenoriz(new Set(hasznalt).size === hasznalt.length, 'egy dal sem jön kétszer');
}

console.log('Lecsapás');
{
  const { asztal, ora, allapot } = ujAsztal({ lecsapIdoMp: 10 });
  const a = asztal.jatekosFelvesz({ nev: 'Anna', host: true });
  const b = asztal.jatekosFelvesz({ nev: 'Bence' });
  const c = asztal.jatekosFelvesz({ nev: 'Csilla' });
  asztal.indit();
  ora.teker(PORGETES_MS);

  asztal.tipp(c, joTipp(asztal));        // Csilla csendben, papíron beírta
  ora.teker(8000);
  ellenoriz(asztal.lecsap(a), 'Anna lecsap');
  let p = allapot().publikus;
  ellenoriz(p.fazis === 'lecsap' && p.lecsapas.jatekosId === a && p.hatralevoMs === 10000, 'megáll a dal, Annának 10 mp-e van');
  ellenoriz(!asztal.lecsap(b), 'amíg Anna válaszol, más nem csaphat le');
  ellenoriz(!asztal.tipp(b, joTipp(asztal)), 'amíg Anna válaszol, más nem küldhet tippet');

  asztal.tipp(a, rosszTipp);
  p = allapot().publikus;
  ellenoriz(p.fazis === 'szol' && p.kiesettek.includes(a), 'Anna tévedett: kiesett, a dal szól tovább');
  ellenoriz(p.hatralevoMs === 22000, 'a többieknek ott folytatódik az idő, ahol megállt (22 mp)');
  ellenoriz(!asztal.lecsap(a), 'a kiesett játékos nem csaphat le újra');
  ellenoriz(!asztal.tipp(a, joTipp(asztal)), 'a kiesett játékos tippje nem számít');

  ora.teker(3000);
  ellenoriz(asztal.lecsap(b), 'Bence lecsap');
  asztal.tipp(b, joTipp(asztal));
  p = allapot().publikus;
  ellenoriz(p.allapot === 'eredmeny', 'Bence eltalálta: a kör rögtön véget ér');
  ellenoriz(p.eredmeny.jogok[b] === 'joker', 'a helyes lecsapásért jokerjog jár (bármelyik mező)');
  ellenoriz(p.eredmeny.jogok[c] === 'szin', 'aki előtte már beküldte a jó tippet, megkapja a színjogát');
  ellenoriz(!p.eredmeny.jogok[a], 'a hibás lecsapó nem ikszelhet');

  const bence = asztal.jatekos(b);
  ellenoriz(asztal.jelol(b, mezoMasSzinnel(bence, p.szin)), 'jokerrel más színű mező is ikszelhető');
}

console.log('Lecsapás: lejár az idő');
{
  const { asztal, ora, allapot } = ujAsztal({ lecsapIdoMp: 10 });
  const a = asztal.jatekosFelvesz({ nev: 'Anna' });
  const b = asztal.jatekosFelvesz({ nev: 'Bence' });
  asztal.indit();
  ora.teker(PORGETES_MS + 1000);
  asztal.lecsap(a);
  ora.teker(10000);
  const p = allapot().publikus;
  ellenoriz(p.fazis === 'szol' && p.kiesettek.includes(a), 'ha a lecsapó nem ír semmit, kiesik');
  asztal.lecsap(b);
  ora.teker(10000);
  ellenoriz(allapot().publikus.allapot === 'eredmeny', 'ha mindenki kiesett, vége a körnek');
  ellenoriz(!Object.keys(allapot().publikus.eredmeny.jogok).length, 'senki nem ikszelhet');
}

console.log('Lecsapás kikapcsolva');
{
  const { asztal, ora } = ujAsztal({ lecsapas: false });
  const a = asztal.jatekosFelvesz({ nev: 'Anna' });
  asztal.indit();
  ora.teker(PORGETES_MS);
  ellenoriz(!asztal.lecsap(a), 'a szobabeállítás szerint nem lehet lecsapni');
}

console.log('Idő lejárta, elírás, felülbírálás');
{
  const { asztal, ora, allapot } = ujAsztal({ elfogadas: 'pontos' });
  const a = asztal.jatekosFelvesz({ nev: 'Anna' });
  const b = asztal.jatekosFelvesz({ nev: 'Bence' });
  asztal.indit();
  ora.teker(PORGETES_MS);
  asztal.tipp(a, { eloado: asztal.t.dal.eloado, cim: asztal.t.dal.cim + 'xx', ev: asztal.t.dal.ev });
  ora.teker(30000);
  let p = allapot().publikus;
  ellenoriz(p.allapot === 'eredmeny' && !p.eredmeny.jogok[a], 'pontos módban az elírás nem ér – lejárt az idő');
  ellenoriz(p.eredmeny.tippek.find((t) => t.jatekosId === b).kuldott === false, 'aki nem tippelt, annál „nem küldött” szerepel');

  asztal.felulbiral(a, true);
  p = allapot().publikus;
  ellenoriz(p.eredmeny.jogok[a] === 'szin', 'a szobavezető elfogadja: Anna ikszelhet');
  const anna = asztal.jatekos(a);
  const mezo = mezoSzinnel(anna, p.szin);
  asztal.jelol(a, mezo);
  asztal.felulbiral(a, false);
  ellenoriz(anna.jelolt[mezo] === 0 && !allapot().publikus.eredmeny.jogok[a], 'visszavonva: az X is lekerül');
}

console.log('Bingó');
{
  const { asztal, ora, allapot } = ujAsztal();
  const a = asztal.jatekosFelvesz({ nev: 'Anna' });
  const b = asztal.jatekosFelvesz({ nev: 'Bence' });
  asztal.indit();
  const anna = asztal.jatekos(a);
  const bence = asztal.jatekos(b);
  // Anna első sorából négy már ki van ikszelve.
  [0, 1, 2, 3].forEach((i) => { anna.jelolt[i] = 1; });
  [0, 1, 2, 3].forEach((i) => { bence.jelolt[i] = 1; });
  ora.teker(PORGETES_MS);
  asztal.lecsap(a);
  asztal.tipp(a, joTipp(asztal));
  asztal.jelol(a, 4);
  let p = allapot().publikus;
  ellenoriz(p.allapot === 'vege' && p.nyertesek.length === 1 && p.nyertesek[0] === a, 'Anna kirakta a sort: BINGÓ, ő nyert');

  asztal.ujra();
  p = allapot().publikus;
  ellenoriz(p.allapot === 'lobby' && p.jatekosok.every((j) => j.kartya === null), 'új menet: vissza a váróba, a kártyák törölve');
}

console.log('Egyszerre két nyertes');
{
  const { asztal, ora, allapot } = ujAsztal({ joker: true });
  const a = asztal.jatekosFelvesz({ nev: 'Anna' });
  const b = asztal.jatekosFelvesz({ nev: 'Bence' });
  asztal.indit();
  const anna = asztal.jatekos(a);
  const bence = asztal.jatekos(b);
  [0, 1, 2, 3].forEach((i) => { anna.jelolt[i] = 1; bence.jelolt[i] = 1; });
  ora.teker(PORGETES_MS);
  asztal.p.szin = B.JOKER;                // a kerék fehéret dobott
  asztal.tipp(a, joTipp(asztal));
  asztal.tipp(b, joTipp(asztal));
  ora.teker(MINDENKI_KESZ_MS);
  asztal.jelol(a, 4);
  ellenoriz(allapot().publikus.allapot === 'eredmeny', 'az első bingó után még megvárjuk a másik jogosultat');
  asztal.jelol(b, 4);
  const p = allapot().publikus;
  ellenoriz(p.allapot === 'vege' && p.nyertesek.length === 2, 'mindketten kirakták: két nyertes');
}

console.log('Dal kihagyása, szobavezető nézőként');
{
  const { asztal, ora, allapot } = ujAsztal({ vezetoJatszik: false });
  asztal.jatekosFelvesz({ nev: 'Vezető', host: true, nezo: true });
  const a = asztal.jatekosFelvesz({ nev: 'Anna' });
  asztal.indit();
  ora.teker(PORGETES_MS);
  const elotte = allapot();
  asztal.dalKihagy();
  const utana = allapot();
  ellenoriz(utana.publikus.kor === elotte.publikus.kor && utana.publikus.szin === elotte.publikus.szin, 'kihagyás: a kör és a szín marad');
  ellenoriz(utana.titkos.dal.id !== elotte.titkos.dal.id && utana.publikus.fazis === 'szol', 'kihagyás: másik dal, újrapörgetés nélkül');
  ellenoriz(asztal.jatekos(utana.publikus.jatekosok[0].id).kartya === null, 'a csak levezető szobavezetőnek nincs kártyája');
  asztal.tipp(a, joTipp(asztal));
  ora.teker(MINDENKI_KESZ_MS);
  ellenoriz(allapot().publikus.allapot === 'eredmeny', 'a „mindenki beküldte” a nézőt nem várja meg');
}

console.log('Újratöltés után folytatás');
{
  const { asztal, ora, allapot } = ujAsztal();
  asztal.jatekosFelvesz({ nev: 'Anna' });
  asztal.indit();
  ora.teker(PORGETES_MS + 10000);
  const mentett = allapot();
  ora.teker(4000);   // a szobavezető 4 mp alatt töltötte újra az oldalt
  const uj = new Asztal({ kod: 'TESZT', songs, ora, valtozas: () => {} });
  let kiirt = null;
  uj.valtozas = (x) => { kiirt = x; };
  uj.visszaallit(mentett.publikus, mentett.titkos, {});
  ellenoriz(kiirt.publikus.fazis === 'szol' && kiirt.publikus.hatralevoMs === 16000, 'a futó kör a helyes hátralévő idővel folytatódik (16 mp)');
  ora.teker(16000);
  ellenoriz(kiirt.publikus.allapot === 'eredmeny', 'és az idő végén kiértékel');
}

console.log('Körkorlát és más nyerési mód');
{
  const { asztal, ora, allapot } = ujAsztal({ maxKor: 2, nyeres: 'sarkok' });
  const a = asztal.jatekosFelvesz({ nev: 'Anna' });
  const b = asztal.jatekosFelvesz({ nev: 'Bence' });
  asztal.indit();
  const anna = asztal.jatekos(a);
  [0, 1, 2, 3].forEach((i) => { anna.jelolt[i] = 1; });   // majdnem kész sor – sarkok módban nem nyer
  ora.teker(PORGETES_MS);
  asztal.lecsap(a);
  asztal.tipp(a, joTipp(asztal));
  asztal.jelol(a, 4);
  ellenoriz(allapot().publikus.allapot === 'eredmeny', 'sarkok módban a kirakott sor nem nyer');
  asztal.jatekos(b).jelolt[24] = 1;
  asztal.kovetkezo();
  ora.teker(PORGETES_MS + 30000);
  asztal.kovetkezo();
  const p = allapot().publikus;
  ellenoriz(p.allapot === 'vege' && /2 kör/.test(p.uzenet), 'a 2. kör után vége: letelt a körök száma');
  ellenoriz(p.nyertesek.length === 1 && p.nyertesek[0] === a, 'a legtöbb sarokkal rendelkező nyer (Anna: 2, Bence: 1)');
}

console.log(hibak ? `\n${hibak} HIBA` : '\nMinden rendben.');
process.exit(hibak ? 1 : 0);
