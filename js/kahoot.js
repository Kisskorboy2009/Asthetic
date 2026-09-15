/* ═══════════════════════════════════════════════════════════════
   ASTHETIC — Kvízcsata (Kahoot-mód) kliensoldal
   A szerver küldi az állapotot (SSE), mi csak megjelenítjük és
   visszaküldjük a műveleteket.
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const $ = (id) => document.getElementById(id);

// ───────────────────────── munkamenet ─────────────────────────

const TAROLO = 'asthetic-kviz';

function munkamenetBetolt() {
  try { return JSON.parse(sessionStorage.getItem(TAROLO) || 'null'); } catch { return null; }
}
function munkamenetMent(adat) {
  try { sessionStorage.setItem(TAROLO, JSON.stringify(adat)); } catch { /* privát mód */ }
}
function munkamenetTorol() {
  try { sessionStorage.removeItem(TAROLO); } catch { /* privát mód */ }
}

let munkamenet = munkamenetBetolt();  // { kod, jatekosId, nev }
let allapot = null;                    // a szervertől kapott legutóbbi állapot
let forras = null;                     // EventSource

// ───────────────────────── kommunikáció ─────────────────────────

// Böngészőben üres (relatív hívások), az Android alkalmazásban a beállított
// kiszolgáló teljes címe — lásd js/config.js.
function apiBazis() {
  return (window.ASTHETIC && window.ASTHETIC.szerver) || '';
}

/* A Kvízcsata két úton működhet, ugyanazzal a felülettel:
     'szerver'   — saját gépen/hálózaton futó server.js (SSE + /api)
     'firestore' — kiszolgáló nélkül, a Firebase ingyenes csomagján
   Indításkor megnézzük, elérhető-e a saját kiszolgáló; ha nem, Firestore-ra
   váltunk. A megjelenítő kód nem tud a különbségről: mindkét út ugyanolyan
   alakú állapotot ad. */
let mod = null;

async function modMeghataroz() {
  if (mod) return mod;

  // Az alkalmazásban a beépített kiszolgáló MINDEN pont nélküli útvonalat az
  // index.html-re irányít, 200-as státusszal — a /api/szobak próba tehát ott
  // hamis „van saját kiszolgáló” eredményt adna. Ezért ha natívan futunk és
  // nincs kézzel megadott cím, meg sem próbálkozunk: egyből Firestore.
  const sajatCim = apiBazis();
  const probalkozzunk = sajatCim || !(window.ASTHETIC && window.ASTHETIC.natív);

  if (probalkozzunk) {
    try {
      const valasz = await fetch(sajatCim + '/api/szobak', { cache: 'no-store' });
      // Nem elég a 200-as státusz: azt is ellenőrizzük, hogy tényleg a mi
      // kiszolgálónk válaszolt-e, és nem egy HTML-oldal jött vissza.
      const adat = valasz.ok ? await valasz.json() : null;
      if (adat && Array.isArray(adat.szobak)) { mod = 'szerver'; return mod; }
    } catch { /* nincs saját kiszolgáló — jöhet a Firestore */ }
  }

  if (!window.AstheticFirestore) throw new Error('A Kvízcsata most nem érhető el.');
  await window.AstheticFirestore.init();
  mod = 'firestore';
  return mod;
}

async function hivas(ut, torzs) {
  return (await modMeghataroz()) === 'firestore'
    ? firestoreHivas(ut, torzs || {})
    : szerverHivas(ut, torzs || {});
}

async function szerverHivas(ut, torzs) {
  const valasz = await fetch(apiBazis() + '/api/' + ut, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(torzs),
  });
  const adat = await valasz.json().catch(() => ({}));
  if (!valasz.ok) throw new Error(adat.hiba || 'Ismeretlen hiba');
  return adat;
}

