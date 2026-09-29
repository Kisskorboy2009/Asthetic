/* ═══════════════════════════════════════════════════════════════
   ASTHETIC — Rubik-Bingó: a képernyő

   Két mód, ugyanazzal a felülettel:
     helyi  — minden ezen a készüléken fut (js/bingo-asztal.js közvetlenül)
     online — a szobavezető készüléke vezet, a többiek a Firestore-on át
              látják az állapotot (js/bingo-firestore.js)

   „Asztal” az a készülék, amelyik vezeti a játékot: ott szól a zene, és ott
   vannak a vezetői gombok. A lecsapás a képernyőn lévő gombbal megy.
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const $ = (id) => document.getElementById(id);
const B = window.AstheticBingo;
const Online = window.AstheticBingoOnline;
const Fiok = window.AstheticFiok;

const MUNKAMENET = 'asthetic-bingo';
const HELYI_MENTES = 'asthetic-bingo-helyi';

let S = null;   // a futó játék: { mod, kod, jatekosId, asztal, leiratkoz }
let N = null;   // a legutóbbi állapot: { p, titkos, sajatLepes }

/* ───────────── apróságok ───────────── */

function szoveg(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function toast(uzenet, fajta = '') {
  const el = document.createElement('div');
  el.className = 'toast' + (fajta ? ' toast--' + fajta : '');
  el.textContent = uzenet;
  $('toasts').appendChild(el);
  setTimeout(() => { el.classList.add('is-out'); setTimeout(() => el.remove(), 350); }, 3200);
}

function rezeg(ms = 40) {
  if (navigator.vibrate) { try { navigator.vibrate(ms); } catch { /* nem baj */ } }
}

function hibaKiir(id, uzenet) { $(id).textContent = uzenet || ''; }

function nezet(nev) {
  document.querySelectorAll('.bview').forEach((v) => v.classList.toggle('is-active', v.id === 'bv-' + nev));
}

function tarol(kulcs, ertek) {
  try {
    if (ertek === null) sessionStorage.removeItem(kulcs);
    else sessionStorage.setItem(kulcs, JSON.stringify(ertek));
  } catch { /* privát mód */ }
}
function olvas(kulcs) {
  try { return JSON.parse(sessionStorage.getItem(kulcs) || 'null'); } catch { return null; }
}

const szinAdat = (szin) => (szin === B.JOKER
  ? { nev: 'joker', hex: 'var(--b-feher)' }
  : { nev: B.SZINEK[szin].nev, hex: B.SZINEK[szin].hex });

const AVATAR_SZINEK = ['#B0603A', '#2F6B8F', '#4C7A3F', '#8A4B8F', '#A8781C', '#3E6E6A', '#A33D4F', '#5A5FA8', '#7A5A3A', '#2E7D6B'];

function avatarSzin(kulcs) {
  let h = 2166136261;
  for (const c of String(kulcs || '')) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return AVATAR_SZINEK[(h >>> 0) % AVATAR_SZINEK.length];
}

const kezdobetu = (nev) => (String(nev || '?').trim()[0] || '?').toUpperCase();

/** Kerek profilkép; ha nincs, vagy nem töltődik be, a név kezdőbetűje látszik. */
function avatar(j, osztaly = 'kavatar') {
  const kep = j && j.kep ? `<img src="${szoveg(j.kep)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">` : '';
  return `<span class="${osztaly}" style="--av:${avatarSzin(j && (j.id || j.nev))}"><b>${szoveg(kezdobetu(j && j.nev))}</b>${kep}</span>`;
}

/* A bingóban mindenki a Google-fiókja nevével és képével ül le az asztalhoz. */
const profil = () => Fiok.felhasznalo || {};
const nevErteke = () => String(profil().nev || '').trim().slice(0, 20) || 'Játékos';
const sajatKep = () => profil().kep || null;

/* ───────────── ki mit lát ───────────── */

/** Ez a készülék vezeti a játékot (helyi játék, vagy online a szobavezető). */
const asztalE = () => Boolean(S && S.asztal);
const helyiE = () => Boolean(S && S.mod === 'helyi');

function en() {
  if (!S || helyiE() || !N) return null;
  return N.p.jatekosok.find((j) => j.id === S.jatekosId) || null;
}
const jatszomE = () => { const j = en(); return Boolean(j && !j.nezo); };
const jatszok = (p) => p.jatekosok.filter((j) => !j.nezo);
const jatekosNev = (p, id) => { const j = p.jatekosok.find((x) => x.id === id); return j ? j.nev : '?'; };

/* ───────────── lépések: helyben az asztalnak, online a Firestore-nak ───────────── */

const lepes = {
  tipp(jatekosId, tipp) {
    if (asztalE()) return Promise.resolve(S.asztal.tipp(jatekosId, tipp));
    return Online.tipp(S.kod, jatekosId, N.p.kor, tipp).then(() => true);
  },
  lecsap(jatekosId) {
    if (asztalE()) return Promise.resolve(S.asztal.lecsap(jatekosId));
    return Online.lecsap(S.kod, jatekosId, N.p.kor).then(() => true);
  },
  jelol(jatekosId, mezo) {
    if (asztalE()) return Promise.resolve(S.asztal.jelol(jatekosId, mezo));
    return Online.jelol(S.kod, jatekosId, N.p.kor, mezo).then(() => true);
  },
};

/* ═══════════════════════════════════════════
   Bejelentkezés és menü
   ═══════════════════════════════════════════ */

function zarMutat(f) {
  nezet('zar');
  const nincs = !f;
  $('zarSzoveg').textContent = nincs
    ? 'Ez a játékmód még zárt tesztelés alatt áll. Jelentkezz be a Google-fiókoddal.'
    : `A(z) ${f.email} fiók nincs a tesztelők között. Jelentkezz be egy másikkal.`;
  $('zarBelepBtn').textContent = nincs ? 'Bejelentkezés Google-fiókkal' : 'Másik fiók';
  $('zarKilepBtn').hidden = nincs;
}

function menuMutat() {
  nezet('menu');
  const f = Fiok.felhasznalo;
  $('menuProfil').innerHTML = f ? `
    ${avatar({ id: f.uid, nev: f.nev, kep: f.kep }, 'kavatar bprofil__kep')}
    <div class="bprofil__szoveg">
      <div class="bprofil__cim">Így ülsz le az asztalhoz</div>
      <div class="bprofil__nev">${szoveg(nevErteke())}</div>
    </div>` : '';
  $('menuFiok').innerHTML = f
    ? `Bejelentkezve: ${szoveg(f.email)} · <button type="button" id="menuKilepBtn">Kijelentkezés</button>`
    : '';
  const gomb = $('menuKilepBtn');
  if (gomb) gomb.addEventListener('click', () => Fiok.kijelentkezes());
}

function fiokValtozott(f) {
  if (!f || !f.engedett) {
    if (S) jatekVege(null);
    zarMutat(f);
    return;
  }
  if (S) return;
  if (!folytatas()) menuMutat();
}

$('zarBelepBtn').addEventListener('click', async () => {
  const gomb = $('zarBelepBtn');
  if (gomb.disabled) return;
  gomb.disabled = true;
  hibaKiir('zarHiba', '');
  try {
    if (Fiok.felhasznalo) await Fiok.kijelentkezes();
    await Fiok.bejelentkezes();
  } catch (e) {
    hibaKiir('zarHiba', 'Nem sikerült bejelentkezni: ' + (e && e.message ? e.message : e));
  } finally { gomb.disabled = false; }
});
$('zarKilepBtn').addEventListener('click', () => Fiok.kijelentkezes());

$('ujJatekBtn').addEventListener('click', () => {
  hibaKiir('menuHiba', '');
  helyiNevekAlap();
  modValtozott();
  nezet('beallit');
});

$('csatlakozNezetBtn').addEventListener('click', () => {
  hibaKiir('menuHiba', '');
  nezet('csatlakoz');
  $('kodInput').focus();
});
$('csatlakozVisszaBtn').addEventListener('click', () => nezet('menu'));
$('beallitVisszaBtn').addEventListener('click', () => nezet('menu'));

/* ═══════════════════════════════════════════
   Beállítások
   ═══════════════════════════════════════════ */

const ELFOGADAS_SUGO = {
  pontos: 'Betűre pontosan kell, csak a kis- és nagybetű, az ékezet és az írásjelek mindegy.',
  normal: 'Egy-két elütés belefér. A „feat.” és a zárójeles toldás elhagyható.',
  laza: 'Elég, ha nagyjából stimmel — például fonetikusan leírva is elfogadja.',
};

const radioErtek = (nev) => (document.querySelector(`input[name="${nev}"]:checked`) || {}).value;

function modValtozott() {
  const helyi = radioErtek('mod') === 'helyi';
  $('helyiJatekosokMezo').hidden = !helyi;
  $('vezetoJatszikMezo').hidden = helyi;
  $('kezdesBtn').textContent = helyi ? 'Kezdjük!' : 'Szoba megnyitása';
  $('elfogadasSugo').textContent = ELFOGADAS_SUGO[radioErtek('elfogadas')] || '';
  $('lecsapIdoSor').hidden = !$('lecsapasInput').checked;
}
document.querySelectorAll('input[name="mod"], input[name="elfogadas"], #lecsapasInput')
  .forEach((el) => el.addEventListener('change', modValtozott));

function helyiNevSor(ertek = '') {
  const sor = document.createElement('div');
  sor.className = 'bnevek__sor';
  sor.innerHTML = `<input class="kinput" type="text" maxlength="20" placeholder="Játékos neve" value="${szoveg(ertek)}">
    <button class="bnevek__torol" type="button" aria-label="Törlés">×</button>`;
  sor.querySelector('button').addEventListener('click', () => {
    sor.remove();
  });
  $('helyiJatekosok').appendChild(sor);
  return sor;
}

/** Az első hely mindig a bejelentkezetté (a Google-névvel és -képpel), a többieket be kell írni. */
function helyiNevekAlap() {
  const doboz = $('helyiJatekosok');
  const en = doboz.querySelector('.bnevek__sor--en');
  const enHtml = `${avatar({ id: profil().uid, nev: nevErteke(), kep: sajatKep() }, 'kavatar kavatar--kicsi')}<span>${szoveg(nevErteke())}</span><em>te</em>`;
  if (en) { en.innerHTML = enHtml; return; }
  const sor = document.createElement('div');
  sor.className = 'bnevek__sor bnevek__sor--en';
  sor.innerHTML = enHtml;
  doboz.appendChild(sor);
  helyiNevSor('');
}

$('helyiUjBtn').addEventListener('click', () => {
  if ($('helyiJatekosok').children.length >= window.AstheticBingoAsztal.MAX_JATEKOS) {
    toast('Legfeljebb ' + window.AstheticBingoAsztal.MAX_JATEKOS + ' játékos fér az asztalhoz.', 'warn');
    return;
  }
  helyiNevSor('').querySelector('input').focus();
});

function beallitasOlvas() {
  const szam = (id) => { const v = $(id).value.trim(); return v === '' ? undefined : Number(v); };
  return {
    mod: radioErtek('mod'),
    mitKell: radioErtek('mitKell'),
    elfogadas: radioErtek('elfogadas'),
    lecsapas: $('lecsapasInput').checked,
    lecsapIdoMp: szam('lecsapIdoInput'),
    joker: $('jokerInput').checked,
    mindenkiUtanTovabb: $('mindenkiUtanInput').checked,
    vezetoJatszik: $('vezetoJatszikInput').checked,
    valaszIdoMp: szam('idoInput'),
    kezdesMp: szam('kezdesInput'),
    evTol: szam('evTolInput'),
    evIg: szam('evIgInput'),
  };
}

$('kezdesBtn').addEventListener('click', async () => {
  const gomb = $('kezdesBtn');
  if (gomb.disabled) return;
  const beallitas = beallitasOlvas();
  hibaKiir('beallitHiba', '');

  const dalok = await Online.dalokBetolt().catch(() => null);
  if (!dalok) { hibaKiir('beallitHiba', 'A dalok adatbázisa nem érhető el.'); return; }
  const b = B.tisztitBeallitas(beallitas);
  if (!B.dalValaszt(dalok, b, [])) { hibaKiir('beallitHiba', 'Ebben az évtartományban egyetlen dal sincs.'); return; }

  gomb.disabled = true;
  try {
    if (beallitas.mod === 'helyi') {
      const tobbiek = [...$('helyiJatekosok').querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean);
      helyiIndit(b, [{ nev: nevErteke(), kep: sajatKep() }, ...tobbiek.map((nev) => ({ nev }))], dalok);
    } else {
      const eredmeny = await Online.szobaLetrehoz(nevErteke(), b, sajatKep());
      S = { mod: 'online', kod: eredmeny.kod, jatekosId: eredmeny.jatekosId, asztal: eredmeny.asztal };
      tarol(MUNKAMENET, { mod: 'online', kod: S.kod, jatekosId: S.jatekosId });
      figyelIndit();
      ebrenTart();
    }
  } catch (e) {
    hibaKiir('beallitHiba', e && e.message ? e.message : String(e));
  } finally { gomb.disabled = false; }
});

/* ═══════════════════════════════════════════
   Játék indítása és folytatása
   ═══════════════════════════════════════════ */

function helyiAsztal(beallitas, dalok) {
  return new window.AstheticBingoAsztal.Asztal({
    kod: 'HELYI',
    beallitas,
    songs: dalok,
    valtozas: ({ publikus, titkos }) => {
      N = { p: publikus, titkos, sajatLepes: null };
      if (S && S.asztal) tarol(HELYI_MENTES, { publikus, titkos, tippek: S.asztal.tippek });
      rajzol();
    },
  });
}

function helyiIndit(beallitas, jatekosok, dalok) {
  const asztal = helyiAsztal({ ...beallitas, mod: 'helyi' }, dalok);
  S = { mod: 'helyi', asztal };
  tarol(MUNKAMENET, { mod: 'helyi' });
  jatekosok.forEach((j) => asztal.jatekosFelvesz(j));
  asztal.indit();
  ebrenTart();
}

/** Oldalfrissítés után: ha futott játék, onnan folytatjuk. */
function folytatas() {
  const m = olvas(MUNKAMENET);
  if (!m) return false;

  if (m.mod === 'helyi') {
    const mentes = olvas(HELYI_MENTES);
    if (!mentes || !mentes.publikus) { tarol(MUNKAMENET, null); return false; }
    Online.dalokBetolt().then((dalok) => {
      const asztal = helyiAsztal(mentes.publikus.beallitas, dalok);
      S = { mod: 'helyi', asztal };
      asztal.visszaallit(mentes.publikus, mentes.titkos, mentes.tippek);
      ebrenTart();
    }).catch(() => { tarol(MUNKAMENET, null); menuMutat(); });
    return true;
  }

  if (m.mod === 'online' && m.kod && m.jatekosId) {
    S = { mod: 'online', kod: m.kod, jatekosId: m.jatekosId, asztal: null };
    Online.init()
      .then(() => Online.vezetesFolytat(m.kod).catch(() => null))
      .then((asztal) => {
        if (!S) return;
        S.asztal = asztal;
        figyelIndit();
        ebrenTart();
      })
      .catch((e) => jatekVege(e.message));
    return true;
  }
  return false;
}

function figyelIndit() {
  if (S.leiratkoz) S.leiratkoz();
  S.leiratkoz = Online.figyel(S.kod, S.jatekosId, (uj) => { N = uj; rajzol(); },
    (hiba) => jatekVege(hiba && hiba.message ? hiba.message : 'A kapcsolat megszakadt.'));
}

async function csatlakozas() {
  const kod = $('kodInput').value.trim().toUpperCase();
  if (kod.length !== 4) { hibaKiir('csatlakozHiba', 'A szobakód 4 karakter.'); return; }
  const gomb = $('csatlakozBtn');
  if (gomb.disabled) return;
  gomb.disabled = true;
  hibaKiir('csatlakozHiba', '');
  $('csatlakozAllapot').textContent = 'Csatlakozás… a szobavezető most vesz fel.';
  try {
    const adat = await Online.csatlakozas(kod, nevErteke(), sajatKep());
    S = { mod: 'online', kod: adat.kod, jatekosId: adat.jatekosId, asztal: null };
    tarol(MUNKAMENET, { mod: 'online', kod: S.kod, jatekosId: S.jatekosId });
    figyelIndit();
    ebrenTart();
  } catch (e) {
    hibaKiir('csatlakozHiba', e.message);
  } finally {
    gomb.disabled = false;
    $('csatlakozAllapot').textContent = '';
  }
}
$('csatlakozBtn').addEventListener('click', csatlakozas);
$('kodInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') csatlakozas(); });

