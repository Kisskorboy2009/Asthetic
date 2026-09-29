// Az alkalmazás önfrissítése
//
// Csak az Android alkalmazásban működik (böngészőben azonnal kilép).
//
// Induláskor megnézi a GitHubon a legfrissebb kiadást. A kiadást a GitHub
// Actions készíti minden feltöltésnél (.github/workflows/android.yml), a címkéje
// "v1.<versionCode>". Ha az újabb a telepítettnél, felajánlja a frissítést: a
// natív AstheticFrissito bővítmény letölti az APK-t, és átadja a rendszer
// telepítőjének – a telepítést a felhasználó hagyja jóvá.
//
// Kívülről: AstheticFrissites.ellenoriz({ kezi: true }) – kézi keresés
//           AstheticFrissites.verzio()                 – a telepített verzió

(function () {
  'use strict';

  const REPO = 'Kisskorboy2009/Asthetic';
  const API = `https://api.github.com/repos/${REPO}/releases/latest`;
  const KIADASOK = `https://github.com/${REPO}/releases/latest`;

  const UTOLSO_KERESES = 'asthetic-frissites-kereses';
  const ELHALASZTVA = 'asthetic-frissites-kesobb';
  const KERESESI_KOZ_MS = 3 * 60 * 60 * 1000;     // magától legfeljebb 3 óránként
  const HALASZTAS_MS = 20 * 60 * 60 * 1000;        // a "Később" egy napra szól

  const natív = Boolean(window.ASTHETIC && window.ASTHETIC.natív);

  function bovitmeny() {
    const reg = (window.capacitorExports && window.capacitorExports.registerPlugin)
      || (window.Capacitor && window.Capacitor.registerPlugin);
    if (!reg) return null;
    if (!bovitmeny.peldany) bovitmeny.peldany = reg('AstheticFrissito');
    return bovitmeny.peldany;
  }

  function olvas(kulcs) { try { return localStorage.getItem(kulcs); } catch { return null; } }
  function ir(kulcs, ertek) { try { localStorage.setItem(kulcs, ertek); } catch { /* privát mód */ } }

  let telepitett = null;   // { versionCode, versionName, telepithet }

  async function verzio() {
    if (!natív) return null;
    if (telepitett) return telepitett;
    const b = bovitmeny();
    if (!b) return null;
    try {
      telepitett = await b.info();
    } catch {
      telepitett = null;
    }
    return telepitett;
  }

  /** A legfrissebb kiadás a GitHubról. A címke "v1.<versionCode>". */
  async function legfrissebb() {
    const valasz = await fetch(API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!valasz.ok) throw new Error('A frissítések most nem érhetők el.');
    const kiadas = await valasz.json();
    const talalat = /^v(\d+)\.(\d+)$/.exec(String(kiadas.tag_name || ''));
    const apk = (kiadas.assets || []).find((a) => a.name === 'asthetic.apk');
    if (!talalat || !apk) throw new Error('A legfrissebb kiadásban nincs alkalmazás.');
    return {
      versionCode: Number(talalat[2]),
      versionName: talalat[1] + '.' + talalat[2],
      apkUrl: apk.browser_download_url,
      meret: apk.size,
      datum: kiadas.published_at,
      valtozasok: String(kiadas.body || '')
        .split('\n')
        .map((s) => s.replace(/^\s*[-*]\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 8),
    };
  }

  /**
   * @param {{kezi?: boolean}} opciok  kézi keresésnél akkor is szól, ha nincs újabb
   * @returns {Promise<'uj'|'naprakesz'|'hiba'|null>}
   */
  async function ellenoriz(opciok) {
    const kezi = Boolean(opciok && opciok.kezi);
    if (!natív) return null;

    if (!kezi) {
      const utolso = Number(olvas(UTOLSO_KERESES) || 0);
      if (Date.now() - utolso < KERESESI_KOZ_MS) return null;
    }

    const sajat = await verzio();
    if (!sajat) {
      if (kezi) uzenet('Ebben a verzióban még nincs önfrissítés – töltsd le az újat az asthetic.hu oldalról.');
      return 'hiba';
    }

    let uj;
    try {
      uj = await legfrissebb();
    } catch (e) {
      if (kezi) uzenet(e.message || 'A frissítések most nem érhetők el.');
      return 'hiba';
    }
    ir(UTOLSO_KERESES, String(Date.now()));

    if (uj.versionCode <= Number(sajat.versionCode)) {
      if (kezi) uzenet(`Naprakész vagy – ez a legfrissebb verzió (${sajat.versionName}).`);
      return 'naprakesz';
    }

    if (!kezi) {
      const halasztas = JSON.parse(olvas(ELHALASZTVA) || 'null');
      if (halasztas && halasztas.kod === uj.versionCode && Date.now() - halasztas.mikor < HALASZTAS_MS) return 'uj';
    }

    ablakMutat(sajat, uj);
    return 'uj';
  }

  // felület

  function szoveg(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
  }

  function uzenet(szovegTartalom) {
    const el = document.createElement('div');
    el.className = 'frissUzenet';
    el.setAttribute('role', 'status');
    el.textContent = szovegTartalom;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-be'));
    setTimeout(() => {
      el.classList.remove('is-be');
      setTimeout(() => el.remove(), 400);
    }, 3200);
  }

  function ablakMutat(sajat, uj) {
    if (document.getElementById('frissAblak')) return;

    const mb = uj.meret ? ` · ${(uj.meret / 1048576).toFixed(1).replace('.', ',')} MB` : '';
    const ablak = document.createElement('div');
    ablak.className = 'frissAblak';
    ablak.id = 'frissAblak';
    ablak.setAttribute('role', 'dialog');
    ablak.setAttribute('aria-modal', 'true');
    ablak.setAttribute('aria-labelledby', 'frissCim');
    ablak.innerHTML = `
      <div class="frissAblak__panel">
        <div class="frissAblak__jel" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>
        </div>
        <h2 class="frissAblak__cim" id="frissCim">Új verzió érhető el</h2>
        <p class="frissAblak__verzio">${szoveg(sajat.versionName)} → <b>${szoveg(uj.versionName)}</b>${mb}</p>
        ${uj.valtozasok.length ? `<ul class="frissAblak__lista">${uj.valtozasok.map((v) => `<li>${szoveg(v)}</li>`).join('')}</ul>` : ''}
        <div class="frissAblak__sav" hidden><div class="frissAblak__savBelso"></div></div>
        <p class="frissAblak__allapot" role="status"></p>
        <div class="frissAblak__gombok">
          <button class="btn btn--accent btn--lg" type="button" data-muvelet="frissit">Frissítés most</button>
          <button class="btn btn--ghost" type="button" data-muvelet="kesobb">Később</button>
        </div>
      </div>`;
    document.body.appendChild(ablak);
    requestAnimationFrame(() => ablak.classList.add('is-be'));

    const frissitGomb = ablak.querySelector('[data-muvelet="frissit"]');
    const kesobbGomb = ablak.querySelector('[data-muvelet="kesobb"]');
    const sav = ablak.querySelector('.frissAblak__sav');
    const savBelso = ablak.querySelector('.frissAblak__savBelso');
    const allapot = ablak.querySelector('.frissAblak__allapot');

    const bezar = () => {
      ablak.classList.remove('is-be');
      setTimeout(() => ablak.remove(), 350);
    };

    kesobbGomb.addEventListener('click', () => {
      ir(ELHALASZTVA, JSON.stringify({ kod: uj.versionCode, mikor: Date.now() }));
      bezar();
    });

    let letoltve = false;
    let figyelo = null;

    frissitGomb.addEventListener('click', async () => {
      const b = bovitmeny();
      if (!b) return;

      // Már letöltöttük (pl. a telepítőt visszaléptetve bezárták): csak újraindítjuk.
      if (letoltve) { telepit(b); return; }

      frissitGomb.disabled = true;
      kesobbGomb.disabled = true;
      sav.hidden = false;
      savBelso.style.width = '0%';
      allapot.textContent = 'Letöltés…';

      try {
        figyelo = await b.addListener('letoltes', (e) => {
          savBelso.style.width = e.szazalek + '%';
          allapot.textContent = `Letöltés… ${e.szazalek}%`;
        });
        await b.letolt({ url: uj.apkUrl });
        letoltve = true;
        savBelso.style.width = '100%';
        await telepit(b);
      } catch (e) {
        sav.hidden = true;
        allapot.innerHTML = `A letöltés nem sikerült${e && e.message ? ': ' + szoveg(e.message) : ''}. `
          + '<button class="frissAblak__link" type="button">Letöltés böngészőben</button>';
        allapot.querySelector('button').addEventListener('click', () => {
          b.megnyit({ url: uj.apkUrl }).catch(() => b.megnyit({ url: KIADASOK }).catch(() => {}));
        });
        frissitGomb.disabled = false;
        frissitGomb.textContent = 'Újrapróbálom';
        kesobbGomb.disabled = false;
      } finally {
        if (figyelo) { try { figyelo.remove(); } catch { /* mindegy */ } figyelo = null; }
      }
    });

    async function telepit(b) {
      allapot.textContent = telepitett && telepitett.telepithet === false
        ? 'Az Android most megkérdezi, engedélyezed-e a telepítést az Asthetic-ből – kapcsold be, majd lépj vissza.'
        : 'Megnyílik a telepítő – koppints a „Frissítés” gombra.';
      try {
        await b.telepit();
      } catch (e) {
        allapot.textContent = e && e.message ? e.message : 'A telepítő nem indult el.';
      }
      frissitGomb.disabled = false;
      frissitGomb.textContent = 'Telepítés';
      kesobbGomb.disabled = false;
    }
  }

  window.AstheticFrissites = { ellenoriz, verzio, legfrissebb };

  // Induláskor – kicsit később, hogy ne lassítsa az első képet.
  if (natív) {
    const indit = () => setTimeout(() => { ellenoriz().catch(() => {}); }, 1500);
    if (document.readyState === 'complete') indit();
    else window.addEventListener('load', indit, { once: true });
  }
})();
