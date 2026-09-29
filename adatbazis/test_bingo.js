// A Rubik-Bingó szabályainak tesztje (js/bingomotor.js).
//     node adatbazis/test_bingo.js

const B = require('../js/bingomotor.js');
const songs = require('./songs.json');

let hibak = 0;
function ellenoriz(felt, uzenet) {
  if (felt) console.log('  OK   ' + uzenet);
  else { console.log('  HIBA ' + uzenet); hibak++; }
}

console.log('Kártya');
for (let n = 0; n < 200; n++) {
  const k = B.kartyaKeszit();
  const db = [0, 0, 0, 0, 0];
  k.forEach((s) => db[s]++);
  if (k.length !== 25 || db.some((d) => d !== 5)) { ellenoriz(false, 'minden szín pontosan ötször: ' + k.join('')); break; }
  if (n === 199) ellenoriz(true, '200 kártyából mindegyiken minden szín pontosan ötször');
}
const kulonbozo = new Set(Array.from({ length: 50 }, () => B.kartyaKeszit().join(''))).size;
ellenoriz(kulonbozo === 50, `50 kártya mind különböző (${kulonbozo})`);

console.log('Bingó-vonalak');
const ures = Array(25).fill(false);
ellenoriz(!B.bingoE(ures), 'üres kártyán nincs bingó');
ellenoriz(B.VONALAK.length === 12, '12 nyerő vonal (5 sor, 5 oszlop, 2 átló)');
for (const [nev, mezok] of [['sor', [10, 11, 12, 13, 14]], ['oszlop', [2, 7, 12, 17, 22]], ['átló', [0, 6, 12, 18, 24]], ['mellékátló', [4, 8, 12, 16, 20]]]) {
  const j = ures.slice();
  mezok.forEach((i) => { j[i] = true; });
  ellenoriz(B.bingoE(j), `${nev} kiadja a bingót`);
  j[mezok[2]] = false;
  ellenoriz(!B.bingoE(j), `${nev} egy lyukkal nem bingó`);
}
const szetszort = ures.slice();
[0, 1, 2, 3, 5, 6, 7, 8, 10, 11, 15, 22, 23].forEach((i) => { szetszort[i] = true; });
ellenoriz(!B.bingoE(szetszort), '13 X, de egyik vonal sem teljes → nincs bingó');

console.log('Jelölhető mezők');
const kartya = [0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4, 0, 1, 2, 3, 4];
let j = ures.slice();
ellenoriz(JSON.stringify(B.jelolhetoMezok(kartya, j, 'szin', 2)) === '[2,7,12,17,22]', 'színjog: csak a kidobott színű mezők');
j[7] = true;
ellenoriz(!B.jelolhetoMezok(kartya, j, 'szin', 2).includes(7), 'a már bejelölt mező nem jelölhető újra');
ellenoriz(B.jelolhetoMezok(kartya, j, 'joker', 2).length === 24, 'jokerjog: bármelyik üres mező');
ellenoriz(B.jelolhetoMezok(kartya, j, 'szin', B.JOKER).length === 24, 'a kerék fehér mezője is jokerjog');
[2, 12, 17, 22].forEach((i) => { j[i] = true; });
ellenoriz(B.jelolhetoMezok(kartya, j, 'szin', 2).length === 20, 'ha a színből nincs több üres, bármelyik üres jelölhető');

j = ures.slice();
[10, 11, 13].forEach((i) => { j[i] = true; });
ellenoriz(B.legjobbMezo(kartya, j, 'szin', 2) === 12, 'automatikus választás: a majdnem kész sort egészíti ki');
j = ures.slice();
ellenoriz(kartya[B.legjobbMezo(kartya, j, 'szin', 4)] === 4, 'automatikus választás a kidobott színből dönt');

console.log('Kerék');
const talalt = new Set();
for (let i = 0; i < 400; i++) talalt.add(B.szinSorsol({ joker: false }));
ellenoriz(talalt.size === 5 && !talalt.has(B.JOKER), 'joker nélkül mind az 5 szín kijön, a fehér soha');
for (let i = 0; i < 400; i++) talalt.add(B.szinSorsol({ joker: true }));
ellenoriz(talalt.has(B.JOKER), 'jokerrel a fehér is kijöhet');