/** Kilépés, a szoba megszűnése, vagy kijelentkezés. */
function jatekVege(uzenet) {
  if (S) {
    if (S.leiratkoz) S.leiratkoz();
    if (S.asztal) S.asztal.leallit();
  }
  if (S && S.mod === 'online') Online.vezetesLeallit();
  S = null;
  N = null;
  tarol(MUNKAMENET, null);
  tarol(HELYI_MENTES, null);
  lapZar();
  zeneAll();
  elozo.kor = null;
  if (Fiok.engedett) { menuMutat(); hibaKiir('menuHiba', uzenet || ''); }
}

async function kilepes() {
  if (!S) return;
  const kerdes = asztalE()
    ? (helyiE() ? 'Befejezitek a játékot?' : 'Bezárod a szobát? A játék mindenkinek véget ér.')
    : 'Kilépsz a játékból?';
  if (N && N.p.allapot !== 'vege' && !window.confirm(kerdes)) return;
  if (S.mod === 'online') await Online.kilep(S.kod).catch(() => {});
  jatekVege(null);
}
['lobbyKilepBtn', 'jKilepBtn', 'vegeKilepBtn'].forEach((id) => $(id).addEventListener('click', kilepes));

/* ═══════════════════════════════════════════
   Rajzolás
   ═══════════════════════════════════════════ */