async function firestoreHivas(ut, torzs) {
  const FS = window.AstheticFirestore;
  const vezeto = window.AstheticVezeto;

  switch (ut) {
    case 'szoba/letrehoz': {
      const eredmeny = await FS.szobaLetrehoz(torzs.nev, torzs.beallitas);
      vezeto.indit(eredmeny.kod);        // innentől ez a böngésző vezeti a játékot
      return eredmeny;
    }
    case 'szoba/csatlakoz':
      return FS.csatlakozas(torzs.kod, torzs.nev);
    case 'indit':
      await vezeto.jatekIndit(torzs.kod); return { ok: true };
    case 'kovetkezo':
      await vezeto.kovetkezoKor(torzs.kod); return { ok: true };
    case 'kiertekel':
      await vezeto.korKiertekel(torzs.kod); return { ok: true };
    case 'kihagy':
      await vezeto.dalKidob(torzs.kod); return { ok: true };
    case 'valasz':
      await FS.valaszAd(torzs.kod, torzs.jatekosId, torzs.valasz); return { ok: true };
    case 'kilep':
      vezeto.leallit();
      await FS.kilep(torzs.kod, torzs.jatekosId);
      return { ok: true };
    default:
      throw new Error('Ismeretlen művelet: ' + ut);
  }
}

function hibaKiir(elemId, uzenet) {
  const el = $(elemId);
  if (el) el.textContent = uzenet || '';
}

// ───────────────────────── nézetváltás ─────────────────────────

function nezet(nev) {
  document.querySelectorAll('.kview').forEach((v) => v.classList.remove('is-active'));
  const el = $('kv-' + nev);
  if (el) el.classList.add('is-active');
}

// ───────────────────────── YouTube (csak a szobavezetőnél) ─────────────────────────

let lejatszo = null;
let lejatszoKesz = false;
let varakozoVideo = null;

const ytSzkript = document.createElement('script');
ytSzkript.src = 'https://www.youtube.com/iframe_api';
document.head.appendChild(ytSzkript);

window.onYouTubeIframeAPIReady = () => {
  lejatszo = new YT.Player('kYtFrame', {
    host: 'https://www.youtube-nocookie.com',
    width: '200', height: '120',
    playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, fs: 0, iv_load_policy: 3 },
    events: {
      onReady: () => {
        lejatszoKesz = true;
        if (varakozoVideo) { zeneIndit(varakozoVideo.videoId, varakozoVideo.kezdes); varakozoVideo = null; }
      },
      onStateChange: (e) => {
        // 1 = PLAYING: ha megszolalt, nem kell a tartalek gomb.
        if (e.data === 1) hangGombMutat(false);
      },
    },
  });
};

let hangEllenorzo = null;

function hangGombMutat(mutasd) {
  const gomb = $('qHangGomb');
  if (gomb) gomb.hidden = !mutasd;
}

function zeneIndit(videoId, kezdesMp) {
  if (!lejatszo || !lejatszoKesz) { varakozoVideo = { videoId, kezdes: kezdesMp }; return; }
  try {
    lejatszo.loadVideoById({ videoId, startSeconds: kezdesMp || 0 });
    lejatszo.playVideo();
  } catch { /* a lejátszó még nem áll készen */ }

  // Mobilon a böngésző letilthatja a hang automatikus indítását. Ha rövid időn
  // belül nem szól, felajánljuk a koppintást — egy érintés után már engedi.
  clearTimeout(hangEllenorzo);
  hangEllenorzo = setTimeout(() => {
    let jatszik = false;
    try { jatszik = lejatszo.getPlayerState() === 1; } catch { /* nem tudjuk */ }
    hangGombMutat(!jatszik);
  }, 1600);
}

function zeneLeallit() {
  clearTimeout(hangEllenorzo);
  hangGombMutat(false);
  if (lejatszo && lejatszoKesz) { try { lejatszo.pauseVideo(); } catch { /* nem baj */ } }
}

// ───────────────────────── valós idejű kapcsolat ─────────────────────────

let firestoreLeiratkozas = null;

