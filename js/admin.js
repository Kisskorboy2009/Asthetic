/* ═══════════════════════════════════════════════════════════════
   ASTHETIC — admin: a dallista szerkesztése

   A lista a Firestore-ban van (dalok/lista, JSON-szövegként), a játékok
   onnan olvassák (js/dalok.js). Itt a teljes lista a memóriában szerkeszthető,
   és a „Mentés” egyszerre írja ki. Mentés előtt az előző változat a
   dalok_mentesek gyűjteménybe kerül, és onnan visszaállítható.

   Írni csak a két admin fiók tud — ezt a firestore.rules dönti el, nem ez a fájl.
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const $ = (id) => document.getElementById(id);
const Fiok = window.AstheticFiok;

const OLDALMERET = 60;
const ELSO_EV = 1900;
const UTOLSO_EV = 2100;

let lista = [];            // a szerkesztett lista
let eredeti = new Map();   // id → a legutóbb mentett állapot JSON-ja (a változások jelöléséhez)
let meta = {};             // verzio, kovetkezoId, frissitve, modosito
let torolt = 0;            // a mentés óta törölt dalok száma
let lathato = OLDALMERET;
let szerkesztett = null;   // a szerkesztőben nyitott dal id-ja (új dalnál null)

/* ───────────── apróságok ───────────── */

