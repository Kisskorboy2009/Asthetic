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
    nyil: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
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
    'szabalyok.html': { cim: 'Szabályok', ful: null },
    'adatvedelem.html': { cim: 'Adatvédelem', ful: null },
    'feltetelek.html': { cim: 'Felhasználási feltételek', ful: null },
    '404.html': { cim: 'Nincs ilyen oldal', ful: null },
  };

  const fajl = location.pathname.split('/').pop() || 'index.html';
  const oldal = OLDALAK[fajl] || { cim: 'Asthetic', ful: null };

  /* ───────────── felső sáv ───────────── */

  const sav = document.createElement('div');
  sav.className = 'appSav';
  sav.innerHTML = `
    <button class="appSav__gomb" id="appVissza" type="button" aria-label="Vissza" ${oldal.gyoker ? 'hidden' : ''}>${svg(ikon.vissza)}</button>
    <span class="appSav__cim">${oldal.cim}</span>
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

  /* ───────────── alsó fülsor ───────────── */

  const fulek = [
    { azon: 'kartya', cim: 'Kártya', hivatkozas: 'jatek.html', ikon: ikon.kartya },
    { azon: 'kviz', cim: 'Kvízcsata', hivatkozas: 'kahoot.html', ikon: ikon.kviz },
    { azon: 'kezdo', cim: 'Kezdőlap', hivatkozas: 'index.html', ikon: ikon.szabaly },
  ];

  const fulSor = document.createElement('nav');
  fulSor.className = 'appFulek';
  fulSor.setAttribute('aria-label', 'Alkalmazás menü');
  fulSor.innerHTML = fulek
    .map((f) => `<a class="appFul${oldal.ful === f.azon ? ' is-aktiv' : ''}" href="${f.hivatkozas}">
        ${svg(f.ikon)}<span>${f.cim}</span>
      </a>`)
    .join('');
  document.body.appendChild(fulSor);

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
          <a class="appCsempe appCsempe--szabaly" href="szabalyok.html">
            <span class="appCsempe__ikon">${svg(ikon.szabaly)}</span>
            <span>
              <span class="appCsempe__cim">Szabályok</span>
              <span class="appCsempe__alcim">Négy játékmód, lépésről lépésre</span>
            </span>
            <span class="appCsempe__nyil">${svg(ikon.nyil)}</span>
          </a>
        </div>`;
      fo.appendChild(otthon);
    }
  }
})();