function kapcsolatBont() {
  if (forras) { forras.close(); forras = null; }
  if (firestoreLeiratkozas) { firestoreLeiratkozas(); firestoreLeiratkozas = null; }
}

function kapcsolatElveszett(uzenet) {
  kapcsolatBont();
  munkamenetTorol();
  munkamenet = null;
  nezet('menu');
  hibaKiir('menuHiba', uzenet);
}

async function csatlakozStream() {
  if (!munkamenet) return;
  kapcsolatBont();

  if ((await modMeghataroz()) === 'firestore') {
    const FS = window.AstheticFirestore;

    firestoreLeiratkozas = FS.figyel(
      munkamenet.kod,
      munkamenet.jatekosId,
      (uj) => {
        allapot = uj;
        // Oldalfrissítés után a szobavezetőnek újra át kell vennie a
        // játékvezetést, különben senki nem léptetné a köröket.
        if (uj.host) window.AstheticVezeto.indit(munkamenet.kod);
        kirajzol();
      },
      (hiba) => kapcsolatElveszett(
        hiba && hiba.message ? hiba.message : 'A kapcsolat megszakadt, vagy a szoba megszűnt.',
      ),
    );
    return;
  }

  forras = new EventSource(`${apiBazis()}/api/stream?kod=${encodeURIComponent(munkamenet.kod)}&jatekos=${encodeURIComponent(munkamenet.jatekosId)}`);

  forras.onmessage = (e) => {
    try { allapot = JSON.parse(e.data); } catch { return; }
    kirajzol();
  };

  forras.onerror = () => {
    // Az EventSource magától újrapróbálkozik; ha a szoba megszűnt, visszadobjuk a menübe.
    if (forras && forras.readyState === EventSource.CLOSED) {
      kapcsolatElveszett('A kapcsolat megszakadt, vagy a szoba megszűnt.');
    }
  };
}

// ───────────────────────── megjelenítés ─────────────────────────

let elozoAllapotNev = null;
let elozoKor = null;
let elozoValaszNyitva = null;

function kirajzol() {
  if (!allapot) return;

  if (allapot.allapot === 'lobby') rajzolLobby();
  else if (allapot.allapot === 'kerdes') rajzolKerdes();
  else if (allapot.allapot === 'eredmeny') rajzolEredmeny();
  else if (allapot.allapot === 'vege') rajzolVege();

  elozoAllapotNev = allapot.allapot;
  elozoKor = allapot.kor;
}

// --- váró ---
function rajzolLobby() {
  nezet('lobby');
  zeneLeallit();

  $('lobbyKod').textContent = allapot.kod;
  $('lobbyLetszam').textContent = allapot.jatekosok.length;

  $('lobbyJatekosok').innerHTML = allapot.jatekosok
    .map((j) => `<span class="kplayer ${j.host ? 'kplayer--host' : ''}">${j.host ? '<span class="kplayer__crown">★</span>' : ''}${szoveg(j.nev)}</span>`)
    .join('');

  const b = allapot.beallitas;
  const tipusNev = { year: 'évszám', artist: 'előadó', title: 'cím' };
  // Az évtartományt csak akkor írjuk ki, ha a szobavezető tényleg szűkítette.
  // (A teljes skála a beállításokban 1900–2100, az nem mond semmit.)
  const korszak = (b.evTol > 1900 || b.evIg < 2100) ? ` · ${b.evTol}–${b.evIg}` : '';
  $('lobbyBeallitas').textContent =
    `${b.korokSzama} kör · ${b.valaszIdoMp} mp válaszidő · ${b.kezdesMp}. mp-től${korszak} · ` +
    `tippelhető: ${b.tipusok.map((t) => tipusNev[t]).join(', ')}${b.publikus ? ' · nyilvános' : ''}`;

  $('inditBtn').hidden = !allapot.host;
  $('lobbyHint').textContent = allapot.host
    ? 'Ezt a kódot írják be a többiek — te indítod a játékot'
    : 'Várunk a szobavezetőre, hogy elindítsa a játékot';
}