const elozo = { kor: null, fazis: null, lecsapoEn: false };

function rajzol() {
  if (!N || !N.p || !S) return;
  const p = N.p;
  if (p.allapot === 'lobby') {
    // Helyi játékban nincs váró: az új menetet a gomb rögtön el is indítja.
    if (helyiE()) return;
    rajzolLobby(p);
  } else if (p.allapot === 'kor' || p.allapot === 'eredmeny') {
    rajzolJatek(p);
  } else if (p.allapot === 'vege') {
    rajzolVege(p);
  }
  idoKezel(p);
  zeneKezel();
  lapFrissit();
}

/* ───────────── váró ───────────── */

const MIT_KELL = { mindketto: 'előadó + cím', barmelyik: 'előadó vagy cím', cim: 'csak cím', eloado: 'csak előadó' };
const ELFOGADAS = { pontos: 'pontos', normal: 'kis elírás belefér', laza: 'laza' };

function beallitasOsszegzes(b) {
  const korszak = (b.evTol > 1900 || b.evIg < 2100) ? ` · ${b.evTol}–${b.evIg}` : '';
  return `${MIT_KELL[b.mitKell]} · ${ELFOGADAS[b.elfogadas]} · ${b.valaszIdoMp} mp` +
    (b.lecsapas ? ` · lecsapás (${b.lecsapIdoMp} mp)` : ' · lecsapás nélkül') +
    (b.joker ? ' · jokerrel' : '') + korszak;
}

function rajzolLobby(p) {
  nezet('lobby');
  $('lobbyKod').textContent = p.kod;
  $('lobbyLetszam').textContent = jatszok(p).length;
  $('lobbyJatekosok').innerHTML = p.jatekosok
    .map((j) => `<span class="kplayer ${j.host ? 'kplayer--host' : ''}">${j.host ? '<span class="kplayer__crown">★</span>' : ''}${szoveg(j.nev)}${j.nezo ? ' <span class="kplayer__pont">(asztal)</span>' : ''}</span>`)
    .join('');
  $('lobbyBeallitas').textContent = beallitasOsszegzes(p.beallitas);
  $('inditBtn').hidden = !asztalE();
  $('lobbyHint').textContent = asztalE()
    ? 'Ezt a kódot írják be a többiek az alkalmazásban'
    : 'Várunk a szobavezetőre, hogy elindítsa a játékot';
}

