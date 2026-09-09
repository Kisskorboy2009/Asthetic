/* ═══════════════════════════════════════════════════════════════
   ASTHETIC — kiszolgáló címe a Kahoot-módhoz
   ═══════════════════════════════════════════════════════════════

   A Kahoot-mód szobái közös kiszolgálón élnek (kahoot-server.js). Ez böngészőben
   ugyanaz a gép, ahonnan az oldalt megnyitottad, ezért ott üres a cím: a relatív
   /api/... hívások jó helyre mennek.

   Az Android alkalmazásban viszont a lapok a telefonon belülről töltődnek be
   (https://localhost), ott nincs /api, ezért teljes címet kell megadni.
   Sorrend, ahogy a beállítást keressük:

     1. amit a felhasználó beírt a játékban  (localStorage: "asthetic-szerver")
     2. az ASTHETIC_ALAP_SZERVER alább       (ide kerül majd a saját domain)
     3. semmi -> relatív hívások (weboldal)                                    */

(function () {
  // Ide írd be a saját kiszolgálód címét, ha van (pl. "https://asthetic.hu").
  // Amíg üres, az alkalmazásban a játékos maga adhatja meg.
  const ASTHETIC_ALAP_SZERVER = '';

  let mentett = '';
  try {
    mentett = localStorage.getItem('asthetic-szerver') || '';
  } catch { /* privát mód: marad az alapértelmezés */ }

  const cim = (mentett || ASTHETIC_ALAP_SZERVER).trim().replace(/\/+$/, '');

  window.ASTHETIC = window.ASTHETIC || {};
  window.ASTHETIC.szerver = cim;

  // Natív alkalmazásban fut-e? (Capacitor betöltve és nem böngésző)
  window.ASTHETIC.natív = !!(
    window.capacitorExports &&
    window.capacitorExports.Capacitor &&
    window.capacitorExports.Capacitor.isNativePlatform()
  );

  // Az alkalmazásban kötelező a cím, különben nincs mihez csatlakozni.
  window.ASTHETIC.szerverKell = window.ASTHETIC.natív && !cim;

  window.ASTHETIC.szerverMent = function (ujCim) {
    const tiszta = String(ujCim || '').trim().replace(/\/+$/, '');
    try { localStorage.setItem('asthetic-szerver', tiszta); } catch { /* nem baj */ }
    window.ASTHETIC.szerver = tiszta;
    window.ASTHETIC.szerverKell = window.ASTHETIC.natív && !tiszta;
  };
})();