// --- kérdés ---
/** Hányan játszanak ténylegesen — a csak levezető szobavezető nem számít. */
function jatszokSzama() {
  return (allapot.jatekosok || []).filter((j) => !j.nezo).length;
}

function rajzolKerdes() {
  nezet('kerdes');
  const k = allapot.kerdes;
  if (!k) return;

  $('qKor').textContent = `${allapot.kor}. kör / ${allapot.korokSzama}`;
  // "Csak színek" módban a kérdés szövege el sem jut hozzánk — a szobavezető
  // képernyőjén kell nézni, mi a kérdés.
  $('qSzoveg').textContent = k.csakSzinek
    ? 'Nézd a szobavezető képernyőjét, és válassz színt!'
    : k.szoveg;
  $('kihagyBtn').hidden = !allapot.host;
  // A szobavezető, aki csak levezeti a játékot, nem válaszol — nála a "kilépés"
  // helyett a szoba bezárása a természetes művelet.
  $('kilepKerdesBtn').textContent = allapot.host ? 'Szoba bezárása' : 'Kilépés';

  const hallgatas = k.valaszNyitva === false;
  const nezoVagyok = Boolean(allapot.nezo);

  $('qValaszok').hidden = hallgatas || nezoVagyok;
  $('qHallgatas').hidden = !hallgatas;
  $('qNezo').hidden = !(nezoVagyok && !hallgatas);

  // Új kör VAGY a hallgatási szakasz vége: ilyenkor kell újrarajzolni és a
  // visszaszámlálót újraindítani.
  const ujKor = elozoAllapotNev !== 'kerdes' || elozoKor !== allapot.kor;
  const valaszokMostNyiltak = elozoValaszNyitva === false && k.valaszNyitva !== false;
  elozoValaszNyitva = k.valaszNyitva !== false;

  if (ujKor || valaszokMostNyiltak) {
    const doboz = $('qValaszok');
    doboz.className = 'kvalaszok' + (k.csakSzinek ? ' kvalaszok--szinek' : '');
    // "Csak színek" módban nincs válaszszöveg, csak a négy jelölt gomb.
    const valaszok = k.valaszok || [null, null, null, null];
    doboz.innerHTML = valaszok
      .map((v, i) => `
        <button class="kvalasz kvalasz--${i}" type="button" data-index="${i}"
                aria-label="${'ABCD'[i]} válasz">
          <span class="kvalasz__jel">${'ABCD'[i]}</span>
          ${k.csakSzinek ? '' : `<span>${szoveg(v)}</span>`}
        </button>`)
      .join('');

    doboz.querySelectorAll('.kvalasz').forEach((gomb) => {
      gomb.addEventListener('click', () => valaszKuld(Number(gomb.dataset.index)));
    });

    // A videoId-t vagy csak a szobavezeto kapja meg, vagy - ha a szoba ugy van
    // beallitva - minden jatekos. Ahol megvan, ott szoljon.
    // A dal csak új körnél induljon újra — a válaszok megnyitásakor szóljon tovább.
    if (ujKor && k.videoId) zeneIndit(k.videoId, k.kezdesMp);
    document.body.classList.add('is-szol');
    visszaszamlalIndit(hallgatas ? k.hallgatasHatraMs : k.hatralevoMs, hallgatas);
  }

  // Ha már válaszoltunk, jelöljük és tiltsuk a gombokat
  if (allapot.sajatValasz !== null && allapot.sajatValasz !== undefined) {
    document.querySelectorAll('.kvalasz').forEach((g, i) => {
      g.disabled = true;
      g.classList.toggle('is-valasztott', i === allapot.sajatValasz);
    });
    $('qStatusz').textContent = `Válaszod elküldve. Eddig ${allapot.valaszoltakSzama}/${jatszokSzama()} játékos válaszolt.`;
  } else {
    $('qStatusz').textContent = `${allapot.valaszoltakSzama}/${jatszokSzama()} játékos válaszolt`;
  }
}