$('inditBtn').addEventListener('click', () => {
  hibaKiir('lobbyHiba', '');
  try { S.asztal.indit(); } catch (e) { hibaKiir('lobbyHiba', e.message); }
});

/* ───────────── kerék ───────────── */

const kerek = { szegmens: 0, szog: 0, kulcs: null };

function kerekEpit(n) {
  const seg = 360 / n;
  const pont = (fok, r) => {
    const rad = (fok * Math.PI) / 180;
    return `${(100 + r * Math.sin(rad)).toFixed(2)} ${(100 - r * Math.cos(rad)).toFixed(2)}`;
  };
  let svg = '';
  for (let i = 0; i < n; i++) {
    const szin = i === B.JOKER ? 'var(--b-feher)' : B.SZINEK[i].hex;
    svg += `<path d="M100 100 L${pont(i * seg, 99)} A99 99 0 0 1 ${pont((i + 1) * seg, 99)} Z" fill="${szin}" stroke="rgba(0,0,0,.18)" stroke-width="1"/>`;
    if (i === B.JOKER) {
      const [x, y] = pont((i + 0.5) * seg, 70).split(' ');
      svg += `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="22" fill="#9A8F7E">★</text>`;
    }
  }
  $('jKerekLap').innerHTML = svg;
  kerek.szegmens = n;
}

function kerekRajzol(p) {
  const n = p.beallitas.joker ? B.SZINEK.length + 1 : B.SZINEK.length;
  if (n !== kerek.szegmens) kerekEpit(n);
  if (p.szin === null || p.szin === undefined) return;
  const kulcs = p.kor + ':' + p.szin;
  if (kulcs === kerek.kulcs) return;
  kerek.kulcs = kulcs;

  const seg = 360 / n;
  const kozep = (p.szin + 0.5) * seg + (Math.random() - 0.5) * seg * 0.5;
  const porog = p.allapot === 'kor' && p.fazis === 'porget';
  let cel = Math.ceil(kerek.szog / 360) * 360 + (porog ? 360 * 5 : 0) - kozep;
  if (cel < kerek.szog) cel += 360;
  const lap = $('jKerekLap');
  lap.classList.toggle('is-azonnal', !porog);
  lap.style.transform = `rotate(${cel}deg)`;
  kerek.szog = cel;
}

/* ───────────── asztal és helyek ───────────── */

function miniKartya(j) {
  if (!j.kartya) return '';
  return `<span class="bmini" aria-hidden="true">${j.kartya
    .map((s, i) => `<i style="--c:${B.SZINEK[s].hex}"${j.jelolt[i] ? ' class="x"' : ''}></i>`).join('')}</span>`;
}

function helyAllapot(p, j) {
  const e = p.eredmeny;
  if (p.allapot === 'vege') return p.nyertesek.includes(j.id) ? { osztaly: 'is-nyertes', jel: '★', jelFajta: 'jo' } : {};
  if (p.allapot === 'eredmeny' && e) {
    const t = e.tippek.find((x) => x.jatekosId === j.id);
    if (!t) return {};
    return t.jo ? { osztaly: 'is-jo', jel: '✓', jelFajta: 'jo' } : { osztaly: 'is-rossz', jel: '✗', jelFajta: 'rossz' };
  }
  if (p.lecsapas && p.lecsapas.jatekosId === j.id) return { osztaly: 'is-lecsap', jel: '!', jelFajta: 'lecsap' };
  if (p.kiesettek.includes(j.id)) return { osztaly: 'is-kiesett', jel: '✗', jelFajta: 'rossz' };
  if (p.bekuldtek.includes(j.id)) return { osztaly: 'is-kuldott', jel: '✓', jelFajta: 'kuldott' };
  return {};
}

function helyekRajzol(p) {
  let sor = jatszok(p);
  // Online a saját helyünk mindig alul van, mint egy igazi asztalnál.
  const sajat = sor.findIndex((j) => S && j.id === S.jatekosId);
  if (sajat > 0) sor = [...sor.slice(sajat), ...sor.slice(0, sajat)];

  const n = sor.length;
  const html = sor.map((j, i) => {
    const szog = Math.PI / 2 + (i * 2 * Math.PI) / Math.max(n, 1);
    const x = 50 + 42 * Math.cos(szog);
    const y = 50 + 41 * Math.sin(szog);
    const a = helyAllapot(p, j);
    const enE = S && j.id === S.jatekosId && !helyiE();
    return `<button class="bhely ${a.osztaly || ''}${enE ? ' is-en' : ''}" type="button" data-id="${szoveg(j.id)}"
        style="--x:${x.toFixed(2)}%;--y:${y.toFixed(2)}%" aria-label="${szoveg(j.nev)}">
        <span class="bhely__avatar" style="--szin:${avatarSzin(j.id)}">${szoveg(kezdobetu(j.nev))}${j.kep ? `<span class="bhely__kep"><img src="${szoveg(j.kep)}" alt="" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></span>` : ''}
          <span class="bhely__jel bhely__jel--${a.jelFajta || ''}">${a.jel || ''}</span></span>
        <span class="bhely__nev">${szoveg(j.nev)}</span>
        ${miniKartya(j)}
      </button>`;
  }).join('');
  $('jHelyek').innerHTML = html;
  $('jHelyek').querySelectorAll('.bhely').forEach((el) => el.addEventListener('click', () => helyKoppintas(el.dataset.id)));
}

/** Helyi játékban a névre koppintva lehet tippelni / ikszelni; máskor megnézni a kártyát. */
function helyKoppintas(id) {
  const p = N.p;
  if (helyiE()) {
    if (p.allapot === 'kor' && p.fazis === 'szol' && !p.kiesettek.includes(id)) { lapNyit('tipp', id); return; }
    if (p.allapot === 'kor' && p.fazis === 'lecsap' && p.lecsapas && p.lecsapas.jatekosId === id) { lapNyit('lecsap', id); return; }
    if (p.allapot === 'eredmeny' && p.eredmeny && p.eredmeny.jogok[id] && p.eredmeny.jelolesek[id] === undefined) { lapNyit('jeloles', id); return; }
  }
  lapNyit('kartya', id);
}

/* ───────────── kártya ───────────── */

