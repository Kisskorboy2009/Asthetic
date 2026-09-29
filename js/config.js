/* ═══════════════════════════════════════════════════════════════
   ASTHETIC — futási környezet felismerése

   Két dolgot állapít meg, és minden más oldal ebből dolgozik:

     ASTHETIC.natív   — az Android alkalmazásban futunk-e (Capacitor), vagy
                        böngészőben. Ettől függ a Bluetooth módja és az, hogy
                        alkalmazás-külsőt kap-e az oldal.
     ASTHETIC.szerver — a Kvízcsata saját kiszolgálójának címe. Üresen relatív
                        hívásokat használunk (ez a helyzet a weboldalon, ha a
                        server.js szolgálja ki). Ha nincs ilyen kiszolgáló, a
                        játék magától Firestore-ra vált, tehát ezt sehol nem
                        kötelező megadni.
   ═══════════════════════════════════════════════════════════════ */

(function () {
  // Csak akkor kell kitölteni, ha saját kiszolgálón futtatod a Kvízcsatát
  // (kahoot-server.js). Üresen hagyva a Firestore veszi át a szerepét.
  const ALAP_SZERVER = '';

  let mentett = '';
  try {
    mentett = localStorage.getItem('asthetic-szerver') || '';
  } catch { /* privát mód: marad az alapértelmezés */ }

  window.ASTHETIC = window.ASTHETIC || {};
  window.ASTHETIC.szerver = (mentett || ALAP_SZERVER).trim().replace(/\/+$/, '');

  // A Capacitor natív hídja mindig kiteszi a window.Capacitor objektumot, még
  // mielőtt a mi szkriptjeink lefutnának — ez a megbízható forrás. A böngészőbe
  // töltött capacitorExports csak tartalék.
  function natívE() {
    try {
      if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function') {
        return window.Capacitor.isNativePlatform();
      }
      const cap = window.capacitorExports && window.capacitorExports.Capacitor;
      return !!(cap && cap.isNativePlatform && cap.isNativePlatform());
    } catch { return false; }
  }

  window.ASTHETIC.natív = natívE();

  window.ASTHETIC.firebaseBeallitas = {
    apiKey: 'AIzaSyBiBhnlOmE8Fyw5s_PxGVzTesqITWfZkSg',
    authDomain: 'asthetic-798d1.firebaseapp.com',
    projectId: 'asthetic-798d1',
    storageBucket: 'asthetic-798d1.firebasestorage.app',
    messagingSenderId: '494747985041',
    appId: '1:494747985041:web:b011d8790b5cd2511acb30',
  };

  // Helyi fejlesztéshez: a Firebase-emulátorokra kapcsol, ha a gépen
  // localStorage-ben be van állítva az `asthetic-emulator` kulcs.
  function emulatorE() {
    try {
      return /^(localhost|127\.0\.0\.1)$/.test(location.hostname)
        && localStorage.getItem('asthetic-emulator') === '1';
    } catch { return false; }
  }

  window.ASTHETIC.emulator = emulatorE();

  /** Egyszer inicializálja a Firebase-t; minden oldal ezen keresztül éri el. */
  window.ASTHETIC.firebaseIndit = function () {
    const fb = window.firebase;
    if (!fb) throw new Error('A Firebase nem töltődött be.');
    if (!fb.apps.length) {
      fb.initializeApp(window.ASTHETIC.firebaseBeallitas);
      // Az Android WebView-ban a Firestore streamelő kapcsolata gyakran nem
      // jön létre; ezt a beállítást az első Firestore-hívás előtt kell megadni,
      // ezért itt, bárki is indítja elsőként a Firebase-t.
      if (fb.firestore) {
        try { fb.firestore().settings({ experimentalAutoDetectLongPolling: true, merge: true }); } catch { /* már fut */ }
      }
      if (emulatorE()) {
        fb.auth().useEmulator('http://127.0.0.1:9099', { disableWarnings: true });
        if (fb.firestore) fb.firestore().useEmulator('127.0.0.1', 8080);
      }
    }
    return fb;
  };

  // Az alkalmazásban a lap a telefonon belülről töltődik be — a böngészős
  // fejléc, lábléc és a görgethető weboldal-érzet ott idegen. Ezt az osztályt
  // a css/app.css használja, hogy alkalmazás-külsőt adjon a felületnek.
  if (window.ASTHETIC.natív) document.documentElement.classList.add('is-app');
})();