async function valaszKuld(index) {
  // Aki csak levezeti a jatekot, nem valaszol. Es amig csak a dal szol, meg
  // senki nem valaszolhat. (A gombok ilyenkor rejtve is vannak, de a
  // billentyuzet vagy egy ottragadt kattintas igy sem kuldhet valaszt.)
  if (!allapot || allapot.nezo) return;
  if (allapot.kerdes && allapot.kerdes.valaszNyitva === false) return;

  document.querySelectorAll('.kvalasz').forEach((g, i) => {
    g.disabled = true;
    g.classList.toggle('is-valasztott', i === index);
  });
  try {
    await hivas('valasz', { kod: munkamenet.kod, jatekosId: munkamenet.jatekosId, valasz: index });
  } catch (e) {
    $('qStatusz').textContent = e.message;
  }
}

// --- visszaszámláló ---
let visszaszamlaloId = null;
function visszaszamlalIndit(hatralevoMs, hallgatasE) {
  clearInterval(visszaszamlaloId);
  const teljes = hallgatasE
    ? Math.max(1, (allapot.beallitas.elobbZeneMp || 1) * 1000)
    : (allapot.beallitas.valaszIdoMp || 30) * 1000;
  const vege = Date.now() + hatralevoMs;

  const frissit = () => {
    const maradt = Math.max(0, vege - Date.now());
    const mp = Math.ceil(maradt / 1000);
    const idoEl = $('qIdo');
    idoEl.textContent = mp;
    idoEl.classList.toggle('is-keves', mp <= 10 && mp > 5);
    idoEl.classList.toggle('is-veszely', mp <= 5);
    $('qSav').style.width = Math.max(0, (maradt / teljes) * 100) + '%';
    if (maradt <= 0) clearInterval(visszaszamlaloId);
  };

  frissit();
  visszaszamlaloId = setInterval(frissit, 200);
}

// --- kör eredménye ---
function rajzolEredmeny() {
  nezet('eredmeny');
  clearInterval(visszaszamlaloId);
  document.body.classList.remove('is-szol');
  zeneLeallit();

  const e = allapot.eredmeny;
  if (!e) return;

  $('eDalCim').textContent = `${e.dal.eloado} — ${e.dal.cim}`;
  $('eDalMeta').textContent = `${e.dal.ev}`;
  $('eHelyes').textContent = `Helyes válasz: ${e.helyesValasz}`;

  $('eTabla').innerHTML = e.korEredmeny
    .map((r) => `
      <tr class="${r.id === allapot.jatekosId ? 'is-en' : ''}">
        <td>${szoveg(r.nev)}</td>
        <td class="${r.jo ? 'jo' : 'rossz'}">${r.valaszolt ? szoveg(e.valaszok[r.valasz]) : '<em>nem válaszolt</em>'}</td>
        <td class="szam">${r.szerzett > 0 ? '+' + r.szerzett : '0'}</td>
        <td class="szam">${r.osszpont}</td>
      </tr>`)
    .join('');

  $('kovetkezoBtn').hidden = !allapot.host;
  $('kilepEredmenyBtn').textContent = allapot.host ? 'Szoba bezárása' : 'Kilépés';
  $('kovetkezoBtn').textContent = e.utolsoKor ? 'Végeredmény' : 'Következő kör';
  $('eVarunk').textContent = allapot.host ? '' : 'Várunk a szobavezetőre…';
}