function kartyaRajzol(doboz, j, { jelolheto = null, vonalak = [], onValaszt = null } = {}) {
  const vonalMezok = new Set(vonalak.flat());
  const valaszt = Array.isArray(jelolheto);
  doboz.classList.toggle('is-valaszt', valaszt);
  doboz.innerHTML = j.kartya.map((s, i) => {
    const oszt = ['bmezo'];
    if (j.jelolt[i]) oszt.push('is-x');
    if (valaszt && jelolheto.includes(i)) oszt.push('is-jelolheto');
    if (vonalMezok.has(i)) oszt.push('is-vonal');
    const nev = B.SZINEK[s].nev;
    return `<button class="${oszt.join(' ')}" type="button" data-i="${i}" style="--c:${B.SZINEK[s].hex}"
      aria-label="${i + 1}. mező, ${nev}${j.jelolt[i] ? ', kiikszelve' : ''}"
      ${valaszt && jelolheto.includes(i) ? '' : 'tabindex="-1"'}></button>`;
  }).join('');
  if (valaszt && onValaszt) {
    doboz.querySelectorAll('.bmezo.is-jelolheto').forEach((el) => {
      el.addEventListener('click', () => onValaszt(Number(el.dataset.i)), { once: true });
    });
  }
}

function jelolesFeladat(p, jatekosId) {
  const jog = p.eredmeny.jogok[jatekosId];
  if (jog === 'joker') return 'Lecsaptál és eltaláltad: bármelyik mezőt ikszelheted!';
  if (p.szin === B.JOKER) return 'A kerék jokert dobott: bármelyik mezőt ikszelheted!';
  const j = p.jatekosok.find((x) => x.id === jatekosId);
  const szinesek = B.jelolhetoMezok(j.kartya, j.jelolt, 'szin', p.szin).filter((i) => j.kartya[i] === p.szin);
  return szinesek.length
    ? `Ikszelj egy ${szinAdat(p.szin).nev} mezőt!`
    : `Nincs több üres ${szinAdat(p.szin).nev} meződ — bármelyiket ikszelheted.`;
}

/* ───────────── a játék nézete ───────────── */

function rajzolJatek(p) {
  nezet('jatek');
  const ujKor = elozo.kor !== p.kor;
  if (ujKor) {
    elozo.kor = p.kor;
    $('jEloado').value = '';
    $('jCim').value = '';
    lecsapKuldve = false;
  }

  $('jKor').textContent = `${p.kor}. kör`;
  if (p.szin !== null && p.szin !== undefined && !(p.allapot === 'kor' && p.fazis === 'porget')) {
    const sz = szinAdat(p.szin);
    $('jSzin').innerHTML = `<i style="background:${sz.hex}"></i>${p.szin === B.JOKER ? 'Joker — bármelyik szín' : sz.nev[0].toUpperCase() + sz.nev.slice(1)}`;
  } else {
    $('jSzin').innerHTML = '';
  }

  kerekRajzol(p);
  helyekRajzol(p);

  const enJ = en();
  const jatszom = jatszomE();
  const kiesett = jatszom && p.kiesettek.includes(enJ.id);
  const lecsapo = p.lecsapas && p.lecsapas.jatekosId;
  const enCsaptamLe = jatszom && lecsapo === enJ.id;

  // üzenet
  let uzenet = '';
  if (p.allapot === 'kor') {
    if (p.fazis === 'porget') uzenet = 'Pörög a kerék…';
    else if (p.fazis === 'lecsap') {
      uzenet = enCsaptamLe
        ? 'Lecsaptál! Írd be gyorsan!<small>A többieknek megállt a dal.</small>'
        : `${szoveg(p.lecsapas.nev)} lecsapott!<small>${helyiE() ? 'Koppints a nevére, és írja be a tippjét.' : 'Várjuk a tippjét…'}</small>`;
    } else if (helyiE()) {
      uzenet = 'Mi ez a dal?<small>Koppints a nevedre, írd be a tippet, és add tovább a telefont.</small>';
    } else if (!jatszom) {
      uzenet = `Szól a dal<small>${p.bekuldtek.length}/${jatszok(p).length} tipp érkezett</small>`;
    } else if (kiesett) {
      uzenet = 'Ebből a körből kimaradsz<small>Rossz volt a lecsapás — a többiek még tippelnek.</small>';
    } else if (p.bekuldtek.includes(enJ.id)) {
      uzenet = 'Beküldve ✓<small>Az idő végéig még módosíthatod.</small>';
    } else {
      uzenet = 'Mi ez a dal?';
    }
  } else if (p.allapot === 'eredmeny') {
    const e = p.eredmeny;
    const jok = e.tippek.filter((t) => t.jo).length;
    uzenet = jok ? `${jok} játékos eltalálta` : 'Most senki nem találta el';
  }
  $('jUzenet').innerHTML = uzenet;

  // tipp beírása (online, a saját telefonon)
  const tippLathato = jatszom && p.allapot === 'kor'
    && ((p.fazis === 'szol' && !kiesett) || (p.fazis === 'lecsap' && enCsaptamLe));
  $('jTipp').hidden = !tippLathato;
  $('jTipp').classList.toggle('is-lecsap', enCsaptamLe);
  if (tippLathato) {
    $('jKuldBtn').textContent = enCsaptamLe ? 'Ez a tippem!' : (p.bekuldtek.includes(enJ.id) ? 'Módosítom' : 'Beküldöm');
    if (enCsaptamLe && !elozo.lecsapoEn) {
      rezeg(80);
      ($('jEloado').value ? $('jCim') : $('jEloado')).focus();
    }
  }
  elozo.lecsapoEn = enCsaptamLe;

  // lecsapás
  const lecsapHet = p.beallitas.lecsapas && p.allapot === 'kor' && p.fazis === 'szol'
    && (helyiE() || (jatszom && !kiesett));
  $('jLecsapBtn').hidden = !(p.beallitas.lecsapas && p.allapot === 'kor' && (helyiE() || jatszom) && p.fazis !== 'porget');
  $('jLecsapBtn').disabled = !lecsapHet || lecsapKuldve;

  // eredmény
  $('jEredmeny').hidden = p.allapot !== 'eredmeny';
  if (p.allapot === 'eredmeny') eredmenyRajzol(p);

  // saját kártya
  $('jSajat').hidden = !jatszom;
  if (jatszom) {
    const e = p.eredmeny;
    const jelolhet = p.allapot === 'eredmeny' && e && e.jogok[enJ.id] && e.jelolesek[enJ.id] === undefined;
    $('jSajatCim').textContent = jelolhet ? jelolesFeladat(p, enJ.id) : 'A kártyád';
    $('jSajatCim').classList.toggle('is-feladat', Boolean(jelolhet));
    kartyaRajzol($('jKartya'), enJ, jelolhet ? {
      jelolheto: B.jelolhetoMezok(enJ.kartya, enJ.jelolt, e.jogok[enJ.id], p.szin),
      onValaszt: (mezo) => { rezeg(); lepes.jelol(enJ.id, mezo).catch((err) => toast(err.message, 'bad')); },
    } : {});
  }

  // vezetői gombok
  $('jKovetkezoBtn').hidden = !(asztalE() && p.allapot === 'eredmeny');
  $('jKihagyBtn').hidden = !(asztalE() && p.allapot === 'kor' && p.fazis === 'szol');
  $('jKilepBtn').textContent = asztalE() && !helyiE() ? 'Szoba bezárása' : 'Kilépés';
}

