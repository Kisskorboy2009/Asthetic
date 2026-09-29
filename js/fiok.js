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

  // A zárt teszt résztvevői. Ugyanez a lista van a firestore.rules-ban is —
  // a kettőnek egyeznie kell, mert a szerver oldalon az a döntő.
  const TESZTELOK = ['kisskorboy1990@gmail.com', 'richardszenti@gmail.com'];

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

  function engedettE(email, ellenorzott) {
    return Boolean(email && ellenorzott !== false && TESZTELOK.includes(String(email).toLowerCase()));
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
  function allapotValtozott(u) {
    felhasznalo = u && !u.isAnonymous
      ? {
          uid: u.uid,
          email: u.email,
          nev: u.displayName || u.email,
          kep: u.photoURL || null,
          engedett: engedettE(u.email, u.emailVerified),
        }
      : null;
    ment(felhasznalo);
    if (elsoJelzes) { elsoJelzes(); elsoJelzes = null; }
    figyelok.forEach((f) => { try { f(felhasznalo); } catch { /* egy hibás figyelő ne állítsa meg a többit */ } });
  }

  /** Megvárja, amíg a Firebase visszaállítja a mentett bejelentkezést. */
  function kesz() {
    if (!keszIgeret) {
      keszIgeret = new Promise((vege) => { elsoJelzes = vege; });
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

  function megszakitottaE(hiba) {
    const s = String((hiba && (hiba.code || hiba.message)) || hiba || '');
    return /cancel|megszak|popup-closed|user.?closed|16:/i.test(s);
  }

  async function bejelentkezes() {
    const fb = await firebaseBetolt();
    try {
      if (window.ASTHETIC && window.ASTHETIC.natív) {
        const eredmeny = await natívPlugin().signInWithGoogle({ skipNativeAuth: true });
        const idToken = eredmeny && eredmeny.credential && eredmeny.credential.idToken;
        if (!idToken) throw new Error('A Google nem adott vissza azonosítót.');
        await fb.auth().signInWithCredential(fb.auth.GoogleAuthProvider.credential(idToken));
      } else {
        await fb.auth().signInWithPopup(new fb.auth.GoogleAuthProvider());
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
    TESZTELOK,
    kesz,
    bejelentkezes,
    kijelentkezes,
    figyel,
    firebase: firebaseBetolt,
    /** Az utolsó ismert állapot — a Firebase betöltése előtt a mentett. */
    get felhasznalo() { return felhasznalo; },
    get engedett() { return Boolean(felhasznalo && felhasznalo.engedett); },
  };
})();