// --- vége ---
function rajzolVege() {
  nezet('vege');
  clearInterval(visszaszamlaloId);
  document.body.classList.remove('is-szol');
  zeneLeallit();

  const v = allapot.vegeredmeny || [];
  const dobogoSorrend = [1, 0, 2]; // 2. – 1. – 3. helyezés vizuális sorrendje
  $('vDobogo').innerHTML = dobogoSorrend
    .filter((i) => v[i])
    .map((i) => `
      <div class="kdobogo__oszlop">
        <div class="kdobogo__fej">
          <div class="kdobogo__nev">${szoveg(v[i].nev)}</div>
          <div class="kdobogo__pont">${v[i].pont} pont</div>
        </div>
        <div class="kdobogo__hely kdobogo__hely--${i + 1}">
          <span class="kdobogo__helyszam">${i + 1}.</span>
        </div>
      </div>`)
    .join('');

  $('vTabla').innerHTML = v
    .map((j, i) => `
      <tr class="${j.id === allapot.jatekosId ? 'is-en' : ''}">
        <td>${i + 1}.</td>
        <td>${szoveg(j.nev)}</td>
        <td class="szam">${j.pont}</td>
      </tr>`)
    .join('');
}

// XSS elleni védelem: a játékosnevek és a daladatok szövegként kerülnek be
function szoveg(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// ───────────────────────── évtartomány-csúszka ─────────────────────────

/* Két egymásra fektetett range-mező adja a két fogantyút (natív dupla csúszka
   nincs). A fogantyúk nem mehetnek át egymáson: mindkettő a másikig mozoghat. */

let dalEvek = null;        // rendezett évszámlista a songs.json-ból
let evSavKesz = false;

async function evSavElokeszit() {
  if (evSavKesz) return;

  try {
    const valasz = await fetch('adatbazis/songs.json', { cache: 'force-cache' });
    if (!valasz.ok) throw new Error('nem toltodott be');
    const dalok = await valasz.json();
    dalEvek = dalok.map((d) => d.year).filter(Number.isFinite).sort((a, b) => a - b);
    if (!dalEvek.length) throw new Error('ures');
  } catch {
    // A csúszka nélkül is lehet szobát nyitni — ilyenkor a teljes adatbázisból
    // jönnek a dalok, ahogy eddig.
    $('evSav').hidden = true;
    evSavKesz = true;
    return;
  }

  const min = dalEvek[0];
  const max = dalEvek[dalEvek.length - 1];

  for (const [azon, ertek] of [['evTolInput', min], ['evIgInput', max]]) {
    const el = $(azon);
    el.min = String(min);
    el.max = String(max);
    el.step = '1';
    el.value = String(ertek);
    el.addEventListener('input', () => evSavValtozott(azon));
  }

  evSavKesz = true;
  evSavKirajzol();
}

function evSavValtozott(azon) {
  const tolEl = $('evTolInput');
  const igEl = $('evIgInput');
  // Ne csússzanak át egymáson: mindig az épp húzott fogantyút fékezzük meg.
  if (azon === 'evTolInput') tolEl.value = String(Math.min(Number(tolEl.value), Number(igEl.value)));
  else igEl.value = String(Math.max(Number(igEl.value), Number(tolEl.value)));
  evSavKirajzol();
}

function evSavErtek() {
  if (!dalEvek) return null;
  return { tol: Number($('evTolInput').value), ig: Number($('evIgInput').value) };
}

function evSavKirajzol() {
  const ertek = evSavErtek();
  if (!ertek) return;

  const min = dalEvek[0];
  const max = dalEvek[dalEvek.length - 1];
  const szelesseg = Math.max(1, max - min);

  $('evTolCimke').textContent = ertek.tol;
  $('evIgCimke').textContent = ertek.ig;

  const bal = ((ertek.tol - min) / szelesseg) * 100;
  const jobb = ((ertek.ig - min) / szelesseg) * 100;
  $('evKitolt').style.left = bal + '%';
  $('evKitolt').style.width = Math.max(0, jobb - bal) + '%';

  const db = dalEvek.filter((ev) => ev >= ertek.tol && ev <= ertek.ig).length;
  const hint = $('evDarab');
  hint.textContent = db === dalEvek.length
    ? `A teljes adatbázis játszható — ${db} dal.`
    : `${db} dal esik ebbe a tartományba.`;
  // A körök számánál kevesebb dalból nem lehet végigjátszani a szobát.
  const korok = Number($('korokInput').value) || 0;
  hint.classList.toggle('is-keves', db < korok);
  if (db < korok) hint.textContent = `Csak ${db} dal esik ebbe a tartományba — kevesebb, mint a ${korok} kör.`;
}

// ───────────────────────── műveletek ─────────────────────────

function nevErteke() {
  return $('nevInput').value.trim();
}

$('korokInput').addEventListener('input', () => { if (evSavKesz && dalEvek) evSavKirajzol(); });

$('ujSzobaBtn').addEventListener('click', () => {
  if (!nevErteke()) { hibaKiir('menuHiba', 'Előbb írd be a neved.'); $('nevInput').focus(); return; }
  hibaKiir('menuHiba', '');
  nezet('letrehoz');
  evSavElokeszit();
});

$('csatlakozNezetBtn').addEventListener('click', () => {
  if (!nevErteke()) { hibaKiir('menuHiba', 'Előbb írd be a neved.'); $('nevInput').focus(); return; }
  hibaKiir('menuHiba', '');
  nezet('csatlakoz');
  $('kodInput').focus();
});

$('letrehozVisszaBtn').addEventListener('click', () => nezet('menu'));
$('csatlakozVisszaBtn').addEventListener('click', () => nezet('menu'));

$('letrehozBtn').addEventListener('click', async () => {
  const tipusok = [];
  if ($('tipusYear').checked) tipusok.push('year');
  if ($('tipusArtist').checked) tipusok.push('artist');
  if ($('tipusTitle').checked) tipusok.push('title');

  if (tipusok.length === 0) {
    hibaKiir('letrehozHiba', 'Legalább egy kérdéstípust válassz ki.');
    return;
  }

  const evek = evSavErtek();
  if (evek) {
    const jatszhato = dalEvek.filter((ev) => ev >= evek.tol && ev <= evek.ig).length;
    if (jatszhato === 0) {
      hibaKiir('letrehozHiba', 'Ebben az évtartományban egyetlen dal sincs — állíts szélesebbet.');
      return;
    }
  }

  try {
    hibaKiir('letrehozHiba', '');
    const adat = await hivas('szoba/letrehoz', {
      nev: nevErteke(),
      beallitas: {
        evTol: evek ? evek.tol : undefined,
        evIg: evek ? evek.ig : undefined,
        korokSzama: Number($('korokInput').value),
        valaszIdoMp: Number($('idoInput').value),
        kezdesMp: Number($('kezdesInput').value),
        alappont: Number($('pontInput').value),
        publikus: $('publikusInput').checked,
        mindenkiHallja: $('mindenkiHalljaInput').checked,
        mindenkiUtanTovabb: $('mindenkiUtanInput').checked,
        csakSzinek: $('csakSzinekInput').checked,
        vezetoJatszik: $('vezetoJatszikInput').checked,
        elobbZeneMp: Number($('elobbZeneInput').value),
        tipusok,
      },
    });
    munkamenet = { kod: adat.kod, jatekosId: adat.jatekosId, nev: nevErteke() };
    munkamenetMent(munkamenet);
    csatlakozStream();
  } catch (e) {
    hibaKiir('letrehozHiba', e.message);
  }
});

$('csatlakozBtn').addEventListener('click', csatlakozas);
$('kodInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') csatlakozas(); });

