// Asthetic - az evtartomany-beallitas tesztje
//
// Azt ellenorzi, hogy a szoba "melyik korszakbol jojjenek a dalok" beallitasa
// tenyleg szur - es hogy az evszam-kerdes elteritoi is a tartomanyon belul
// maradnak, ha a tartomany eleg szeles.
//
// Futtatas: node adatbazis/test_evtartomany.js

'use strict';

const motor = require('../js/jatekmotor.js');
const songs = require('./songs.json');

let hiba = 0;
function ok(allitas, szoveg) {
  console.log((allitas ? '  OK   ' : '  HIBA ') + szoveg);
  if (!allitas) hiba++;
}

function fejlec(szoveg) { console.log('\n' + szoveg); }

// ─────────────────────────────────────────────────────────────

fejlec('1) A beallitas tisztitasa');
{
  const b = motor.tisztitBeallitas({ evTol: 1980, evIg: 1989 });
  ok(b.evTol === 1980 && b.evIg === 1989, 'a megadott tartomany megmarad');

  const forditva = motor.tisztitBeallitas({ evTol: 2000, evIg: 1970 });
  ok(forditva.evTol === 1970 && forditva.evIg === 2000, 'a felcserelt vegeket megforditja');

  const tulcsordulo = motor.tisztitBeallitas({ evTol: 1200, evIg: 9999 });
  ok(tulcsordulo.evTol === motor.EV_MIN && tulcsordulo.evIg === motor.EV_MAX,
    'az ertelmetlen ertekeket a hatarokra huzza');

  const alap = motor.tisztitBeallitas({});
  ok(alap.evTol === motor.EV_MIN && alap.evIg === motor.EV_MAX,
    'tartomany nelkul a teljes skala marad (a regi szobak valtozatlanok)');
}

fejlec('2) Csak a tartomanyba eso dalok jonnek');
{
  const beallitas = motor.tisztitBeallitas({ evTol: 1980, evIg: 1989, tipusok: ['year', 'artist', 'title'] });
  let kivul = 0;
  let db = 0;

  for (let kor = 1; kor <= 300; kor++) {
    const v = motor.kovetkezoKerdes(songs, beallitas, 'TEST', kor, []);
    if (!v) break;
    db++;
    if (v.dal.year < 1980 || v.dal.year > 1989) kivul++;
  }

  ok(db === 300, `mind a 300 korre jutott dal (${db})`);
  ok(kivul === 0, `egyetlen dal sem esett a tartomanyon kivul (${kivul} kivules)`);
}

fejlec('3) Ellenproba: tartomany nelkul JON tartomanyon kivuli dal is');
{
  // Ha ez a teszt is "0 kivules"-t adna, a 2) pont semmit nem bizonyitana:
  // lehet, hogy az adatbazisban csak 80-as evekbeli dalok vannak.
  const beallitas = motor.tisztitBeallitas({});
  let kivul = 0;
  for (let kor = 1; kor <= 300; kor++) {
    const v = motor.kovetkezoKerdes(songs, beallitas, 'TEST2', kor, []);
    if (!v) break;
    if (v.dal.year < 1980 || v.dal.year > 1989) kivul++;
  }
  ok(kivul > 0, `szuretlenul ${kivul} dal esett a 80-as eveken kivulre`);
}

fejlec('4) Szeles tartomanynal az evszam-valaszok is belul maradnak');
{
  const beallitas = motor.tisztitBeallitas({ evTol: 1970, evIg: 2010, tipusok: ['year'] });
  let kivul = 0;
  let db = 0;

  for (let kor = 1; kor <= 200; kor++) {
    const v = motor.kovetkezoKerdes(songs, beallitas, 'TEST3', kor, []);
    if (!v) break;
    db++;
    for (const ev of v.kerdes.options) {
      if (Number(ev) < 1970 || Number(ev) > 2010) kivul++;
    }
  }

  ok(db > 0, `${db} evszam-kerdes keszult`);
  ok(kivul === 0, `egyetlen felkinalt evszam sem esett a tartomanyon kivul (${kivul})`);
}

fejlec('5) Szuk tartomany: nem all le, es tovabbra is 4 ervenyes valasz jon');
{
  // 1985-1990 szukebb, mint negy evszam 5-10 eves lepesekkel - ilyenkor a
  // teljes skalarol jonnek az evszamok, de kerdes attol meg kell hogy legyen.
  const beallitas = motor.tisztitBeallitas({ evTol: 1985, evIg: 1990, tipusok: ['year', 'artist', 'title'] });
  let db = 0;
  let rossz = 0;

  for (let kor = 1; kor <= 50; kor++) {
    const v = motor.kovetkezoKerdes(songs, beallitas, 'TEST4', kor, []);
    if (!v) break;
    db++;
    const o = v.kerdes.options;
    if (o.length !== 4 || new Set(o).size !== 4) rossz++;
    if (o[v.kerdes.correctIndex] !== v.kerdes.correctAnswer) rossz++;
    if (v.dal.year < 1985 || v.dal.year > 1990) rossz++;
  }

  ok(db === 50, `szuk tartomanybol is jutott 50 kor (${db})`);
  ok(rossz === 0, `minden kerdesnek 4 kulonbozo valasza es jo helyes indexe van (${rossz} hiba)`);
}

fejlec('6) Ures tartomany: nincs kerdes, nem omlik ossze');
{
  // 1901-1902 kozott biztosan nincs dal (az adatbazis 1913-tol indul).
  const beallitas = motor.tisztitBeallitas({ evTol: 1901, evIg: 1902 });
  const v = motor.kovetkezoKerdes(songs, beallitas, 'TEST5', 1, []);
  ok(v === null, 'ures tartomanybol null jon (a jatek szepen veget er)');
}

fejlec('7) A kizart dalok a tartomanyon belul is kizartak maradnak');
{
  const beallitas = motor.tisztitBeallitas({ evTol: 1980, evIg: 1989 });
  const kizart = new Set();
  let ismetles = 0;

  for (let kor = 1; kor <= 100; kor++) {
    const v = motor.kovetkezoKerdes(songs, beallitas, 'TEST6', kor, kizart);
    if (!v) break;
    if (kizart.has(v.dal.id)) ismetles++;
    kizart.add(v.dal.id);
  }
  ok(ismetles === 0, `egyetlen dal sem jott vissza masodszor (${ismetles})`);
}

// ─────────────────────────────────────────────────────────────

console.log('\n================================');
if (hiba === 0) console.log('MINDEN TESZT ATMENT.');
else { console.log(hiba + ' TESZT ELBUKOTT.'); process.exit(1); }