function eredmenyRajzol(p) {
  const e = p.eredmeny;
  const felulbiralhat = asztalE();
  const sorok = e.tippek.map((t) => {
    const reszek = [];
    const mit = p.beallitas.mitKell;
    if (mit !== 'cim') reszek.push(t.eloado ? `<span class="${t.eloadoJo ? 'jo' : 'rossz'}">${szoveg(t.eloado)}</span>` : '<em>nincs előadó</em>');
    if (mit !== 'eloado') reszek.push(t.cim ? `<span class="${t.cimJo ? 'jo' : 'rossz'}">${szoveg(t.cim)}</span>` : '<em>nincs cím</em>');
    const jog = e.jogok[t.jatekosId];
    const jelolt = e.jelolesek[t.jatekosId] !== undefined;
    let allas = t.jo ? (jelolt ? 'ikszelt ✓' : 'ikszel…') : (t.kiesett ? 'kiesett' : 'nem talált');
    if (!t.kuldott && !t.jo) allas = 'nem tippelt';
    const ikszelGomb = helyiE() && jog && !jelolt
      ? `<button class="btn btn--accent btippek__ikszel" type="button" data-ikszel="${szoveg(t.jatekosId)}">${szoveg(t.nev)} ikszel</button>` : '';
    const felulGomb = felulbiralhat
      ? `<button class="btippek__felul" type="button" data-felul="${szoveg(t.jatekosId)}" data-jo="${t.jo ? 0 : 1}">${t.jo ? 'Mégsem fogadom el' : 'Mégis elfogadom'}</button>` : '';
    return `<li class="${t.jo ? 'is-jo' : ''}">
      <span class="btippek__nev">${avatar(p.jatekosok.find((j) => j.id === t.jatekosId) || t, 'kavatar kavatar--kicsi')}<span>${szoveg(t.nev)}</span>${t.lecsap ? '<em>lecsapott</em>' : ''}${t.felulbiralva ? '<em style="color:var(--ink-3)">felülbírálva</em>' : ''}</span>
      <span class="btippek__allas ${t.jo ? 'jo' : 'rossz'}">${allas}</span>
      <span class="btippek__tipp">${t.kuldott ? reszek.join(' · ') : '—'}</span>
      ${ikszelGomb}${felulGomb}
    </li>`;
  }).join('');

  $('jEredmeny').innerHTML = `
    <div class="bdal">
      <div class="bdal__cim">${szoveg(e.dal.eloado)} — ${szoveg(e.dal.cim)}</div>
      <div class="bdal__ev">${szoveg(e.dal.ev)}</div>
    </div>
    <ul class="btippek">${sorok}</ul>
    <p class="bsugo" id="jJelolesSugo"></p>`;

  $('jEredmeny').querySelectorAll('[data-ikszel]').forEach((g) => g.addEventListener('click', () => lapNyit('jeloles', g.dataset.ikszel)));
  $('jEredmeny').querySelectorAll('[data-felul]').forEach((g) => g.addEventListener('click', () => {
    S.asztal.felulbiral(g.dataset.felul, g.dataset.jo === '1');
  }));
}

/* ───────────── vége ───────────── */

function rajzolVege(p) {
  nezet('vege');
  lapZar();
  const nyertesek = p.jatekosok.filter((j) => p.nyertesek.includes(j.id));
  const van = nyertesek.length > 0;
  $('vCim').textContent = van ? 'BINGÓ!' : 'Vége';
  $('vCim').classList.toggle('is-sima', !van);
  $('vKicker').textContent = `${p.kor}. kör`;
  $('vNyertes').textContent = van
    ? (nyertesek.length === 1 ? `${nyertesek[0].nev} nyert!` : `${nyertesek.map((j) => j.nev).join(' és ')} egyszerre rakta ki!`)
    : (p.uzenet || 'A játék véget ért.');

  const kartyak = $('vKartyak');
  kartyak.innerHTML = '';
  for (const j of nyertesek) {
    const doboz = document.createElement('div');
    doboz.className = 'bvege__kartya';
    doboz.innerHTML = `<div class="bvege__nyertes">${avatar(j, 'kavatar kavatar--nyertes')}<span class="bvege__korona" aria-hidden="true">♛</span></div>
      <div class="bvege__nev">${szoveg(j.nev)}</div><div class="bkartya"></div>`;
    kartyak.appendChild(doboz);
    kartyaRajzol(doboz.querySelector('.bkartya'), j, { vonalak: B.teljesVonalak(j.jelolt) });
  }

  // Sorrend: a nyertesek, aztán aki a legközelebb járt egy teljes vonalhoz, végül az X-ek száma.
  const legjobbVonal = (j) => Math.max(0, ...B.VONALAK.map((v) => v.filter((i) => j.jelolt && j.jelolt[i]).length));
  const sorok = jatszok(p)
    .map((j) => ({ j, x: (j.jelolt || []).filter(Boolean).length, vonal: legjobbVonal(j), nyert: p.nyertesek.includes(j.id) }))
    .sort((a, b) => (b.nyert - a.nyert) || (b.vonal - a.vonal) || (b.x - a.x));
  $('vTabla').innerHTML = sorok.map(({ j, x, vonal, nyert }, i) => `
    <li class="btoplista__sor${nyert ? ' is-nyertes' : ''}${S && j.id === S.jatekosId ? ' is-en' : ''}" style="--kesleltet:${i * 70}ms">
      <span class="btoplista__hely">${nyert ? '♛' : i + 1}</span>
      ${avatar(j, 'kavatar')}
      <span class="btoplista__nev">${szoveg(j.nev)}<small>${x} X · legjobb sor ${vonal}/5</small></span>
      <span class="btoplista__vonal" aria-label="${vonal} az 5-ből">${[0, 1, 2, 3, 4].map((k) => `<i${k < vonal ? ' class="be"' : ''}></i>`).join('')}</span>
    </li>`).join('');

  $('ujraBtn').hidden = !asztalE();
  $('vVarunk').textContent = asztalE() ? '' : 'Ha a szobavezető új menetet indít, maradj itt: magától indul.';
}

$('ujraBtn').addEventListener('click', () => {
  if (!asztalE()) return;
  S.asztal.ujra();
  if (helyiE()) S.asztal.indit();
});

/* ═══════════════════════════════════════════
   Tippelés, lecsapás, ikszelés — a saját telefonon
   ═══════════════════════════════════════════ */

let lecsapKuldve = false;

