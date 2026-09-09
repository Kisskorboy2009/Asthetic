// Vegponttol vegpontig teszt: elindul egy igazi szerver, es 3 szimulalt jatekos
// vegigjatszik egy rovid meccset. Ezzel derul ki, hogy a szoba, a valos ideju
// csatorna, a pontozas es a szobavezetoi jogok tenyleg mukodnek-e.

const { spawn } = require('child_process');
const path = require('path');
const http = require('http');

const PORT = 4199;
const BASE = `http://127.0.0.1:${PORT}`;
const GYOKER = path.join(__dirname, '..');

let hibak = [];
function ellenoriz(felt, uzenet) {
  if (felt) console.log('  OK   ' + uzenet);
  else { console.log('  HIBA ' + uzenet); hibak.push(uzenet); }
}

function keres(ut, modszer = 'GET', torzs = null) {
  return new Promise((resolve, reject) => {
    const adat = torzs ? JSON.stringify(torzs) : null;
    const req = http.request(
      BASE + ut,
      { method: modszer, headers: adat ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(adat) } : {} },
      (res) => {
        let s = '';
        res.on('data', (c) => (s += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, adat: JSON.parse(s) }); }
          catch { resolve({ status: res.statusCode, adat: s }); }
        });
      }
    );
    req.on('error', reject);
    if (adat) req.write(adat);
    req.end();
  });
}

/** SSE-figyelo: mindig az utolso allapotot tartja. */
function figyel(kod, jatekosId) {
  const allapot = { utolso: null, esemenyek: 0, req: null };
  const req = http.get(`${BASE}/api/stream?kod=${kod}&jatekos=${jatekosId}`, (res) => {
    let puffer = '';
    res.on('data', (c) => {
      puffer += c;
      let i;
      while ((i = puffer.indexOf('\n\n')) !== -1) {
        const blokk = puffer.slice(0, i);
        puffer = puffer.slice(i + 2);
        const sor = blokk.split('\n').find((l) => l.startsWith('data: '));
        if (sor) {
          try { allapot.utolso = JSON.parse(sor.slice(6)); allapot.esemenyek++; } catch {}
        }
      }
    });
  });
  allapot.req = req;
  return allapot;
}

const var_ = (ms) => new Promise((r) => setTimeout(r, ms));

async function varAllapotra(figyelo, allapotNev, maxMs = 4000) {
  const hatarido = Date.now() + maxMs;
  while (Date.now() < hatarido) {
    if (figyelo.utolso && figyelo.utolso.allapot === allapotNev) return figyelo.utolso;
    await var_(50);
  }
  return null;
}