console.log('Tippek – normál elfogadás, előadó + cím');
const b = B.tisztitBeallitas({ tippelheto: ['eloado', 'cim'] });
const dal = (artist, title, titleOriginal) => ({ artist, title, titleOriginal: titleOriginal || title });
const eset = (leiras, d, tipp, vart, beallitas = b) => {
  const e = B.tippErtekel(tipp, d, beallitas);
  ellenoriz(e.jo === vart, `${leiras} → ${vart ? 'elfogadva' : 'elutasítva'} (előadó ${e.eloadoJo ? '✓' : '✗'}, cím ${e.cimJo ? '✓' : '✗'})`);
};
const queen = dal('Queen', 'Bohemian Rhapsody');
eset('pontos tipp', queen, { eloado: 'Queen', cim: 'Bohemian Rhapsody' }, true);
eset('kisbetű, ékezet, írásjel mindegy', queen, { eloado: 'queen', cim: 'bohemian rhapsody!' }, true);
eset('egy elírás', queen, { eloado: 'Queen', cim: 'Bohemian Rapsody' }, true);
eset('két elírás egy rövid címben', dal('ABBA', 'Waterloo'), { eloado: 'Abba', cim: 'Waterlou' }, true);
eset('hiányzó cím', queen, { eloado: 'Queen', cim: '' }, false);
eset('más dal', queen, { eloado: 'Queen', cim: 'We Will Rock You' }, false);
eset('rossz előadó', queen, { eloado: 'Beatles', cim: 'Bohemian Rhapsody' }, false);
eset('ékezetek nélkül magyarul', dal('Peller Károly', 'Jaj, cica...'), { eloado: 'Peller Karoly', cim: 'jaj cica' }, true);
eset('„feat.” nélkül a fő előadó', dal('Peller Károly feat. Szendy Szilvy', 'Te, rongyos élet...'), { eloado: 'Peller Károly', cim: 'Te rongyos élet' }, true);
eset('duóból az egyik tag teljes neve', dal('Les Paul & Mary Ford', 'Vaya Con Dios'), { eloado: 'Mary Ford', cim: 'Vaya con Dios' }, true);
eset('együttesnévből egy szó nem elég', dal('Mumford & Sons', 'Little Lion Man'), { eloado: 'Sons', cim: 'Little Lion Man' }, false);
eset('„&” helyett „és”', dal('Simon & Garfunkel', 'The Boxer'), { eloado: 'Simon és Garfunkel', cim: 'Boxer' }, true);
eset('zárójeles toldás elhagyható', dal('Toto', 'Africa (Remastered)'), { eloado: 'Toto', cim: 'Africa' }, true);
eset('kötőjeles toldás elhagyható', dal('Toto', 'Hold the Line - 2008 Remaster'), { eloado: 'toto', cim: 'hold the line' }, true);
eset('névelő elhagyható', dal('The Beatles', 'Yesterday'), { eloado: 'Beatles', cim: 'Yesterday' }, true);

console.log('Tippek – elfogadási szintek');
const pontos = B.tisztitBeallitas({ elfogadas: 'pontos', tippelheto: ['eloado', 'cim'] });
const laza = B.tisztitBeallitas({ elfogadas: 'laza', tippelheto: ['eloado', 'cim'] });
eset('pontos módban az elírás nem jó', queen, { eloado: 'Queen', cim: 'Bohemian Rapsody' }, false, pontos);
eset('pontos módban az ékezet és a kisbetű mindegy', dal('Zorán', 'Kell ott fenn egy ország'), { eloado: 'zoran', cim: 'kell ott fenn egy orszag' }, true, pontos);
eset('pontos módban a duó egyik tagja nem elég', dal('Les Paul & Mary Ford', 'Vaya Con Dios'), { eloado: 'Mary Ford', cim: 'Vaya Con Dios' }, false, pontos);
eset('normál módban a sok elírás nem jó', queen, { eloado: 'Queen', cim: 'Bohem Rapszodi' }, false);
eset('laza módban a sok elírás is jó', queen, { eloado: 'Queen', cim: 'Bohemian Rapszodi' }, true, laza);
eset('laza módban sem jó a teljesen más', queen, { eloado: 'Queen', cim: 'Radio Ga Ga' }, false, laza);

