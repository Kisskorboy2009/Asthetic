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

  // Az alkalmazásban a lap a telefonon belülről töltődik be — a böngészős
  // fejléc, lábléc és a görgethető weboldal-érzet ott idegen. Ezt az osztályt
  // a css/app.css használja, hogy alkalmazás-külsőt adjon a felületnek.
  if (window.ASTHETIC.natív) document.documentElement.classList.add('is-app');
})();