async function tippKuld() {
  const j = en();
  if (!j || !N) return;
  const tipp = { eloado: $('jEloado').value, cim: $('jCim').value };
  if (!tipp.eloado.trim() && !tipp.cim.trim()) { $('jTippAllapot').textContent = 'Írj be valamit.'; return; }
  const gomb = $('jKuldBtn');
  gomb.disabled = true;
  $('jTippAllapot').textContent = 'Küldés…';
  try {
    const ok = await lepes.tipp(j.id, tipp);
    $('jTippAllapot').textContent = ok === false ? 'Most nem küldhető — próbáld újra.' : '';
    rezeg(30);
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  } catch (e) {
    $('jTippAllapot').textContent = (e && e.message) || 'Nem sikerült elküldeni.';
  } finally { gomb.disabled = false; }
}
$('jKuldBtn').addEventListener('click', tippKuld);
$('jCim').addEventListener('keydown', (e) => { if (e.key === 'Enter') tippKuld(); });
$('jEloado').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('jCim').focus(); });

$('jLecsapBtn').addEventListener('click', async () => {
  if (!N || N.p.fazis !== 'szol') return;
  rezeg(70);
  if (helyiE()) { lapNyit('valaszt'); return; }
  const j = en();
  if (!j) return;
  lecsapKuldve = true;
  $('jLecsapBtn').disabled = true;
  try { await lepes.lecsap(j.id); } catch (e) { lecsapKuldve = false; toast(e.message, 'bad'); }
  // Ha valaki más volt a gyorsabb, a következő állapot visszaengedi a gombot.
  setTimeout(() => { lecsapKuldve = false; if (N) rajzol(); }, 2500);
});

$('jKovetkezoBtn').addEventListener('click', () => { if (asztalE()) S.asztal.kovetkezo(); });
$('jKihagyBtn').addEventListener('click', () => { if (asztalE()) S.asztal.dalKihagy(); });

/* ═══════════════════════════════════════════
   Alsó lap: helyi tippelés, ikszelés, „ki csapott le?”
   ═══════════════════════════════════════════ */

let lap = null;

function lapNyit(tipus, jatekosId = null) {
  if (!N) return;
  const p = N.p;
  lap = { tipus, jatekosId, kor: p.kor };
  const tartalom = $('bLapTartalom');
  const nev = jatekosId ? jatekosNev(p, jatekosId) : '';
  $('bLapIdo').textContent = '';

  if (tipus === 'tipp' || tipus === 'lecsap') {
    $('bLapCim').textContent = tipus === 'lecsap' ? `${nev} lecsapott!` : `${nev} tippje`;
    const korabbi = (S.asztal && S.asztal.tippek[jatekosId]) || {};
    tartalom.innerHTML = `
      <div class="kfield"><label for="lapEloado">Előadó</label>
        <input class="kinput" id="lapEloado" type="text" maxlength="80" autocomplete="off" spellcheck="false" value="${szoveg(korabbi.eloado || '')}"></div>
      <div class="kfield"><label for="lapCim">Cím</label>
        <input class="kinput" id="lapCim" type="text" maxlength="80" autocomplete="off" spellcheck="false" value="${szoveg(korabbi.cim || '')}"></div>
      <button class="btn btn--accent btn--lg" id="lapKuldBtn" type="button" style="width:100%">${tipus === 'lecsap' ? 'Ez a tippem!' : 'Kész, továbbadom'}</button>`;
    const kuld = () => {
      const t = { eloado: $('lapEloado').value, cim: $('lapCim').value };
      lapZar();
      lepes.tipp(jatekosId, t).then((ok) => { if (ok) toast(`${nev} tippje megvan.`, 'good'); });
    };
    $('lapKuldBtn').addEventListener('click', kuld);
    $('lapCim').addEventListener('keydown', (e) => { if (e.key === 'Enter') kuld(); });
    $('lapEloado').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('lapCim').focus(); });
    $('bLapMegse').hidden = tipus === 'lecsap';
    $('bLap').hidden = false;
    setTimeout(() => $('lapEloado').focus(), 60);
    return;
  }

  if (tipus === 'jeloles' || tipus === 'kartya') {
    const j = p.jatekosok.find((x) => x.id === jatekosId);
    if (!j || !j.kartya) { lap = null; return; }
    $('bLapCim').textContent = tipus === 'jeloles' ? `${nev} ikszel` : `${nev} kártyája`;
    tartalom.innerHTML = `<div class="bsajat">${tipus === 'jeloles' ? `<p class="bsajat__cim is-feladat">${szoveg(jelolesFeladat(p, jatekosId))}</p>` : ''}<div class="bkartya" id="lapKartya"></div></div>`;
    lapKartyaRajzol();
    $('bLapMegse').hidden = false;
    $('bLapMegse').textContent = tipus === 'jeloles' ? 'Mégse' : 'Bezárás';
    $('bLap').hidden = false;
    return;
  }

  if (tipus === 'valaszt') {
    $('bLapCim').textContent = 'Ki csapott le?';
    const kik = jatszok(p).filter((j) => !p.kiesettek.includes(j.id));
    tartalom.innerHTML = `<div class="blap__valaszt">${kik.map((j) => `
      <button class="blap__jatekos" type="button" data-id="${szoveg(j.id)}">
        ${avatar(j, 'kavatar')}<span>${szoveg(j.nev)}</span>
      </button>`).join('')}</div>`;
    tartalom.querySelectorAll('.blap__jatekos').forEach((g) => g.addEventListener('click', async () => {
      const id = g.dataset.id;
      lapZar();
      const ok = await lepes.lecsap(id);
      if (!ok) { toast('Most nem lehet lecsapni.', 'warn'); return; }
      if (helyiE()) lapNyit('lecsap', id);
      else toast(`${jatekosNev(N.p, id)} lecsapott — a telefonján írja be a tippjét.`, 'warn');
    }));
    $('bLapMegse').hidden = false;
    $('bLapMegse').textContent = 'Mégse';
    $('bLap').hidden = false;
  }
}

function lapKartyaRajzol() {
  if (!lap || !N) return;
  const p = N.p;
  const j = p.jatekosok.find((x) => x.id === lap.jatekosId);
  const doboz = $('lapKartya');
  if (!j || !doboz) return;
  if (lap.tipus === 'jeloles') {
    const e = p.eredmeny;
    kartyaRajzol(doboz, j, {
      jelolheto: B.jelolhetoMezok(j.kartya, j.jelolt, e.jogok[j.id], p.szin),
      onValaszt: (mezo) => { rezeg(); lapZar(); lepes.jelol(j.id, mezo); },
    });
  } else {
    kartyaRajzol(doboz, j, {});
  }
}

function lapZar() {
  lap = null;
  $('bLap').hidden = true;
  $('bLapTartalom').innerHTML = '';
}