console.log('Tippek – mit kell eltalálni');
eset('„bármelyik”: csak az előadó elég', queen, { eloado: 'Queen', cim: 'valami' }, true, B.tisztitBeallitas({ mitKell: 'barmelyik' }));
eset('„bármelyik”: egyik sem jó', queen, { eloado: 'ABBA', cim: 'valami' }, false, B.tisztitBeallitas({ mitKell: 'barmelyik' }));
eset('„csak cím”: az előadó nem számít', queen, { eloado: '', cim: 'Bohemian Rhapsody' }, true, B.tisztitBeallitas({ mitKell: 'cim' }));
eset('„csak előadó”: a cím nem számít', queen, { eloado: 'Queen', cim: '' }, true, B.tisztitBeallitas({ mitKell: 'eloado' }));

console.log('Az adatbázis minden dala eltalálható a saját adataival');
let rossz = 0;
for (const s of songs) {
  if (!B.tippErtekel({ eloado: s.artist, cim: s.title }, s, pontos).jo) {
    rossz++;
    if (rossz <= 5) console.log('       nem fogadja el: ' + s.artist + ' – ' + s.title);
  }
}
ellenoriz(rossz === 0, `${songs.length} dal, ebből ${rossz} nem fogadná el a saját előadóját és címét`);
const uresAlak = songs.filter((s) => !B.cimAlakok(s.title, s.titleOriginal).length || !B.eloadoAlakok(s.artist, 'normal').length);
ellenoriz(uresAlak.length === 0, `nincs olyan dal, amelynek a címe vagy előadója üresre normalizálódna (${uresAlak.length})`);

console.log('Dalválasztás');
const b80 = B.tisztitBeallitas({ evTol: 1980, evIg: 1989 });
const valasztott = Array.from({ length: 100 }, () => B.dalValaszt(songs, b80, []));
ellenoriz(valasztott.every((s) => s && s.year >= 1980 && s.year <= 1989), 'csak a beállított korszakból választ');
const mind = new Set(songs.map((s) => s.id));
ellenoriz(B.dalValaszt(songs, b, mind) === null, 'ha minden dal elfogyott, null');

console.log('Beállítások');
const t = B.tisztitBeallitas({ mod: 'semmi', valaszIdoMp: 999, elfogadas: 'x', evTol: 2000, evIg: 1990, lecsapas: false });
ellenoriz(t.mod === 'online' && t.valaszIdoMp === 120 && t.elfogadas === 'normal', 'érvénytelen értékek helyett alapérték / korlát');
ellenoriz(t.evTol === 1990 && t.evIg === 2000, 'felcserélt évtartomány megfordul');
ellenoriz(t.lecsapas === false && B.tisztitBeallitas({}).lecsapas === true, 'a lecsapás kikapcsolható, alapból be van kapcsolva');
const regi = B.tisztitBeallitas({ mitKell: 'mindketto' });
ellenoriz(JSON.stringify(regi.tippelheto) === '["eloado","cim"]' && regi.mitKell === 'mindegyik', 'a régi „előadó + cím” szoba évszám nélkül, mindkettőt kérve értelmeződik');
ellenoriz(JSON.stringify(B.tisztitBeallitas({}).tippelheto) === '["eloado","cim","ev"]', 'alapból az évszám is tippelhető');
ellenoriz(B.tisztitBeallitas({ tippelheto: ['cim', 'ev'], mitKell: 'ketto' }).mitKell === 'mindegyik', 'két mezőnél a „legalább kettő” = mindegyik');
ellenoriz(JSON.stringify(B.tisztitBeallitas({ tippelheto: [] }).tippelheto) === '["eloado","cim","ev"]', 'üres választásnál mindhárom marad');