async function main() {
  console.log('Szerver inditasa a ' + PORT + ' porton...');
  const szerver = spawn(process.execPath, [path.join(GYOKER, 'server.js'), String(PORT)], {
    cwd: GYOKER, stdio: ['ignore', 'pipe', 'pipe'],
  });
  szerver.stdout.on('data', () => {});
  szerver.stderr.on('data', (d) => console.log('  [szerver hiba] ' + d));

  await var_(1200);

  try {
    // ---------- 1) szoba letrehozasa ----------
    console.log('\n1) Szoba letrehozasa');
    const letre = await keres('/api/szoba/letrehoz', 'POST', {
      nev: 'Host Bea',
      beallitas: { korokSzama: 3, valaszIdoMp: 2, tipusok: ['year'], publikus: true, alappont: 1000 },
    });
    ellenoriz(letre.status === 200 && letre.adat.kod && letre.adat.kod.length === 4, 'szoba letrejott, kod: ' + letre.adat.kod);
    const kod = letre.adat.kod;
    const host = letre.adat.jatekosId;

    // ---------- 2) csatlakozas ----------
    console.log('\n2) Ket jatekos csatlakozik');
    const j1 = await keres('/api/szoba/csatlakoz', 'POST', { kod, nev: 'Gyors Gabi' });
    const j2 = await keres('/api/szoba/csatlakoz', 'POST', { kod, nev: 'Lassu Laci' });
    ellenoriz(j1.status === 200 && j2.status === 200, 'mindketten csatlakoztak');

    const rossz = await keres('/api/szoba/csatlakoz', 'POST', { kod: 'ZZZZ', nev: 'Senki' });
    ellenoriz(rossz.status === 400, 'nem letezo szobahoz nem lehet csatlakozni');

    // ---------- 3) publikus lista ----------
    const lista = await keres('/api/szobak');
    ellenoriz(lista.adat.szobak.some((sz) => sz.kod === kod), 'a publikus szoba megjelenik a listaban');

    // ---------- 4) SSE csatlakozas ----------
    console.log('\n3) Valos ideju csatorna');
    const fHost = figyel(kod, host);
    const fJ1 = figyel(kod, j1.adat.jatekosId);
    const fJ2 = figyel(kod, j2.adat.jatekosId);
    await var_(500);
    ellenoriz(fHost.utolso && fHost.utolso.jatekosok.length === 3, 'a host 3 jatekost lat');
    ellenoriz(fHost.utolso.host === true, 'a host host-kent van jelolve');
    ellenoriz(fJ1.utolso.host === false, 'a jatekos NEM host');

    // ---------- 5) jogosultsag ----------
    console.log('\n4) Jogosultsagok');
    const tiltott = await keres('/api/indit', 'POST', { kod, jatekosId: j1.adat.jatekosId });
    ellenoriz(tiltott.status === 403, 'sima jatekos nem inditthatja el a jatekot');

    // ---------- 6) jatek indul ----------
    console.log('\n5) Jatek inditasa es elso kor');
    await keres('/api/indit', 'POST', { kod, jatekosId: host });
    const kerdesAllapot = await varAllapotra(fJ1, 'kerdes');
    ellenoriz(!!kerdesAllapot, 'elindult a kerdes fazis');
    ellenoriz(kerdesAllapot.kerdes.valaszok.length === 4, '4 valaszlehetoseg erkezett');
    ellenoriz(kerdesAllapot.kerdes.videoId === null, 'a jatekos NEM kapja meg a videoId-t');
    ellenoriz(fHost.utolso.kerdes.videoId !== null, 'a host viszont megkapja a videoId-t (nala szol a zene)');
    ellenoriz(kerdesAllapot.kerdes.helyesIndex === undefined, 'a helyes valasz NEM szivarog ki a kerdes alatt');

    // ---------- 7) valaszadas + gyorsasag ----------
    console.log('\n6) Valaszadas es pontozas');
    const helyes = fHost.utolso.kerdes ? null : null; // a hostnak sem kuldjuk ki - a szerver tudja
    // Mindketten a 0. valaszt adjak, de Gabi hamarabb.
    await keres('/api/valasz', 'POST', { kod, jatekosId: j1.adat.jatekosId, valasz: 0 });
    await var_(600);
    await keres('/api/valasz', 'POST', { kod, jatekosId: j2.adat.jatekosId, valasz: 0 });

    const ketto = await keres('/api/valasz', 'POST', { kod, jatekosId: j1.adat.jatekosId, valasz: 1 });
    ellenoriz(ketto.status === 400, 'ketszer nem lehet valaszolni');

    // hagyjuk lejarni az idot
    const eredmenyAllapot = await varAllapotra(fJ1, 'eredmeny', 5000);
    ellenoriz(!!eredmenyAllapot, 'a kor kiertekelodott');
    ellenoriz(eredmenyAllapot.eredmeny.helyesIndex >= 0, 'most mar lathato a helyes valasz');

    const gabi = eredmenyAllapot.eredmeny.korEredmeny.find((r) => r.nev === 'Gyors Gabi');
    const laci = eredmenyAllapot.eredmeny.korEredmeny.find((r) => r.nev === 'Lassu Laci');
    ellenoriz(gabi && laci, 'mindket jatekos szerepel a kor eredmenyeben');

    if (gabi.jo && laci.jo) {
      ellenoriz(gabi.szerzett > laci.szerzett, `azonos jo valasz eseten a gyorsabb tobb pontot kap (${gabi.szerzett} > ${laci.szerzett})`);
    } else if (!gabi.jo && !laci.jo) {
      ellenoriz(gabi.szerzett === 0 && laci.szerzett === 0, 'rossz valaszert 0 pont jar');
    } else {
      ellenoriz(true, 'vegyes eredmeny (egyikuk eltalalta) - a pontozas lefutott');
    }

    const hostSor = eredmenyAllapot.eredmeny.korEredmeny.find((r) => r.nev === 'Host Bea');
    ellenoriz(hostSor && !hostSor.valaszolt && hostSor.szerzett === 0, 'aki nem valaszolt, 0 pontot kap');

    // ---------- 8) dal kihagyasa ----------
    console.log('\n7) Dal kihagyasa (szobavezetoi jog)');
    await keres('/api/kovetkezo', 'POST', { kod, jatekosId: host });
    await varAllapotra(fHost, 'kerdes');
    const kihagyottVideo = fHost.utolso.kerdes.videoId;
    const korElotte = fHost.utolso.kor;

    const kihagyTiltott = await keres('/api/kihagy', 'POST', { kod, jatekosId: j1.adat.jatekosId });
    ellenoriz(kihagyTiltott.status === 403, 'sima jatekos nem hagyhat ki dalt');

    await keres('/api/kihagy', 'POST', { kod, jatekosId: host });
    await var_(400);
    ellenoriz(fHost.utolso.kerdes && fHost.utolso.kerdes.videoId !== kihagyottVideo, 'kihagyas utan mas dal jott');
    ellenoriz(fHost.utolso.kor === korElotte, 'a kihagyott dal nem szamit bele a korokbe');

    // ---------- 9) jatek vege ----------
    console.log('\n8) Jatek vege');
    for (let i = 0; i < 6; i++) {
      await keres('/api/kiertekel', 'POST', { kod, jatekosId: host });
      await var_(150);
      await keres('/api/kovetkezo', 'POST', { kod, jatekosId: host });
      await var_(150);
      if (fHost.utolso.allapot === 'vege') break;
    }
    const vege = await varAllapotra(fHost, 'vege', 3000);
    ellenoriz(!!vege, 'a jatek eljutott a vegeig');
    if (vege) {
      ellenoriz(Array.isArray(vege.vegeredmeny) && vege.vegeredmeny.length === 3, 'a vegeredmeny mind a 3 jatekost tartalmazza');
      const pontok = vege.vegeredmeny.map((v) => v.pont);
      ellenoriz(pontok.every((p, i) => i === 0 || pontok[i - 1] >= p), 'a toplista csokkeno pontszam szerint rendezett');
    }

    fHost.req.destroy(); fJ1.req.destroy(); fJ2.req.destroy();
  } catch (e) {
    hibak.push('Kivetel: ' + e.message);
    console.log('  KIVETEL: ' + e.stack);
  } finally {
    szerver.kill();
  }

  console.log('\n================================');
  if (hibak.length === 0) {
    console.log('MINDEN TESZT ATMENT.');
  } else {
    console.log('HIBAK (' + hibak.length + '):');
    hibak.forEach((h) => console.log(' - ' + h));
    process.exitCode = 1;
  }
}

main();