async function csatlakozas(kodParam) {
  const kod = (typeof kodParam === 'string' ? kodParam : $('kodInput').value).trim().toUpperCase();
  if (kod.length !== 4) { hibaKiir('csatlakozHiba', 'A szobakód 4 karakter hosszú.'); return; }

  try {
    hibaKiir('csatlakozHiba', '');
    const adat = await hivas('szoba/csatlakoz', { kod, nev: nevErteke() });
    munkamenet = { kod: adat.kod, jatekosId: adat.jatekosId, nev: nevErteke() };
    munkamenetMent(munkamenet);
    csatlakozStream();
  } catch (e) {
    hibaKiir('csatlakozHiba', e.message);
  }
}

$('inditBtn').addEventListener('click', async () => {
  try { await hivas('indit', { kod: munkamenet.kod, jatekosId: munkamenet.jatekosId }); }
  catch (e) { hibaKiir('lobbyHiba', e.message); }
});

$('kovetkezoBtn').addEventListener('click', async () => {
  try { await hivas('kovetkezo', { kod: munkamenet.kod, jatekosId: munkamenet.jatekosId }); }
  catch (e) { $('eVarunk').textContent = e.message; }
});

$('qHangGomb').addEventListener('click', () => {
  hangGombMutat(false);
  try { lejatszo.playVideo(); } catch { /* nincs mit tenni */ }
});

