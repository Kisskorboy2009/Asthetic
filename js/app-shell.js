/* ═══════════════════════════════════════════════════════════════
   ASTHETIC — alkalmazás-váz

   Csak az Android alkalmazásban fut le (a <html> elemen ott van az `is-app`
   osztály). Böngészőben azonnal kilép, tehát a weboldalt nem érinti.

   Felépíti a natív érzetű keretet: felül tömör sáv (cím + vissza + sötét mód),
   alul fülsor, a kezdőlapon pedig marketingszöveg helyett rögtön a játékmódok.
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  if (!document.documentElement.classList.contains('is-app')) return;

  const ikon = {
    vissza: '<path d="M15 5 8 12l7 7"/>',
    kartya: '<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M7.5 9.5h4M7.5 13h7"/>',
    kviz: '<circle cx="12" cy="12" r="8.5"/><path d="M9.4 9.6a2.7 2.7 0 1 1 3.4 2.6v1.4"/><circle cx="12.2" cy="16.6" r=".9" fill="currentColor" stroke="none"/>',
    szabaly: '<path d="M6 3.5h8.5L19 8v12.5H6z"/><path d="M14 3.5V8h4.5M9 12.5h6M9 16h4"/>',
    otthon: '<path d="M4 10.5 12 4l8 6.5V20h-5.5v-5h-5v5H4z"/>',
    nyil: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
    bingo: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M9.3 4v16M14.7 4v16M4 9.3h16M4 14.7h16"/>',
    fiok: '<circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.9-3.6 3.7-5.4 7-5.4s6.1 1.8 7 5.4"/>',
    nap: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M4.2 12H2M22 12h-2.2M6.3 6.3 4.8 4.8M19.2 19.2l-1.5-1.5M17.7 6.3l1.5-1.5M4.8 19.2l1.5-1.5"/>',
  };

  function svg(tartalom, meret) {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
      ${meret ? `width="${meret}" height="${meret}"` : ''}>${tartalom}</svg>`;
  }

  const OLDALAK = {
    'index.html': { cim: 'Asthetic', ful: 'kezdo', gyoker: true },
    '': { cim: 'Asthetic', ful: 'kezdo', gyoker: true },
    'jatek.html': { cim: 'Kártyás játék', ful: 'kartya', gyoker: true },
    'kahoot.html': { cim: 'Kvízcsata', ful: 'kviz', gyoker: true },
    'bingo.html': { cim: 'Rubik-Bingó', ful: 'bingo', gyoker: true },
    'szabalyok.html': { cim: 'Szabályok', ful: null },
    'adatvedelem.html': { cim: 'Adatvédelem', ful: null },
    'feltetelek.html': { cim: 'Felhasználási feltételek', ful: null },
    '404.html': { cim: 'Nincs ilyen oldal', ful: null },
    'letoltes.html': { cim: 'Alkalmazás', ful: null },
  };

  const fajl = location.pathname.split('/').pop() || 'index.html';
  const oldal = OLDALAK[fajl] || { cim: 'Asthetic', ful: null };

  /* ───────────── felső sáv ───────────── */

  const sav = document.createElement('div');
  sav.className = 'appSav';
  sav.innerHTML = `
    <button class="appSav__gomb" id="appVissza" type="button" aria-label="Vissza" ${oldal.gyoker ? 'hidden' : ''}>${svg(ikon.vissza)}</button>
    <span class="appSav__cim">${oldal.cim}</span>
    <button class="appSav__gomb appSav__fiok" id="appFiok" type="button" aria-label="Fiók">${svg(ikon.fiok)}</button>
    <button class="appSav__gomb" id="appTema" type="button" aria-label="Sötét mód be- és kikapcsolása">${svg(ikon.nap)}</button>`;
  document.body.appendChild(sav);

  document.getElementById('appVissza').addEventListener('click', () => {
    if (history.length > 1) history.back();
    else location.href = 'index.html';
  });

  // A sötét mód ugyanazt a kapcsolót használja, mint a weboldal (js/site.js).
  document.getElementById('appTema').addEventListener('click', () => {
    const gomb = document.getElementById('themeToggle');
    if (gomb) { gomb.click(); return; }
    const most = document.documentElement.getAttribute('data-theme');
    const uj = most === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', uj);
    try { localStorage.setItem('asthetic-theme', uj); } catch { /* privát mód */ }
  });

  /* ───────────── Google-fiók ───────────── */

  const Fiok = window.AstheticFiok;
  // A Rubik-Bingó zárt teszt: csak a tesztelők látják a menüben.
  const bingoLathato = () => Boolean(Fiok && Fiok.engedett);

  function fiokGombFrissit() {
    const f = Fiok && Fiok.felhasznalo;
    const gomb = document.getElementById('appFiok');
    gomb.classList.toggle('is-be', Boolean(f));
    gomb.innerHTML = f && f.kep
      ? `<img src="${f.kep}" alt="" referrerpolicy="no-referrer">`
      : svg(ikon.fiok);
  }

  function fiokLap() {
    const f = Fiok && Fiok.felhasznalo;
    const regi = document.getElementById('appFiokLap');
    if (regi) { regi.remove(); return; }
    const lap = document.createElement('div');
    lap.className = 'appFiokLap';
    lap.id = 'appFiokLap';
    const nev = (s) => String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    lap.innerHTML = f
      ? `<div class="appFiokLap__nev">${nev(f.nev)}</div><div class="appFiokLap__email">${nev(f.email)}</div>
         <button class="btn btn--ghost" type="button" data-muvelet="ki">Kijelentkezés</button>`
      : `<div class="appFiokLap__nev">Nem vagy bejelentkezve</div>
         <button class="btn btn--accent" type="button" data-muvelet="be">Bejelentkezés Google-fiókkal</button>
         <p class="appFiokLap__allapot" hidden></p>
         <p class="appFiokLap__hiba" hidden></p>`;
    document.body.appendChild(lap);
    lap.querySelector('button').addEventListener('click', async (e) => {
      const gomb = e.currentTarget;
      const allapot = lap.querySelector('.appFiokLap__allapot');
      const h = lap.querySelector('.appFiokLap__hiba');
      const jelez = (szoveg) => { if (allapot) { allapot.hidden = false; allapot.textContent = szoveg; } };
      gomb.disabled = true;
      if (h) h.hidden = true;
      try {
        if (gomb.dataset.muvelet === 'ki') await Fiok.kijelentkezes();
        else await Fiok.bejelentkezes(jelez);
        lap.remove();
      } catch (hiba) {
        if (allapot) allapot.hidden = true;
        if (h) { h.hidden = false; h.textContent = 'Nem sikerült: ' + (hiba && hiba.message ? hiba.message : hiba); }
        gomb.disabled = false;
      }
    });
    setTimeout(() => document.addEventListener('click', function zar(e) {
      if (lap.contains(e.target)) return;
      lap.remove();
      document.removeEventListener('click', zar);
    }), 0);
  }

  document.getElementById('appFiok').addEventListener('click', fiokLap);
  fiokGombFrissit();

  /* ───────────── alsó fülsor ───────────── */

  const fulSor = document.createElement('nav');
  fulSor.className = 'appFulek';
  fulSor.setAttribute('aria-label', 'Alkalmazás menü');
  document.body.appendChild(fulSor);

  function fulekRajzol() {
    const fulek = [
      { azon: 'kartya', cim: 'Kártya', hivatkozas: 'jatek.html', ikon: ikon.kartya },
      { azon: 'kviz', cim: 'Kvízcsata', hivatkozas: 'kahoot.html', ikon: ikon.kviz },
      ...(bingoLathato() ? [{ azon: 'bingo', cim: 'Bingó', hivatkozas: 'bingo.html', ikon: ikon.bingo }] : []),
      { azon: 'kezdo', cim: 'Kezdőlap', hivatkozas: 'index.html', ikon: ikon.otthon },
    ];
    fulSor.style.gridTemplateColumns = `repeat(${fulek.length}, 1fr)`;
    fulSor.innerHTML = fulek
      .map((f) => `<a class="appFul${oldal.ful === f.azon ? ' is-aktiv' : ''}" href="${f.hivatkozas}">
          ${svg(f.ikon)}<span>${f.cim}</span>
        </a>`)
      .join('');
  }
  fulekRajzol();

  /* ───────────── keskeny kijelző: rövidebb oszlopnevek ───────────── */

  // A "Összesen" fejléc nem fér ki egy sorban telefonon, és csúnyán törik.
  // A weboldalon marad a teljes szó, itt rövidítjük.
  const ROVID = { 'Összesen': 'Össz.', 'Játékos': 'Név' };
  document.querySelectorAll('.ktabla th').forEach((cella) => {
    const rovid = ROVID[cella.textContent.trim()];
    if (rovid) cella.textContent = rovid;
  });

  /* ───────────── kezdőlap: alkalmazás-menü a marketingszöveg helyett ───────────── */

  if (oldal.ful === 'kezdo') {
    const fo = document.getElementById('main');
    if (fo) {
      // A weboldalas tartalom marad a DOM-ban (a keresők és a webes verzió
      // miatt), csak az alkalmazásban nem jelenítjük meg.
      Array.from(fo.children).forEach((el) => el.classList.add('appRejt'));

      const otthon = document.createElement('div');
      otthon.className = 'appHome';
      otthon.innerHTML = `
        <div class="appHome__fej">
          <img class="appHome__logo" src="assets/asthetic-logo.png" alt="">
          <div class="appHome__nev">Asthetic</div>
          <p class="appHome__alcim">Zenei társasjáték — kártyáról vagy közösen</p>
        </div>
        <div class="appCsempek">
          <a class="appCsempe" href="jatek.html">
            <span class="appCsempe__ikon">${svg(ikon.kartya)}</span>
            <span>
              <span class="appCsempe__cim">Kártyás játék</span>
              <span class="appCsempe__alcim">Olvasd be a kártya QR-kódját, és szóljon a dal</span>
            </span>
            <span class="appCsempe__nyil">${svg(ikon.nyil)}</span>
          </a>
          <a class="appCsempe appCsempe--kviz" href="kahoot.html">
            <span class="appCsempe__ikon">${svg(ikon.kviz)}</span>
            <span>
              <span class="appCsempe__cim">Kvízcsata</span>
              <span class="appCsempe__alcim">Szoba a barátaidnak — aki gyorsabb, több pontot kap</span>
            </span>
            <span class="appCsempe__nyil">${svg(ikon.nyil)}</span>
          </a>
          <a class="appCsempe appCsempe--bingo" id="appBingoCsempe" href="bingo.html" hidden>
            <span class="appCsempe__ikon">${svg(ikon.bingo)}</span>
            <span>
              <span class="appCsempe__cim">Rubik-Bingó <span class="appCimke">teszt</span></span>
              <span class="appCsempe__alcim">Pörgess színt, találd el a dalt, rakj ki öt X-et</span>
            </span>
            <span class="appCsempe__nyil">${svg(ikon.nyil)}</span>
          </a>
          <a class="appCsempe appCsempe--szabaly" href="szabalyok.html">
            <span class="appCsempe__ikon">${svg(ikon.szabaly)}</span>
            <span>
              <span class="appCsempe__cim">Szabályok</span>
              <span class="appCsempe__alcim">Négy játékmód, lépésről lépésre</span>
            </span>
            <span class="appCsempe__nyil">${svg(ikon.nyil)}</span>
          </a>
        </div>
        <div class="appVerzio">
          <span id="appVerzioSzam">Asthetic</span>
          <button class="appVerzio__gomb" id="appFrissitesGomb" type="button">Frissítések keresése</button>
        </div>`;
      fo.appendChild(otthon);

      // A telepített verzió és a kézi frissítéskeresés (js/frissites.js).
      const kiir = async () => {
        const f = window.AstheticFrissites;
        if (!f) return;
        const v = await f.verzio().catch(() => null);
        if (v) document.getElementById('appVerzioSzam').textContent = 'Verzió ' + v.versionName;
      };
      if (document.readyState === 'complete') kiir();
      else window.addEventListener('load', kiir, { once: true });

      document.getElementById('appFrissitesGomb').addEventListener('click', async (e) => {
        const gomb = e.currentTarget;
        const f = window.AstheticFrissites;
        if (!f || gomb.disabled) return;
        gomb.disabled = true;
        gomb.textContent = 'Keresés…';
        try { await f.ellenoriz({ kezi: true }); } finally {
          gomb.disabled = false;
          gomb.textContent = 'Frissítések keresése';
        }
      });
    }
  }

  function fiokValtozott() {
    fiokGombFrissit();
    fulekRajzol();
    const csempe = document.getElementById('appBingoCsempe');
    if (csempe) csempe.hidden = !bingoLathato();
  }
  if (Fiok) {
    Fiok.figyel(fiokValtozott);
    fiokValtozott();
    // A mentett bejelentkezés visszaállítása (a Firebase-t ez tölti be).
    Fiok.kesz().then(fiokValtozott);
  }
})();
