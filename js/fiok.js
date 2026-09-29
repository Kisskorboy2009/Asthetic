/* ═══════════════════════════════════════════════════════════════
   ASTHETIC — Google-fiók

   Bejelentkezés Google-fiókkal. Az alkalmazásban a natív Google-bejelentkezés
   (@capacitor-firebase/authentication) adja az azonosító tokent, a Firebase
   webes SDK-ja pedig ezzel lépteti be a felhasználót — így a Firestore-szabályok
   ugyanazt a felhasználót látják, mint a Kvízcsatában. Böngészőben felugró
   ablakos bejelentkezés van.

   A Firebase-t csak akkor tölti be, amikor tényleg kell.
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // Az adminok: ők szerkesztik a dallistát, és ők adják meg, ki játszhat a
  // Rubik-Bingóval (bingo_hozzaferes/{email}). Ugyanez a lista van a
  // firestore.rules-ban is — a kettőnek egyeznie kell, a szerveren az a döntő.
  const ADMINOK = ['kisskorboy1990@gmail.com', 'richardszenti@gmail.com'];

  const FIREBASE_VERZIO = '12.4.0';
  const TAROLO = 'asthetic-fiok';

  const figyelok = new Set();
  let betoltes = null;
  let keszIgeret = null;
  let felhasznalo = mentettBetolt();

  function mentettBetolt() {
    try { return JSON.parse(localStorage.getItem(TAROLO) || 'null'); } catch { return null; }
  }

  function ment(adat) {
    try {
      if (adat) localStorage.setItem(TAROLO, JSON.stringify(adat));
      else localStorage.removeItem(TAROLO);
    } catch { /* privát mód */ }
  }

  const adminE = (email, ellenorzott) => Boolean(email && ellenorzott && ADMINOK.includes(String(email).toLowerCase()));

  /**
   * Van-e a felhasználónak hozzáférése a Rubik-Bingóhoz. Csak a saját
   * dokumentumát kérdezi le (a szabályok mást nem is engednek), a Firestore
   * REST-felületén — így ehhez nem kell a teljes Firestore SDK.
   * Hálózati hibánál az utolsó ismert állapot marad.
   */
  async function bingoHozzaferes(u, korabbi) {
    const email = String(u.email || '').toLowerCase();
    if (adminE(email, u.emailVerified)) return true;
    if (!email || !u.emailVerified) return false;
    try {
      const token = await u.getIdToken();
      const alap = window.ASTHETIC.emulator ? 'http://127.0.0.1:8080' : 'https://firestore.googleapis.com';
      const projekt = window.ASTHETIC.firebaseBeallitas.projectId;
      const v = await fetch(`${alap}/v1/projects/${projekt}/databases/(default)/documents/bingo_hozzaferes/${encodeURIComponent(email)}`,
        { headers: { Authorization: 'Bearer ' + token } });
      if (v.ok) return true;
      if (v.status === 403 || v.status === 404) return false;
      return korabbi;
    } catch { return korabbi; }
  }

  function szkript(src) {
    return new Promise((kesz, hiba) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = kesz;
      s.onerror = () => hiba(new Error('Nem sikerült betölteni: ' + src));
      document.head.appendChild(s);
    });
  }

  async function firebaseBetolt() {
    if (!betoltes) {
      betoltes = (async () => {
        const alap = `https://www.gstatic.com/firebasejs/${FIREBASE_VERZIO}/`;
        if (!window.firebase) await szkript(alap + 'firebase-app-compat.js');
        if (!window.firebase.auth) await szkript(alap + 'firebase-auth-compat.js');
        const fb = window.ASTHETIC.firebaseIndit();
        fb.auth().onAuthStateChanged(allapotValtozott);
        return fb;
      })();
      betoltes.catch(() => { betoltes = null; });
    }
    return betoltes;
  }

  let elsoJelzes = null;
  let elsoMegjott = false;
  let valtozasSorszam = 0;

  async function allapotValtozott(u) {
    const sorszam = ++valtozasSorszam;
    if (u && !u.isAnonymous) {
      const korabbi = Boolean(felhasznalo && felhasznalo.uid === u.uid && felhasznalo.engedett);
      const engedett = await bingoHozzaferes(u, korabbi);
      if (sorszam !== valtozasSorszam) return;   // közben újabb állapot jött
      felhasznalo = {
        uid: u.uid,
        email: u.email,
        nev: u.displayName || u.email,
        kep: u.photoURL || null,
        admin: adminE(u.email, u.emailVerified),
        engedett,
      };
    } else {
      felhasznalo = null;
    }
    ment(felhasznalo);
    elsoMegjott = true;
    if (elsoJelzes) { elsoJelzes(); elsoJelzes = null; }
    figyelok.forEach((f) => { try { f(felhasznalo); } catch { /* egy hibás figyelő ne állítsa meg a többit */ } });
  }

  /** Megvárja, amíg a Firebase visszaállítja a mentett bejelentkezést (és a hozzáférést). */
  function kesz() {
    if (!keszIgeret) {
      keszIgeret = elsoMegjott ? Promise.resolve() : new Promise((vege) => { elsoJelzes = vege; });
      firebaseBetolt().catch(() => { if (elsoJelzes) { elsoJelzes(); elsoJelzes = null; } });
    }
    return keszIgeret;
  }

  function natívPlugin() {
    const reg = (window.capacitorExports && window.capacitorExports.registerPlugin)
      || (window.Capacitor && window.Capacitor.registerPlugin);
    if (!reg) throw new Error('A bejelentkezés ebben a verzióban nem érhető el.');
    return reg('FirebaseAuthentication');
  }

  /**
   * Csak az számít megszakításnak, ha a felhasználó maga zárta be a
   * fiókválasztót. A Google a beállítási hibákat is „megszakítva” (16-os)
   * kóddal adja vissza — azokat meg kell mutatni, különben a gomb csak
   * elhalványul, és nem derül ki, mi a baj.
   */
  function megszakitottaE(hiba) {
    const s = hibaSzoveg(hiba);
    return /cancel+ed by the user|popup-closed-by-user|cancelled-popup-request|12501/i.test(s);
  }

  function hibaSzoveg(hiba) {
    if (!hiba) return 'ismeretlen hiba';
    const reszek = [hiba.code, hiba.message].filter(Boolean).map(String);
    return reszek.length ? [...new Set(reszek)].join(': ') : String(hiba);
  }

  function idokorlat(igeret, ms, uzenet) {
    let idozito;
    return Promise.race([
      igeret,
      new Promise((_, hiba) => { idozito = setTimeout(() => hiba(new Error(uzenet)), ms); }),
    ]).finally(() => clearTimeout(idozito));
  }

  /**
   * A klasszikus Google-fiókválasztóval kezdünk: az újabb felület (Credential
   * Manager) a teszttelefonon válasz nélkül lógva maradt, és csak az időkorlát
   * után jött a klasszikus — ezért kellett sokat várni. Az újat már csak
   * tartaléknak használjuk, ha a klasszikus hibát ad.
   */
  async function natívGoogleToken(jelez) {
    const plugin = natívPlugin();
    let elsoHiba;
    try {
      jelez('Google-fiókválasztó megnyitása…');
      return await idokorlat(
        plugin.signInWithGoogle({ skipNativeAuth: true, useCredentialManager: false }),
        120000,
        'A Google-fiókválasztó nem válaszolt.',
      );
    } catch (hiba) {
      if (megszakitottaE(hiba)) throw hiba;
      elsoHiba = hiba;
      console.warn('Google-bejelentkezés (klasszikus):', hibaSzoveg(hiba));
    }
    try {
      jelez('Első próba: ' + hibaSzoveg(elsoHiba) + ' — újrapróbálom…');
      return await idokorlat(plugin.signInWithGoogle({ skipNativeAuth: true }), 20000,
        'az új Google-felület sem válaszolt');
    } catch (hiba) {
      if (megszakitottaE(hiba)) throw hiba;
      throw new Error(hibaSzoveg(elsoHiba) + ' (majd: ' + hibaSzoveg(hiba) + ')');
    }
  }

  /** @param jelez  (szöveg) => void — a lépések kiírásához, hogy látszódjon, hol tart */
  async function bejelentkezes(jelez = () => {}) {
    jelez('Firebase betöltése…');
    const fb = await idokorlat(firebaseBetolt(), 20000, 'A Firebase nem töltődött be (nincs internet?).');
    try {
      if (window.ASTHETIC && window.ASTHETIC.natív) {
        const eredmeny = await natívGoogleToken(jelez);
        const idToken = eredmeny && eredmeny.credential && eredmeny.credential.idToken;
        if (!idToken) throw new Error('A Google nem adott vissza azonosítót.');
        jelez('Belépés…');
        await idokorlat(fb.auth().signInWithCredential(fb.auth.GoogleAuthProvider.credential(idToken)), 20000,
          'A Firebase nem válaszolt a belépésre.');
      } else {
        jelez('Google-bejelentkezés…');
        try {
          await fb.auth().signInWithPopup(new fb.auth.GoogleAuthProvider());
        } catch (hiba) {
          // Ha a böngésző letiltja a felugró ablakot (sok mobilböngésző),
          // átirányítással jelentkezünk be; visszatéréskor a Firebase maga
          // állítja vissza a felhasználót.
          if (!/popup-blocked|operation-not-supported/.test(String(hiba && hiba.code))) throw hiba;
          await fb.auth().signInWithRedirect(new fb.auth.GoogleAuthProvider());
        }
      }
    } catch (hiba) {
      if (megszakitottaE(hiba)) return null;
      throw hiba;
    }
    return felhasznalo;
  }

  async function kijelentkezes() {
    const fb = await firebaseBetolt();
    await fb.auth().signOut();
    if (window.ASTHETIC && window.ASTHETIC.natív) {
      try { await natívPlugin().signOut(); } catch { /* a natív oldalon nem volt bejelentkezés */ }
    }
  }

  function figyel(f) {
    figyelok.add(f);
    return () => figyelok.delete(f);
  }

  window.AstheticFiok = {
    ADMINOK,
    kesz,
    bejelentkezes,
    kijelentkezes,
    figyel,
    firebase: firebaseBetolt,
    /** Az utolsó ismert állapot — a Firebase betöltése előtt a mentett. */
    get felhasznalo() { return felhasznalo; },
    get engedett() { return Boolean(felhasznalo && felhasznalo.engedett); },
    /** Admin: a dallistát és a bingó-hozzáférést szerkesztheti (admin.html). */
    get admin() { return Boolean(felhasznalo && felhasznalo.admin); },
  };

  /* ───────────── fiókgomb a weboldal fejlécében ─────────────
     Az alkalmazásban a js/app-shell.js rakja ki a sajátját. */

  const szoveg = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const IKON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8.5" r="3.6"/><path d="M5 20c.9-3.6 3.7-5.4 7-5.4s6.1 1.8 7 5.4"/></svg>';

  function webesFiokgomb() {
    if (document.documentElement.classList.contains('is-app')) return;
    const hely = document.querySelector('.nav__cta');
    if (!hely) return;

    const doboz = document.createElement('div');
    doboz.className = 'fiok';
    doboz.innerHTML = `<button class="fiok__gomb" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Fiók"></button>
      <div class="fiok__menu" hidden></div>`;
    hely.insertBefore(doboz, hely.firstChild);
    const gomb = doboz.querySelector('.fiok__gomb');
    const menu = doboz.querySelector('.fiok__menu');

    function rajzol() {
      const f = felhasznalo;
      gomb.classList.toggle('is-be', Boolean(f));
      gomb.innerHTML = IKON + (f && f.kep
        ? `<img src="${szoveg(f.kep)}" alt="" referrerpolicy="no-referrer" onerror="this.remove()">`
        : '');
      menu.innerHTML = f
        ? `<div class="fiok__nev">${szoveg(f.nev)}</div>
           <div class="fiok__email">${szoveg(f.email)}</div>
           ${f.admin ? '<a class="fiok__link" href="admin.html">Admin: dallista és hozzáférés</a>' : ''}
           <button class="btn btn--ghost btn--sm" type="button" data-muvelet="ki">Kijelentkezés</button>`
        : `<div class="fiok__nev">Bejelentkezés</div>
           <p class="fiok__le">Google-fiókkal a neveddel és a profilképeddel játszhatsz.</p>
           <button class="btn btn--accent btn--sm" type="button" data-muvelet="be">Bejelentkezés Google-fiókkal</button>
           <p class="fiok__hiba" hidden></p>`;
      const muvelet = menu.querySelector('[data-muvelet]');
      muvelet.addEventListener('click', async () => {
        muvelet.disabled = true;
        const hiba = menu.querySelector('.fiok__hiba');
        try {
          if (muvelet.dataset.muvelet === 'ki') await kijelentkezes();
          else await bejelentkezes();
          nyit(false);
        } catch (e) {
          if (hiba) { hiba.hidden = false; hiba.textContent = 'Nem sikerült: ' + hibaSzoveg(e); }
          muvelet.disabled = false;
        }
      });
    }

    function nyit(nyitva) {
      menu.hidden = !nyitva;
      gomb.setAttribute('aria-expanded', String(nyitva));
    }

    gomb.addEventListener('click', (e) => { e.stopPropagation(); nyit(menu.hidden); });
    document.addEventListener('click', (e) => { if (!doboz.contains(e.target)) nyit(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') nyit(false); });

    rajzol();
    figyel(rajzol);
    // Ha korábban be volt jelentkezve, ellenőrizzük, hogy még érvényes-e.
    if (felhasznalo) kesz();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', webesFiokgomb);
  else webesFiokgomb();
})();