$('kihagyBtn').addEventListener('click', async () => {
  try { await hivas('kihagy', { kod: munkamenet.kod, jatekosId: munkamenet.jatekosId }); }
  catch (e) { $('qStatusz').textContent = e.message; }
});

$('kilepBtn').addEventListener('click', kilepes);
$('ujJatekBtn').addEventListener('click', kilepes);
$('kilepKerdesBtn').addEventListener('click', kilepes);
$('kilepEredmenyBtn').addEventListener('click', kilepes);

async function kilepes() {
  try { if (munkamenet) await hivas('kilep', { kod: munkamenet.kod, jatekosId: munkamenet.jatekosId }); } catch { /* mindegy */ }
  kapcsolatBont();
  munkamenetTorol();
  munkamenet = null;
  allapot = null;
  zeneLeallit();
  nezet('menu');
  publikusFrissit();
}

// ───────────────────────── publikus szobák ─────────────────────────

async function publikusFrissit() {
  try {
    const adat = (await modMeghataroz()) === 'firestore'
      ? await window.AstheticFirestore.publikusSzobak()
      : await (await fetch(apiBazis() + '/api/szobak', { cache: 'no-store' })).json();
    const lista = $('publikusLista');

    if (!adat.szobak.length) {
      lista.innerHTML = '<p class="kures">Most nincs nyitott nyilvános szoba. Nyiss egyet te!</p>';
      return;
    }

    const tipusNev = { year: 'évszám', artist: 'előadó', title: 'cím' };
    lista.innerHTML = adat.szobak
      .map((sz) => `
        <button class="kszoba" type="button" data-kod="${szoveg(sz.kod)}">
          <span>
            <span class="kszoba__kod">${szoveg(sz.kod)}</span><br>
            <span class="kszoba__info">${szoveg(sz.hostNev)} szobája · ${sz.jatekosok} játékos · ${sz.korok} kör</span>
          </span>
          <span class="kszoba__info">${sz.tipusok.map((t) => tipusNev[t]).join(', ')}</span>
        </button>`)
      .join('');

    lista.querySelectorAll('.kszoba').forEach((gomb) => {
      gomb.addEventListener('click', () => {
        if (!nevErteke()) { hibaKiir('menuHiba', 'Előbb írd be a neved.'); $('nevInput').focus(); return; }
        csatlakozas(gomb.dataset.kod);
      });
    });
  } catch {
    $('publikusLista').innerHTML =
      '<p class="kures">A szobalista most nem érhető el.</p>';
  }
}

// ───────────────────────── indulás ─────────────────────────

// Ha frissítettük az oldalt egy futó játék közben, visszakapcsolódunk.
if (munkamenet && munkamenet.kod && munkamenet.jatekosId) {
  $('nevInput').value = munkamenet.nev || '';
  csatlakozStream();
} else {
  publikusFrissit();
  setInterval(() => { if (!munkamenet) publikusFrissit(); }, 8000);
}
