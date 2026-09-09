// Celzott teszt a pontozasra: "ha tobben jot mondanak, a gyorsasag szamit".
// Itt kozvetlenul a jatekmotort hasznaljuk (nem HTTP-n at), igy ismerjuk a helyes
// valasz indexet, es szandekosan JO valaszt tudunk adni kulonbozo idozitessel.

const kahoot = require('../kahoot-server.js');

let hibak = [];
function ellenoriz(felt, uzenet) {
  if (felt) console.log('  OK   ' + uzenet);
  else { console.log('  HIBA ' + uzenet); hibak.push(uzenet); }
}

function var_(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function main() {
  console.log('Pontozas-teszt\n');

  const { szoba, jatekosId: host } = kahoot.szobaLetrehoz('Host', {
    korokSzama: 5, valaszIdoMp: 10, tipusok: ['year'], alappont: 1000,
  });
  const gabi = kahoot.szobaCsatlakozas(szoba.kod, 'Gabi').jatekosId;
  const laci = kahoot.szobaCsatlakozas(szoba.kod, 'Laci').jatekosId;
  const zoli = kahoot.szobaCsatlakozas(szoba.kod, 'Zoli').jatekosId;

  kahoot.jatekIndit(szoba);
  const helyes = szoba.aktualisKerdes.correctIndex;
  const rossz = (helyes + 1) % 4;
  console.log('  (helyes valasz indexe: ' + helyes + ')');

  // Gabi azonnal jol valaszol
  kahoot.valaszAd(szoba, gabi, helyes);
  await var_(700);
  // Laci kesobb, de szinten jol
  kahoot.valaszAd(szoba, laci, helyes);
  await var_(200);
  // Zoli rosszul
  kahoot.valaszAd(szoba, zoli, rossz);

  kahoot.korKiertekel(szoba);

  const er = szoba.korEredmeny;
  const g = er.find((r) => r.nev === 'Gabi');
  const l = er.find((r) => r.nev === 'Laci');
  const z = er.find((r) => r.nev === 'Zoli');

  console.log(`  Gabi: ${g.szerzett} pont (${g.idoMs} ms), Laci: ${l.szerzett} pont (${l.idoMs} ms), Zoli: ${z.szerzett} pont`);

  ellenoriz(g.jo && l.jo, 'mindketten jol valaszoltak');
  ellenoriz(!z.jo && z.szerzett === 0, 'a rossz valaszert 0 pont jar');
  ellenoriz(g.szerzett > l.szerzett, `a gyorsabb tobb pontot kapott (${g.szerzett} > ${l.szerzett})`);
  ellenoriz(g.szerzett <= 1000, 'a pont nem lepi tul az alappontot');
  ellenoriz(l.szerzett >= 500, 'meg a lassabb jo valasz is legalabb a felet eri');
  ellenoriz(er[0].nev === 'Gabi', 'a kor eredmenyeben a gyorsabb van elol');

  // Osszpont halmozodik-e?
  const gabiOssz1 = szoba.jatekosok.get(gabi).pont;
  kahoot.kovetkezoKor(szoba);
  const helyes2 = szoba.aktualisKerdes.correctIndex;
  kahoot.valaszAd(szoba, gabi, helyes2);
  kahoot.korKiertekel(szoba);
  ellenoriz(szoba.jatekosok.get(gabi).pont > gabiOssz1, 'a pontok korokon at halmozodnak');

  // Idotullepes: aki nem valaszol, ne kapjon pontot
  kahoot.kovetkezoKor(szoba);
  kahoot.korKiertekel(szoba);
  const senkiSem = szoba.korEredmeny.every((r) => r.szerzett === 0);
  ellenoriz(senkiSem, 'ha senki nem valaszol, senki nem kap pontot');

  console.log('\n================================');
  if (hibak.length === 0) console.log('MINDEN TESZT ATMENT.');
  else { console.log('HIBAK:'); hibak.forEach((h) => console.log(' - ' + h)); process.exitCode = 1; }

  process.exit(process.exitCode || 0);
}

main();