function szoveg(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function toast(uzenet, fajta = '') {
  const el = document.createElement('div');
  el.className = 'toast' + (fajta ? ' toast--' + fajta : '');
  el.textContent = uzenet;
  $('toasts').appendChild(el);
  setTimeout(() => { el.classList.add('is-out'); setTimeout(() => el.remove(), 350); }, 3400);
}

function nezet(nev) {
  document.querySelectorAll('.aview').forEach((v) => v.classList.toggle('is-active', v.id === 'av-' + nev));
}

const ekezetNelkul = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function videoAzonosito(szovegErtek) {
  const v = String(szovegErtek || '').trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(v)) return v;
  try {
    const url = new URL(/^https?:\/\//i.test(v) ? v : 'https://' + v);
    const host = url.hostname.replace(/^(www|m|music)\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0];
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
    }
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const q = url.searchParams.get('v');
      if (q && /^[A-Za-z0-9_-]{11}$/.test(q)) return q;
      const m = url.pathname.match(/\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch { /* nem link */ }
  return null;
}

const valtozottE = (d) => eredeti.get(d.id) !== JSON.stringify(d);
const valtozasokSzama = () => lista.filter(valtozottE).length + torolt;

/* ═══════════════════════════════════════════
   Belépés
   ═══════════════════════════════════════════ */

function zar(szovegErtek, belepGomb) {
  nezet('zar');
  $('zarSzoveg').textContent = szovegErtek;
  $('zarBelepBtn').hidden = !belepGomb;
}

let betoltve = false;
function fiokValtozott(f) {
  if (!f) { zar('A dallistát csak az adminok szerkeszthetik. Jelentkezz be a Google-fiókoddal.', true); return; }
  if (!f.admin) { zar(`A(z) ${f.email} fióknak nincs admin jogosultsága.`, false); return; }
  nezet('lista');
  if (!betoltve) { betoltve = true; betolt(); hozzaferesBetolt(); }
}

$('zarBelepBtn').addEventListener('click', async () => {
  const gomb = $('zarBelepBtn');
  gomb.disabled = true;
  $('zarHiba').textContent = '';
  try { await Fiok.bejelentkezes(); } catch (e) { $('zarHiba').textContent = 'Nem sikerült: ' + (e.message || e); }
  gomb.disabled = false;
});

/* ═══════════════════════════════════════════
   Betöltés és mentés
   ═══════════════════════════════════════════ */

async function betolt() {
  $('aMeta').textContent = 'Betöltés…';
  try {
    const { lista: l, meta: m } = await window.AstheticDalok.betoltReszletesen({ friss: true });
    listaBeallit(l, m);
  } catch (e) {
    $('aMeta').textContent = 'Nem sikerült betölteni: ' + e.message;
  }
}

function listaBeallit(l, m) {
  lista = l.map((d) => ({ ...d }));
  eredeti = new Map(lista.map((d) => [d.id, JSON.stringify(d)]));
  meta = m || {};
  torolt = 0;
  lathato = OLDALMERET;
  metaKiir();
  rajzol();
}

function metaKiir() {
  const reszek = [`${lista.length} dal`];
  if (meta.forras === 'beepitett') reszek.push('még a beépített lista — az első mentéssel kerül fel');
  else if (meta.frissitve && meta.frissitve.toDate) {
    const d = meta.frissitve.toDate();
    reszek.push(`utoljára mentve: ${d.toLocaleString('hu-HU', { dateStyle: 'medium', timeStyle: 'short' })}${meta.modosito ? ' · ' + meta.modosito : ''}`);
  }
  $('aMeta').textContent = reszek.join(' · ');
}

function kovetkezoId() {
  const maxId = lista.reduce((m, d) => Math.max(m, Number(d.id) || 0), 0);
  return Math.max(maxId + 1, Number(meta.kovetkezoId) || 0);
}

async function ment() {
  const gomb = $('mentesBtn');
  if (gomb.disabled) return;
  gomb.disabled = true;
  const fb = window.ASTHETIC.firebaseIndit();
  const db = fb.firestore();
  const hiv = db.collection('dalok').doc('lista');
  const betoltottVerzio = Number(meta.verzio) || 0;
  const rendezett = lista.slice().sort((a, b) => a.id - b.id);
  const kovId = kovetkezoId();

  try {
    await db.runTransaction(async (tr) => {
      const most = await tr.get(hiv);
      const mostani = most.exists ? most.data() : null;
      if ((Number(mostani && mostani.verzio) || 0) !== betoltottVerzio) {
        throw new Error('Közben valaki más is mentett. Töltsd újra az oldalt, különben felülírnád a módosításait.');
      }
      if (mostani) {
        tr.set(db.collection('dalok_mentesek').doc(`v${mostani.verzio || 0}-${Date.now()}`), {
          ...mostani,
          archivalva: fb.firestore.FieldValue.serverTimestamp(),
        });
      }
      tr.set(hiv, {
        json: JSON.stringify(rendezett),
        darab: rendezett.length,
        verzio: betoltottVerzio + 1,
        kovetkezoId: kovId,
        frissitve: fb.firestore.FieldValue.serverTimestamp(),
        modosito: (Fiok.felhasznalo && Fiok.felhasznalo.email) || '',
      });
    });
    toast(`Mentve — ${rendezett.length} dal. A játékok mostantól ebből dolgoznak.`, 'good');
    const friss = await window.AstheticDalok.betoltReszletesen({ friss: true });
    listaBeallit(friss.lista, friss.meta);
  } catch (e) {
    toast(e.message || 'Nem sikerült menteni.', 'bad');
    gomb.disabled = false;
  }
}
$('mentesBtn').addEventListener('click', ment);

window.addEventListener('beforeunload', (e) => {
  if (valtozasokSzama()) { e.preventDefault(); e.returnValue = ''; }
});

/* ═══════════════════════════════════════════
   Lista
   ═══════════════════════════════════════════ */

function szurt() {
  const kereses = ekezetNelkul($('kereso').value.trim());
  const szuro = (document.querySelector('input[name="nyelvSzuro"]:checked') || {}).value || '';
  const rend = $('rendezes').value;
  let l = lista.filter((d) => {
    if (szuro === 'valtozott' ? !valtozottE(d) : (szuro && d.nyelv !== szuro)) return false;
    if (!kereses) return true;
    return ekezetNelkul(`${d.artist} ${d.title} ${d.titleOriginal || ''} ${d.year} ${d.videoId}`).includes(kereses);
  });
  const hu = (a, b) => String(a).localeCompare(String(b), 'hu');
  if (rend === 'id') l.sort((a, b) => b.id - a.id);
  else if (rend === 'eloado') l.sort((a, b) => hu(a.artist, b.artist) || hu(a.title, b.title));
  else if (rend === 'ev') l.sort((a, b) => a.year - b.year || hu(a.artist, b.artist));
  else if (rend === 'evCsokk') l.sort((a, b) => b.year - a.year || hu(a.artist, b.artist));
  return l;
}

function rajzol() {
  const l = szurt();
  const db = valtozasokSzama();
  $('mentesBtn').disabled = db === 0;
  $('valtozasDb').hidden = db === 0;
  $('valtozasDb').textContent = db;
  $('talalat').textContent = l.length === lista.length ? `${l.length} dal` : `${l.length} találat a ${lista.length} dalból`;

  $('aLista').innerHTML = l.slice(0, lathato).map((d) => {
    const uj = !eredeti.has(d.id);
    const valt = !uj && valtozottE(d);
    return `<button class="adal${uj ? ' is-uj' : valt ? ' is-valtozott' : ''}" type="button" data-id="${d.id}">
      <span class="adal__kep"><img src="https://i.ytimg.com/vi/${szoveg(d.videoId)}/mqdefault.jpg" alt="" loading="lazy" onerror="this.remove()"></span>
      <span class="adal__szoveg">
        <span class="adal__cim">${szoveg(d.title)}</span>
        <span class="adal__eloado">${szoveg(d.artist)}</span>
      </span>
      <span class="adal__cimkek">
        <span class="adal__ev">${szoveg(d.year)}</span>
        <span class="adal__nyelv">${d.nyelv === 'hu' ? 'HU' : 'INT'}</span>
        ${uj ? '<span class="adal__jel">új</span>' : valt ? '<span class="adal__jel">módosítva</span>' : ''}
      </span>
    </button>`;
  }).join('') || '<p class="kures">Nincs találat.</p>';

  $('tobbBtn').hidden = l.length <= lathato;
  $('tobbBtn').textContent = `Mutass még (${Math.min(OLDALMERET, l.length - lathato)})`;
  $('aLista').querySelectorAll('.adal').forEach((el) => el.addEventListener('click', () => szerkNyit(Number(el.dataset.id))));
}

let keresesIdozito = null;
$('kereso').addEventListener('input', () => {
  clearTimeout(keresesIdozito);
  keresesIdozito = setTimeout(() => { lathato = OLDALMERET; rajzol(); }, 120);
});
document.querySelectorAll('input[name="nyelvSzuro"]').forEach((el) => el.addEventListener('change', () => { lathato = OLDALMERET; rajzol(); }));
$('rendezes').addEventListener('change', () => { lathato = OLDALMERET; rajzol(); });
$('tobbBtn').addEventListener('click', () => { lathato += OLDALMERET; rajzol(); });

/* ═══════════════════════════════════════════
   Szerkesztő
   ═══════════════════════════════════════════ */

function szerkNyit(id) {
  const d = id === null ? null : lista.find((x) => x.id === id);
  szerkesztett = d ? d.id : null;
  $('szerkCim').textContent = d ? 'Dal szerkesztése' : 'Új dal';
  $('fVideo').value = d ? `https://youtu.be/${d.videoId}` : '';
  $('fEloado').value = d ? d.artist : '';
  $('fCim').value = d ? d.title : '';
  $('fEv').value = d ? d.year : '';
  $('fEredeti').value = d && d.titleOriginal && d.titleOriginal !== d.title ? d.titleOriginal : '';
  document.querySelectorAll('input[name="fNyelv"]').forEach((r) => { r.checked = r.value === (d ? d.nyelv : 'hu'); });
  $('torolBtn').hidden = !d;
  $('szerkHiba').textContent = '';
  elonezetFrissit();
  $('szerk').hidden = false;
  document.body.classList.add('is-lapnyitva');
  setTimeout(() => (d ? $('fEloado') : $('fVideo')).focus(), 50);
}

function szerkZar() {
  $('szerk').hidden = true;
  document.body.classList.remove('is-lapnyitva');
  $('elonezet').querySelectorAll('iframe').forEach((f) => f.remove());
  szerkesztett = null;
}

function elonezetFrissit() {
  const id = videoAzonosito($('fVideo').value);
  const doboz = $('elonezet');
  doboz.querySelectorAll('iframe').forEach((f) => f.remove());
  $('elonezetKep').hidden = !id;
  $('lejatszBtn').hidden = !id;
  $('elonezetUres').hidden = Boolean(id);
  $('elonezetUres').textContent = $('fVideo').value.trim() && !id ? 'Ez nem tűnik YouTube-linknek' : 'Illeszd be a YouTube-linket';
  if (id) $('elonezetKep').src = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
}

$('fVideo').addEventListener('input', elonezetFrissit);
$('lejatszBtn').addEventListener('click', () => {
  const id = videoAzonosito($('fVideo').value);
  if (!id) return;
  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube-nocookie.com/embed/${id}?start=45&autoplay=1&rel=0&modestbranding=1`;
  iframe.allow = 'autoplay; encrypted-media';
  iframe.title = 'Előnézet';
  $('elonezet').appendChild(iframe);
  $('lejatszBtn').hidden = true;
});

$('szerkUrlap').addEventListener('submit', (e) => {
  e.preventDefault();
  const hiba = (s) => { $('szerkHiba').textContent = s; };
  const videoId = videoAzonosito($('fVideo').value);
  const artist = $('fEloado').value.trim().replace(/\s+/g, ' ');
  const title = $('fCim').value.trim().replace(/\s+/g, ' ');
  const year = Number($('fEv').value);
  const eredetiCim = $('fEredeti').value.trim().replace(/\s+/g, ' ');
  const nyelv = (document.querySelector('input[name="fNyelv"]:checked') || {}).value || 'hu';

  if (!videoId) return hiba('Adj meg egy érvényes YouTube-linket.');
  if (!artist) return hiba('Hiányzik az előadó.');
  if (!title) return hiba('Hiányzik a cím.');
  if (!Number.isInteger(year) || year < ELSO_EV || year > UTOLSO_EV) return hiba(`Az év ${ELSO_EV} és ${UTOLSO_EV} közötti egész szám legyen.`);
  const dupla = lista.find((d) => d.videoId === videoId && d.id !== szerkesztett);
  if (dupla) return hiba(`Ez a videó már szerepel: ${dupla.artist} — ${dupla.title}.`);

  const adat = { artist, title, titleOriginal: eredetiCim || title, year, videoId, nyelv };
  if (szerkesztett === null) {
    lista.push({ id: kovetkezoId(), ...adat });
    toast('Hozzáadva — ne felejtsd el menteni.', 'good');
  } else {
    const d = lista.find((x) => x.id === szerkesztett);
    Object.assign(d, adat);
  }
  szerkZar();
  rajzol();
});

$('torolBtn').addEventListener('click', () => {
  const d = lista.find((x) => x.id === szerkesztett);
  if (!d || !window.confirm(`Törlöd? ${d.artist} — ${d.title}`)) return;
  lista = lista.filter((x) => x.id !== d.id);
  if (eredeti.has(d.id)) torolt++;
  szerkZar();
  metaKiir();
  rajzol();
  toast('Törölve — a mentéssel lesz végleges.', 'warn');
});

$('ujDalBtn').addEventListener('click', () => szerkNyit(null));
$('szerkZarBtn').addEventListener('click', szerkZar);
$('szerk').addEventListener('click', (e) => { if (e.target === $('szerk')) szerkZar(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('szerk').hidden) szerkZar(); });

/* ═══════════════════════════════════════════
   Eszközök
   ═══════════════════════════════════════════ */

$('letoltBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(lista.slice().sort((a, b) => a.id - b.id), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `asthetic-dalok-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('gyariBtn').addEventListener('click', async () => {
  if (!window.confirm('Betöltöd a weboldallal kiszállított eredeti listát? Mentés után felülírja a mostanit (a mostani a korábbi mentések közé kerül).')) return;
  const l = await window.AstheticDalok.beepitett();
  lista = l.map((d) => ({ ...d }));
  torolt = [...eredeti.keys()].filter((id) => !lista.some((d) => d.id === id)).length;
  rajzol();
  toast('A beépített lista betöltve — mentéssel lesz érvényes.', 'warn');
});

$('mentesekBtn').addEventListener('click', async () => {
  const doboz = $('mentesekLista');
  if (!doboz.hidden) { doboz.hidden = true; return; }
  doboz.hidden = false;
  doboz.innerHTML = '<p class="kures">Betöltés…</p>';
  try {
    const db = window.ASTHETIC.firebaseIndit().firestore();
    const q = await db.collection('dalok_mentesek').orderBy('archivalva', 'desc').limit(20).get();
    if (q.empty) { doboz.innerHTML = '<p class="kures">Még nincs korábbi mentés.</p>'; return; }
    const sorok = [];
    q.forEach((d) => {
      const x = d.data();
      const mikor = x.frissitve && x.frissitve.toDate ? x.frissitve.toDate().toLocaleString('hu-HU', { dateStyle: 'medium', timeStyle: 'short' }) : '–';
      sorok.push(`<div class="amentesSor"><span><strong>${szoveg(mikor)}</strong><br><small>${x.darab || '?'} dal · ${szoveg(x.modosito || '')}</small></span>
        <button class="btn btn--ghost btn--sm" type="button" data-mentes="${szoveg(d.id)}">Visszaállítás</button></div>`);
    });
    doboz.innerHTML = sorok.join('');
    doboz.querySelectorAll('[data-mentes]').forEach((g) => g.addEventListener('click', async () => {
      const d = await db.collection('dalok_mentesek').doc(g.dataset.mentes).get();
      if (!d.exists || !window.confirm('Betöltöd ezt a változatot? Mentéssel lesz érvényes.')) return;
      lista = JSON.parse(d.data().json).map((x) => ({ ...x }));
      torolt = [...eredeti.keys()].filter((id) => !lista.some((x) => x.id === id)).length;
      rajzol();
      toast('A korábbi változat betöltve — mentéssel lesz érvényes.', 'warn');
    }));
  } catch (e) {
    doboz.innerHTML = `<p class="kures">Nem sikerült: ${szoveg(e.message)}</p>`;
  }
});

/* ═══════════════════════════════════════════
   Fülek
   ═══════════════════════════════════════════ */

document.querySelectorAll('input[name="panel"]').forEach((r) => r.addEventListener('change', () => {
  const hozza = r.value === 'hozzaferes' && r.checked;
  $('panelDalok').hidden = hozza;
  $('panelHozzaferes').hidden = !hozza;
  $('aCim').textContent = hozza ? 'Bingó-hozzáférés' : 'Dallista';
  $('aMeta').hidden = hozza;
}));

/* ═══════════════════════════════════════════
   Rubik-Bingó hozzáférés
   Egy dokumentum e-mail-címenként: bingo_hozzaferes/{email}. Az adminok
   (Fiok.ADMINOK) nincsenek benne — ők mindig hozzáférnek, nem törölhetők.
   ═══════════════════════════════════════════ */

const EMAIL_MINTA = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const hozzaferesHiv = () => window.ASTHETIC.firebaseIndit().firestore().collection('bingo_hozzaferes');

async function hozzaferesBetolt() {
  const lista = $('emailLista');
  lista.innerHTML = '<li class="kures">Betöltés…</li>';
  try {
    const q = await hozzaferesHiv().get();
    const tesztelok = [];
    q.forEach((d) => tesztelok.push({ email: d.id, ...d.data() }));
    tesztelok.sort((a, b) => a.email.localeCompare(b.email));
    const sor = (email, admin, x = {}) => {
      const mikor = x.mikor && x.mikor.toDate ? x.mikor.toDate().toLocaleDateString('hu-HU') : '';
      return `<li class="aemail${admin ? ' is-admin' : ''}">
        <span class="aemail__betu">${szoveg(email[0].toUpperCase())}</span>
        <span class="aemail__szoveg"><strong>${szoveg(email)}</strong>
          <small>${admin ? 'admin — mindig hozzáfér' : `hozzáadta: ${szoveg(x.hozzaadta || '?')}${mikor ? ' · ' + mikor : ''}`}</small></span>
        ${admin
          ? '<span class="aemail__zar" aria-label="Nem törölhető">🔒</span>'
          : `<button class="btn btn--ghost btn--sm" type="button" data-torol="${szoveg(email)}">Eltávolítás</button>`}
      </li>`;
    };
    lista.innerHTML = Fiok.ADMINOK.map((e) => sor(e, true)).join('') + tesztelok.map((t) => sor(t.email, false, t)).join('');
    lista.querySelectorAll('[data-torol]').forEach((g) => g.addEventListener('click', async () => {
      const email = g.dataset.torol;
      if (!window.confirm(`Eltávolítod ${email} hozzáférését a Rubik-Bingóhoz?`)) return;
      g.disabled = true;
      try {
        await hozzaferesHiv().doc(email).delete();
        toast(`${email} már nem játszhat a bingóval.`, 'warn');
        hozzaferesBetolt();
      } catch (e) { toast('Nem sikerült: ' + e.message, 'bad'); g.disabled = false; }
    }));
  } catch (e) {
    lista.innerHTML = `<li class="kures">Nem sikerült betölteni: ${szoveg(e.message)}</li>`;
  }
}

$('emailUrlap').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('ujEmail').value.trim().toLowerCase();
  $('emailHiba').textContent = '';
  if (!EMAIL_MINTA.test(email)) { $('emailHiba').textContent = 'Ez nem tűnik érvényes e-mail-címnek.'; return; }
  if (Fiok.ADMINOK.includes(email)) { $('emailHiba').textContent = 'Ő admin, mindig hozzáfér.'; return; }
  const gomb = $('emailHozzaadBtn');
  gomb.disabled = true;
  try {
    const fb = window.ASTHETIC.firebaseIndit();
    const hiv = hozzaferesHiv().doc(email);
    if ((await hiv.get()).exists) { $('emailHiba').textContent = 'Már a listán van.'; return; }
    await hiv.set({
      hozzaadta: (Fiok.felhasznalo && Fiok.felhasznalo.email) || '',
      mikor: fb.firestore.FieldValue.serverTimestamp(),
    });
    $('ujEmail').value = '';
    toast(`${email} mostantól játszhat a Rubik-Bingóval.`, 'good');
    hozzaferesBetolt();
  } catch (err) {
    $('emailHiba').textContent = 'Nem sikerült: ' + err.message;
  } finally { gomb.disabled = false; }
});

/* ───────────── indulás ───────────── */

(async function () {
  await Fiok.kesz();
  Fiok.figyel(fiokValtozott);
  fiokValtozott(Fiok.felhasznalo);
})();