console.log('Évszám');
const b3 = B.tisztitBeallitas({ evTures: 1 });
const q = { artist: 'Queen', title: 'Bohemian Rhapsody', titleOriginal: 'Bohemian Rhapsody', year: 1975 };
const e3 = (tipp, be = b3) => B.tippErtekel(tipp, q, be);
ellenoriz(e3({ eloado: 'Queen', cim: 'Bohemian Rhapsody', ev: '1975' }).jo, 'mindhárom jó → elfogadva');
ellenoriz(e3({ eloado: 'Queen', cim: 'Bohemian Rhapsody', ev: 1976 }).jo, '±1 év tűréssel egy év eltérés még jó');
ellenoriz(!e3({ eloado: 'Queen', cim: 'Bohemian Rhapsody', ev: 1977 }).jo, 'két év eltérés már nem jó (±1-nél)');
ellenoriz(!e3({ eloado: 'Queen', cim: 'Bohemian Rhapsody', ev: '' }).jo, 'évszám nélkül „mindegyik” módban nem jó');
ellenoriz(!e3({ eloado: 'Queen', cim: 'Bohemian Rhapsody', ev: 1976 }, B.tisztitBeallitas({ evTures: 0 })).jo, '0 tűrésnél csak a pontos év jó');
ellenoriz(e3({ eloado: 'x', cim: 'Bohemian Rhapsody', ev: '75' }).evJo === false, 'kétjegyű évszám nem számít évnek');
const ketto = B.tisztitBeallitas({ mitKell: 'ketto' });
ellenoriz(e3({ eloado: 'Queen', cim: 'rossz', ev: 1975 }, ketto).jo, '„legalább kettő”: előadó + év elég');
ellenoriz(!e3({ eloado: 'Queen', cim: 'rossz', ev: 1990 }, ketto).jo, '„legalább kettő”: egy találat kevés');
ellenoriz(e3({ eloado: '', cim: '', ev: 1975 }, B.tisztitBeallitas({ tippelheto: ['ev'] })).jo, 'csak évszám: elég az év');
ellenoriz(e3({ eloado: 'rossz', cim: 'rossz', ev: 1975 }, B.tisztitBeallitas({ mitKell: 'barmelyik' })).jo, '„bármelyik”: az év egymagában is elég');

console.log('Nyerési módok');
const j0 = Array(25).fill(0);
const kitolt = (mezok) => { const j = j0.slice(); mezok.forEach((i) => { j[i] = 1; }); return j; };
ellenoriz(B.nyertE(kitolt([0, 1, 2, 3, 4]), 'vonal') && !B.nyertE(kitolt([0, 1, 2, 3, 4]), 'ketVonal'), 'egy sor: egy vonalnál nyer, kettőnél még nem');
ellenoriz(B.nyertE(kitolt([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]), 'ketVonal'), 'két sor: két vonalnál nyer');
ellenoriz(B.nyertE(kitolt([0, 4, 20, 24]), 'sarkok') && !B.nyertE(kitolt([0, 4, 20]), 'sarkok'), 'négy sarok: mind a négy kell');
ellenoriz(B.nyertE(Array(25).fill(1), 'teli') && !B.nyertE(kitolt([...Array(24).keys()]), 'teli'), 'teli kártya: mind a 25 kell');
ellenoriz(B.haladas(kitolt([0, 1, 2, 6]), 'vonal') === 3 && B.haladas(kitolt([0, 4]), 'sarkok') === 2, 'haladás: a legjobb vonal / a sarkok száma');
ellenoriz(B.legjobbMezo(kartya, j0, 'joker', 0, 'sarkok') === 0, 'sarkok módban a gép sarkot ikszel, ha lehet');

console.log('Nyelv');
const huDalok = Array.from({ length: 50 }, () => B.dalValaszt(songs, B.tisztitBeallitas({ nyelv: 'hu' }), []));
const kulfDalok = Array.from({ length: 50 }, () => B.dalValaszt(songs, B.tisztitBeallitas({ nyelv: 'kulfoldi' }), []));
ellenoriz(huDalok.every((s) => s.nyelv === 'hu') && kulfDalok.every((s) => s.nyelv !== 'hu'), 'a nyelvszűrés csak magyar / csak külföldi dalt ad');

console.log(hibak ? `\n${hibak} HIBA` : '\nMinden rendben.');
process.exit(hibak ? 1 : 0);