/** Ha a játék továbblépett, a már érvénytelen lapot bezárjuk. */
function lapFrissit() {
  if (!lap || !N) return;
  const p = N.p;
  const id = lap.jatekosId;
  const e = p.eredmeny;
  const ervenyes = {
    tipp: p.allapot === 'kor' && p.fazis === 'szol' && p.kor === lap.kor && !p.kiesettek.includes(id),
    lecsap: p.allapot === 'kor' && p.fazis === 'lecsap' && p.lecsapas && p.lecsapas.jatekosId === id,
    jeloles: p.allapot === 'eredmeny' && e && e.jogok[id] && e.jelolesek[id] === undefined,
    valaszt: p.allapot === 'kor' && p.fazis === 'szol',
    kartya: p.allapot !== 'lobby',
  }[lap.tipus];
  if (!ervenyes) {
    if (lap.tipus === 'tipp') toast('Lejárt az idő.', 'warn');
    lapZar();
    return;
  }
  if (lap.tipus === 'kartya') lapKartyaRajzol();
}

$('bLapMegse').addEventListener('click', lapZar);
$('bLap').addEventListener('click', (e) => { if (e.target === $('bLap') && lap && lap.tipus !== 'lecsap') lapZar(); });

/* ═══════════════════════════════════════════
   Idő
   ═══════════════════════════════════════════ */

const ido = { azon: null, veg: null };

function idoKezel(p) {
  if (p.idoAzon === ido.azon) return;
  ido.azon = p.idoAzon;
  ido.veg = p.hatralevoMs === null || p.hatralevoMs === undefined ? null : Date.now() + p.hatralevoMs;
  idoFrissit();
}

function idoFrissit() {
  if (!N || !N.p) return;
  const p = N.p;
  const mp = ido.veg === null ? null : Math.max(0, Math.ceil((ido.veg - Date.now()) / 1000));
  let agy = '–';
  if (p.allapot === 'kor' && p.fazis === 'porget') agy = '?';
  else if (mp !== null && (p.allapot === 'kor' || p.allapot === 'eredmeny')) agy = String(mp);
  else if (p.allapot === 'eredmeny') agy = '✓';
  $('jIdo').textContent = agy;
  $('jKerek').classList.toggle('is-keves', p.fazis === 'szol' && mp !== null && mp <= 5);
  $('jKerek').classList.toggle('is-lecsap', p.fazis === 'lecsap');
  if (lap && lap.tipus === 'lecsap') $('bLapIdo').textContent = mp === null ? '' : mp + ' mp';

  const sugo = $('jJelolesSugo');
  if (sugo) {
    const e = p.eredmeny;
    const hatra = e && Object.keys(e.jogok).filter((id) => e.jelolesek[id] === undefined).length;
    sugo.textContent = p.allapot === 'eredmeny' && hatra && mp !== null
      ? `Ikszelésre még ${mp} mp — utána a gép választ helyettük.`
      : '';
  }
}
setInterval(idoFrissit, 250);

/* ═══════════════════════════════════════════
   Zene — csak az asztalon szól
   ═══════════════════════════════════════════ */

let lejatszo = null;
let lejatszoKesz = false;
let varakozoVideo = null;
let aktualisZene = null;
let hangEllenorzo = null;

function ytBetolt() {
  if (window.YT || document.getElementById('ytApi')) return;
  const s = document.createElement('script');
  s.id = 'ytApi';
  s.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(s);
}

window.onYouTubeIframeAPIReady = () => {
  lejatszo = new YT.Player('bYt', {
    host: 'https://www.youtube-nocookie.com',
    width: '200', height: '120',
    playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0, playsinline: 1, fs: 0, iv_load_policy: 3 },
    events: {
      onReady: () => {
        lejatszoKesz = true;
        if (varakozoVideo) { const v = varakozoVideo; varakozoVideo = null; zeneIndit(v.videoId, v.kezdes); }
      },
      onStateChange: (e) => { if (e.data === 1) $('jHangGomb').hidden = true; },
      onError: () => { if (asztalE()) toast('Ez a videó nem játszható le — kihagyhatod.', 'bad'); },
    },
  });
};

function zeneIndit(videoId, kezdesMp) {
  ytBetolt();
  if (!lejatszo || !lejatszoKesz) { varakozoVideo = { videoId, kezdes: kezdesMp }; return; }
  try { lejatszo.loadVideoById({ videoId, startSeconds: kezdesMp || 0 }); lejatszo.playVideo(); } catch { /* még nem kész */ }
  hangFigyel();
}

function hangFigyel() {
  clearTimeout(hangEllenorzo);
  hangEllenorzo = setTimeout(() => {
    let szol = false;
    try { szol = lejatszo.getPlayerState() === 1; } catch { /* nem tudjuk */ }
    $('jHangGomb').hidden = szol || !(N && N.p.fazis === 'szol');
  }, 1600);
}

function zeneFolytat() {
  if (!lejatszo || !lejatszoKesz) return;
  try { if (lejatszo.getPlayerState() !== 1) { lejatszo.playVideo(); hangFigyel(); } } catch { /* nem baj */ }
}

function zeneAll() {
  clearTimeout(hangEllenorzo);
  $('jHangGomb').hidden = true;
  if (lejatszo && lejatszoKesz) { try { lejatszo.pauseVideo(); } catch { /* nem baj */ } }
}

function zeneKezel() {
  if (!asztalE() || !N) return;
  const p = N.p;
  const t = N.titkos;
  const szolnia = p.allapot === 'kor' && p.fazis === 'szol' && t && t.kor === p.kor && t.videoId;
  if (p.allapot === 'kor') ytBetolt();
  if (!szolnia) { zeneAll(); return; }
  if (t.zeneAzon !== aktualisZene) {
    aktualisZene = t.zeneAzon;
    zeneIndit(t.videoId, t.kezdesMp);
  } else {
    zeneFolytat();
  }
}

$('jHangGomb').addEventListener('click', () => {
  $('jHangGomb').hidden = true;
  try { lejatszo.playVideo(); } catch { /* nincs mit tenni */ }
});

/* ═══════════════════════════════════════════
   Indulás
   ═══════════════════════════════════════════ */

let ebrenTarto = null;
async function ebrenTart() {
  if (!('wakeLock' in navigator) || ebrenTarto || document.visibilityState !== 'visible') return;
  try {
    ebrenTarto = await navigator.wakeLock.request('screen');
    ebrenTarto.addEventListener('release', () => { ebrenTarto = null; });
  } catch { /* nem támogatott */ }
}
document.addEventListener('visibilitychange', () => { if (S) ebrenTart(); });

(async function indulas() {
  zarMutat(null);
  $('zarSzoveg').textContent = 'Betöltés…';
  $('zarBelepBtn').hidden = true;
  await Fiok.kesz();
  $('zarBelepBtn').hidden = false;
  Fiok.figyel(fiokValtozott);
  fiokValtozott(Fiok.felhasznalo);
})();
