/* ═══════════════════════════════════════════════════════════════
   ASTHETIC GAME — a játék logikája
   QR → YouTube (45. mp-től, max 30 mp) + fizikai Bluetooth-gomb
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const START_SECOND = 45;      // innen indul a dal
const MAX_PLAY_MS  = 30000;   // ennyi ideig szólhat egy kártya
const RING_LENGTH  = 540.35;  // 2 * PI * 86 — a gyűrű kerülete

// Nordic UART Service — ugyanezek az azonosítók vannak az ESP32 firmware-ben
const NUS_SERVICE = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_TX_CHAR = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';
// A gomb felé menő irány: ezen küldjük vissza a valós lejátszási állapotot,
// hogy a gomb LED-je csak akkor világítson, amikor tényleg szól a zene.
const NUS_RX_CHAR = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';

const RING_COLORS = { calm: '#EDEAE4', warn: '#D9A05B', last: '#C4573D' };

const $ = (id) => document.getElementById(id);

/* ───────────── Értesítések ───────────── */

function toast(message, kind = '') {
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ` toast--${kind}` : '');
  el.textContent = message;
  $('toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('is-out');
    el.addEventListener('animationend', () => el.remove(), { once: true });
  }, 3400);
}

/* ───────────── Nézetváltás a színpadon ───────────── */

let currentView = 'home';

function showView(name) {
  if (name === currentView) return;
  if (currentView === 'scan') stopScanner();
  document.querySelectorAll('.gview').forEach((v) => v.classList.remove('is-active'));
  $(`gv-${name}`).classList.add('is-active');
  currentView = name;
}

/* ═══════════════════════════════════════════
   YouTube lejátszó
   ═══════════════════════════════════════════ */

let player = null;
let playerReady = false;
let pendingVideoId = null;

const ytTag = document.createElement('script');
ytTag.src = 'https://www.youtube.com/iframe_api';
document.head.appendChild(ytTag);

window.onYouTubeIframeAPIReady = () => {
  if (pendingVideoId) createPlayer(pendingVideoId);
};

function createPlayer(videoId) {
  if (!window.YT || !window.YT.Player) {
    pendingVideoId = videoId;
    return;
  }
  player = new YT.Player('ytFrame', {
    videoId,
    // Adatvédelmi módú beágyazás: a YouTube csak a tényleges lejátszáskor tárol adatot
    host: 'https://www.youtube-nocookie.com',
    playerVars: {
      autoplay: 1, start: START_SECOND, controls: 0, disablekb: 1,
      modestbranding: 1, rel: 0, playsinline: 1, fs: 0, iv_load_policy: 3,
    },
    events: {
      onReady: () => { playerReady = true; player.playVideo(); watchForAutoplayBlock(); },
      onStateChange: onPlayerStateChange,
      onError: () => {
        setState('done', 'Ez a videó nem játszható le');
        toast('A videó nem elérhető, vagy a beágyazása tiltott.', 'bad');
      },
    },
  });
}

function loadVideo(videoId) {
  resetCountdown();
  showView('play');
  setState('idle', 'Betöltés…');
  $('screen').classList.remove('is-revealed');
  $('revealBtn').textContent = 'Videó felfedése';

  if (!player || !playerReady) {
    pendingVideoId = videoId;
    createPlayer(videoId);
  } else {
    player.loadVideoById({ videoId, startSeconds: START_SECOND });
    watchForAutoplayBlock();
  }
}

function onPlayerStateChange(event) {
  if (event.data === YT.PlayerState.PLAYING) {
    $('tapToPlay').hidden = true;
    // Csak az első induláskor indítjuk a visszaszámlálást. A folytatást mindig a
    // resumePlayback() vezérli, a lejárt kártyát pedig azonnal elnémítjuk: a YouTube
    // néha késve küld PLAYING eseményt, ami különben újraindítaná a dalt.
    if (state === 'idle') startCountdown();
    else if (state === 'done') player.pauseVideo();
  } else if (event.data === YT.PlayerState.ENDED) {
    finish('Vége a dalnak');
  }
}

// Ha a böngésző letiltja az automatikus lejátszást, felkínálunk egy koppintást
let autoplayWatchdog = null;
function watchForAutoplayBlock() {
  clearTimeout(autoplayWatchdog);
  autoplayWatchdog = setTimeout(() => {
    if (state !== 'playing') $('tapToPlay').hidden = false;
  }, 1600);
}

/* ═══════════════════════════════════════════
   Visszaszámláló
   ═══════════════════════════════════════════ */

let state = 'idle';           // idle | playing | paused | done
let remainingMs = MAX_PLAY_MS;
let startedAt = 0;
let rafId = null;
let deadlineId = null;

function setState(next, label) {
  state = next;
  const el = $('stateText');
  el.textContent = label;
  el.className = 'gstate' + (
    next === 'playing' ? ' is-live' :
    next === 'paused'  ? ' is-hold' :
    next === 'done'    ? ' is-done' : ''
  );
  document.body.classList.toggle('is-playing', next === 'playing');
  bleAllapotKuld(next === 'playing');

  const isPlaying = next === 'playing';
  $('toggleLabel').textContent = isPlaying ? 'Szünet' : 'Folytatás';
  $('toggleIcon').innerHTML = isPlaying
    ? '<rect x="6" y="5" width="4" height="14" rx="1.2"/><rect x="14" y="5" width="4" height="14" rx="1.2"/>'
    : '<path d="M8 5.2v13.6a1 1 0 0 0 1.53.85l10.2-6.8a1 1 0 0 0 0-1.7L9.53 4.35A1 1 0 0 0 8 5.2Z"/>';
}

function paintRing(leftMs) {
  const ratio = Math.max(0, Math.min(1, leftMs / MAX_PLAY_MS));
  const color = ratio > 0.4 ? RING_COLORS.calm : ratio > 0.15 ? RING_COLORS.warn : RING_COLORS.last;
  const ring = $('ring');
  ring.style.strokeDashoffset = RING_LENGTH * (1 - ratio);
  ring.style.stroke = color;
  $('timeLeft').textContent = Math.ceil(leftMs / 1000);
}

function stopTimers() {
  cancelAnimationFrame(rafId);
  clearTimeout(deadlineId);
}

function resetCountdown() {
  stopTimers();
  remainingMs = MAX_PLAY_MS;
  paintRing(remainingMs);
}

function startCountdown() {
  if (remainingMs <= 0) return;
  startedAt = performance.now();
  setState('playing', 'Szól a zene');
  stopTimers();

  // A gyűrűt képkockánként rajzoljuk, de a 30 mp-es határt egy időzítő vágja el:
  // a requestAnimationFrame háttérbe került fülnél leáll, a setTimeout nem.
  deadlineId = setTimeout(() => { paintRing(0); finish('Letelt a 30 másodperc'); }, remainingMs);

  const tick = () => {
    const left = remainingMs - (performance.now() - startedAt);
    if (left <= 0) { paintRing(0); return; }
    paintRing(left);
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

function pausePlayback(label = 'Megállítva') {
  if (state !== 'playing') return;
  remainingMs = Math.max(0, remainingMs - (performance.now() - startedAt));
  stopTimers();
  if (player && playerReady) player.pauseVideo();
  setState('paused', label);
  paintRing(remainingMs);
}

function resumePlayback() {
  if (!player || !playerReady) return;
  if (remainingMs <= 0) {          // lejárt idő után újraindítjuk a részletet
    remainingMs = MAX_PLAY_MS;
    player.seekTo(START_SECOND, true);
  }
  player.playVideo();
  startCountdown();
}

function finish(label) {
  stopTimers();
  remainingMs = 0;
  if (player && playerReady) player.pauseVideo();
  setState('done', label);
  paintRing(0);
}

// Ezt hívja a fizikai gomb és a képernyőn lévő gomb is
function togglePlayback(fromPhysicalButton = false) {
  if (currentView !== 'play' || !player) {
    if (fromPhysicalButton) toast('Előbb olvass be egy kártyát.', 'warn');
    return;
  }
  if (state === 'playing') {
    pausePlayback(fromPhysicalButton ? 'Gomb megnyomva — megállítva' : 'Megállítva');
  } else {
    resumePlayback();
  }
}

/* ───────────── Fizikai gomb visszajelzése ───────────── */

function flashShock(text) {
  const el = $('shock');
  $('shockText').textContent = text;
  el.classList.remove('is-on');
  void el.offsetWidth;               // az animáció újraindításához
  el.classList.add('is-on');
  if (navigator.vibrate) navigator.vibrate(55);
}

// A gomb három félét küldhet:
//   'stop'   — a nagy gomb: mindig csak megállít
//   'play'   — a kis gomb: mindig csak elindít/folytat
//   'toggle' — régebbi firmware: az állapot alapján váltunk
function onPhysicalButton(parancs = 'toggle') {
  if (currentView !== 'play' || !player) {
    toast('Előbb olvass be egy kártyát.', 'warn');
    return;
  }

  if (parancs === 'stop') {
    if (state !== 'playing') return;   // már áll, nincs mit tenni
    flashShock('STOP');
    pausePlayback('Gomb megnyomva — megállítva');
    return;
  }

  if (parancs === 'play') {
    if (state === 'playing') return;   // már szól, nincs mit tenni
    flashShock('MEHET');
    resumePlayback();
    return;
  }

  flashShock(state === 'playing' ? 'STOP' : 'MEHET');
  togglePlayback(true);
}

/* ═══════════════════════════════════════════
   QR-kód beolvasás
   ═══════════════════════════════════════════ */

let stream = null;
let scanning = false;
let detector = null;
let jsQrLoaded = false;
const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', { willReadFrequently: true });

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function prepareDecoder() {
  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes('qr_code')) {
        detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        return;
      }
    } catch { /* megyünk a tartalékra */ }
  }
  if (!jsQrLoaded) {
    try {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/jsQR/1.4.0/jsQR.js');
      jsQrLoaded = true;
    } catch {
      toast('A QR-olvasó nem tölthető be. Használd a link beillesztését.', 'bad');
    }
  }
}

async function startScanner() {
  showView('scan');
  $('scanHint').textContent = 'Kamera indítása…';
  $('scanHint').classList.remove('is-hit');

  await prepareDecoder();

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1280 } },
      audio: false,
    });
  } catch (err) {
    $('scanHint').textContent = 'A kamera nem érhető el.';
    toast(err && err.name === 'NotAllowedError'
      ? 'Nem engedélyezted a kamera használatát.'
      : 'Nincs elérhető kamera — illeszd be a linket kézzel.', 'bad');
    return;
  }

  const video = $('camera');
  video.srcObject = stream;
  await video.play().catch(() => {});
  $('scanHint').textContent = 'Tartsd a QR-kódot a keretbe…';

  scanning = true;
  requestAnimationFrame(scanLoop);
}

function stopScanner() {
  scanning = false;
  if (stream) {
    stream.getTracks().forEach((t) => t.stop());
    stream = null;
  }
  $('camera').srcObject = null;
}

async function scanLoop() {
  if (!scanning) return;
  const video = $('camera');

  if (video.readyState >= 2 && video.videoWidth) {
    let raw = null;
    try {
      if (detector) {
        const found = await detector.detect(video);
        if (found.length) raw = found[0].rawValue;
      } else if (window.jsQR) {
        const size = 520;
        canvas.width = size; canvas.height = size;
        const side = Math.min(video.videoWidth, video.videoHeight);
        ctx.drawImage(video,
          (video.videoWidth - side) / 2, (video.videoHeight - side) / 2, side, side,
          0, 0, size, size);
        const image = ctx.getImageData(0, 0, size, size);
        const hit = window.jsQR(image.data, size, size, { inversionAttempts: 'dontInvert' });
        if (hit) raw = hit.data;
      }
    } catch { /* egy sikertelen képkocka nem gond */ }

    if (raw) {
      const videoId = extractVideoId(raw);
      if (videoId) {
        $('scanHint').textContent = 'Megvan!';
        $('scanHint').classList.add('is-hit');
        stopScanner();
        setTimeout(() => loadVideo(videoId), 300);
        return;
      }
      $('scanHint').textContent = 'Ez nem YouTube-link…';
    }
  }
  requestAnimationFrame(scanLoop);
}

/* ───────────── Videóazonosító kinyerése ───────────── */

function extractVideoId(text) {
  if (!text) return null;
  const value = String(text).trim();
  if (/^[A-Za-z0-9_-]{11}$/.test(value)) return value;

  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const host = url.hostname.replace(/^www\./, '');
    if (host === 'youtu.be') {
      const id = url.pathname.slice(1).split('/')[0];
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
    }
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = url.searchParams.get('v');
      if (v && /^[A-Za-z0-9_-]{11}$/.test(v)) return v;
      const m = url.pathname.match(/\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{11})/);
      if (m) return m[1];
    }
  } catch { /* nem URL — jöhet a nyers keresés */ }

  const fallback = value.match(/[A-Za-z0-9_-]{11}/);
  return fallback ? fallback[0] : null;
}

/* ═══════════════════════════════════════════
   A fizikai gomb — Bluetooth Low Energy
   ═══════════════════════════════════════════

   Két útvonal, ugyanazzal a felülettel:
     • böngésző        → Web Bluetooth (navigator.bluetooth), Chrome/Edge
     • Android app     → @capacitor-community/bluetooth-le natív bővítmény
   A játék többi része nem tud róla, melyik van érvényben.                     */

// A felhasználó bezárta az eszközválasztót — ez nem hiba, ne kiabáljunk vele,
// és ne is próbálkozzunk helyette másik kereséssel.
function megszakitottaE(err) {
  if (!err) return false;
  const uzenet = String(err.message || err);
  return err.name === 'NotFoundError' || /cancel|megszak|user/i.test(uzenet);
}

// Az alkalmazásban a Capacitor futtatókörnyezete be van töltve és natív módban fut.
function natívE() {
  const cap = window.capacitorExports && window.capacitorExports.Capacitor;
  return !!(cap && cap.isNativePlatform && cap.isNativePlatform());
}

let bleKapcsolat = null;      // { nev, ir(szoveg), bont() }
let bleUtolsoAllapot = null;

function setBtUi(mode, label) {
  $('btDot').dataset.state = mode;
  $('btLabel').textContent = label;
}

// A gombtól jövő üzenet feldolgozása (mindkét útvonalon ez fut le).
function bleUzenet(nyers) {
  const uzenet = String(nyers || '').trim().toUpperCase();
  if (uzenet.includes('TOGGLE'))    onPhysicalButton('toggle');
  else if (uzenet.includes('STOP')) onPhysicalButton('stop');
  else if (uzenet.includes('PLAY')) onPhysicalButton('play');
}

function bleLecsatlakozott() {
  bleKapcsolat = null;
  bleUtolsoAllapot = null;
  setBtUi('off', 'Gomb csatlakoztatása');
  toast('A gomb lecsatlakozott.', 'warn');
}

// Visszaszólunk a gombnak, hogy szól-e a zene — ettől világít a LED-je.
// Régebbi firmware-en nincs RX karakterisztika, olyankor ez csendben kimarad.
function bleAllapotKuld(szol) {
  if (!bleKapcsolat || !bleKapcsolat.ir || szol === bleUtolsoAllapot) return;
  bleUtolsoAllapot = szol;
  Promise.resolve(bleKapcsolat.ir(szol ? 'PLAYING\n' : 'STOPPED\n'))
    .catch(() => { /* a gomb lecsatlakozott — nem baj */ });
}

/* ───────────── böngésző: Web Bluetooth ───────────── */

async function bleCsatlakozWeb() {
  const eszkoz = await navigator.bluetooth.requestDevice({
    filters: [
      { services: [NUS_SERVICE] },
      { namePrefix: 'Hipster' },
      { namePrefix: 'Asthetic' },
    ],
    optionalServices: [NUS_SERVICE],
  });

  eszkoz.addEventListener('gattserverdisconnected', bleLecsatlakozott);

  setBtUi('busy', 'Csatlakozás…');
  const szerver = await eszkoz.gatt.connect();
  const szolgaltatas = await szerver.getPrimaryService(NUS_SERVICE);

  const tx = await szolgaltatas.getCharacteristic(NUS_TX_CHAR);
  await tx.startNotifications();
  tx.addEventListener('characteristicvaluechanged', (e) => {
    bleUzenet(new TextDecoder().decode(e.target.value));
  });

  // Csak az újabb firmware-ben van — a régivel is működjön a csatlakozás.
  let rx = null;
  try { rx = await szolgaltatas.getCharacteristic(NUS_RX_CHAR); } catch { rx = null; }

  return {
    nev: eszkoz.name,
    ir: rx
      ? (szoveg) => {
          const adat = new TextEncoder().encode(szoveg);
          return rx.writeValueWithoutResponse ? rx.writeValueWithoutResponse(adat) : rx.writeValue(adat);
        }
      : null,
    bont: () => { if (eszkoz.gatt.connected) eszkoz.gatt.disconnect(); },
  };
}

/* ───────────── Android app: natív BLE bővítmény ───────────── */

async function bleCsatlakozNatív() {
  const ble = window.capacitorCommunityBluetoothLe;
  const { BleClient, dataViewToText, textToDataView } = ble;

  // FONTOS: androidNeverForLocation-t NEM adunk meg. A bővítmény olyankor nem kéri
  // el a helyhozzáférést, viszont a manifestjében a BLUETOOTH_SCAN sincs
  // "neverForLocation" jelzővel ellátva — Android 12-től emiatt a keresés lefut,
  // de egyetlen eszközt sem ad vissza ("nem található eszköz").
  await BleClient.initialize();

  // Kikapcsolt Bluetooth vagy helymeghatározás mellett a keresés némán üres
  // marad — inkább mondjuk meg pontosan, mi hiányzik.
  try {
    if (!(await BleClient.isEnabled())) {
      toast('Kapcsold be a Bluetooth-t a telefonon.', 'warn');
      await BleClient.requestEnable();
    }
  } catch { /* nem minden rendszeren kérdezhető le */ }

  let helyKikapcsolva = false;
  try {
    helyKikapcsolva = !(await BleClient.isLocationEnabled());
  } catch { /* iOS-en nincs ilyen ellenőrzés */ }

  if (helyKikapcsolva) {
    toast('Androidon a Bluetooth-kereséshez a helymeghatározást is be kell kapcsolni.', 'warn');
    await BleClient.openLocationSettings();
    throw new Error('A helymeghatározás ki van kapcsolva.');
  }

  // Elsőre a szolgáltatás azonosítójára szűrünk. Ha a hirdetési csomagba nem fért
  // bele a 128 bites UUID, ez üres marad — ilyenkor névre keresünk rá.
  let eszkoz;
  try {
    eszkoz = await BleClient.requestDevice({ services: [NUS_SERVICE] });
  } catch (err) {
    if (megszakitottaE(err)) throw err;
    eszkoz = await BleClient.requestDevice({
      namePrefix: 'Hipster',
      optionalServices: [NUS_SERVICE],
    });
  }

  setBtUi('busy', 'Csatlakozás…');
  await BleClient.connect(eszkoz.deviceId, bleLecsatlakozott);

  await BleClient.startNotifications(eszkoz.deviceId, NUS_SERVICE, NUS_TX_CHAR, (ertek) => {
    bleUzenet(dataViewToText(ertek));
  });

  return {
    nev: eszkoz.name,
    ir: (szoveg) =>
      BleClient.writeWithoutResponse(eszkoz.deviceId, NUS_SERVICE, NUS_RX_CHAR, textToDataView(szoveg)),
    bont: () => BleClient.disconnect(eszkoz.deviceId),
  };
}

/* ───────────── közös belépési pont ───────────── */

async function connectButton() {
  if (bleKapcsolat) {          // már csatlakozva: a gomb most bontásra szolgál
    try { await bleKapcsolat.bont(); } catch { /* úgyis lecsatlakozott */ }
    bleLecsatlakozott();
    return;
  }

  const natív = natívE();
  if (!natív && !navigator.bluetooth) {
    toast('Ez a böngésző nem támogatja a Web Bluetooth-t — használj Chrome-ot vagy Edge-et.', 'bad');
    return;
  }

  try {
    setBtUi('busy', 'Keresés…');
    bleKapcsolat = natív ? await bleCsatlakozNatív() : await bleCsatlakozWeb();

    bleUtolsoAllapot = null;
    bleAllapotKuld(state === 'playing');

    setBtUi('on', bleKapcsolat.nev || 'Gomb csatlakoztatva');
    toast('A gomb csatlakozva.', 'good');
  } catch (err) {
    bleKapcsolat = null;
    setBtUi('off', 'Gomb csatlakoztatása');
    if (!megszakitottaE(err)) {
      toast(err && err.message ? err.message : 'Nem sikerült csatlakozni a gombhoz.', 'bad');
    }
  }
}

/* ═══════════════════════════════════════════
   Eseménykötések
   ═══════════════════════════════════════════ */

$('startScan').addEventListener('click', startScanner);
$('cancelScan').addEventListener('click', () => showView('home'));
$('nextCard').addEventListener('click', () => { pausePlayback(); startScanner(); });
$('backHome').addEventListener('click', () => { pausePlayback(); showView('home'); });
$('toggleBtn').addEventListener('click', () => togglePlayback(false));
$('btConnect').addEventListener('click', connectButton);

$('tapToPlay').addEventListener('click', () => {
  $('tapToPlay').hidden = true;
  resumePlayback();
});

$('revealBtn').addEventListener('click', () => {
  const revealed = $('screen').classList.toggle('is-revealed');
  $('revealBtn').textContent = revealed ? 'Videó elrejtése' : 'Videó felfedése';
});

/* ───────────── Kézi link megadása ───────────── */

const sheet = $('sheet');
let lastFocused = null;

function openSheet() {
  lastFocused = document.activeElement;
  sheet.hidden = false;
  $('manualError').textContent = '';
  $('manualInput').setAttribute('aria-invalid', 'false');
  $('manualInput').focus();
}

function closeSheet() {
  sheet.hidden = true;
  if (lastFocused) lastFocused.focus();
}

$('manualOpen').addEventListener('click', openSheet);
$('manualOpen2').addEventListener('click', openSheet);
$('manualClose').addEventListener('click', closeSheet);
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });

$('manualForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('manualInput');
  const videoId = extractVideoId(input.value);

  if (!videoId) {
    input.setAttribute('aria-invalid', 'true');
    $('manualError').textContent = 'Ez nem tűnik érvényes YouTube-linknek.';
    input.focus();
    return;
  }

  input.setAttribute('aria-invalid', 'false');
  $('manualError').textContent = '';
  closeSheet();
  stopScanner();
  loadVideo(videoId);
});

/* ───────────── Billentyűk ───────────── */

document.addEventListener('keydown', (e) => {
  const typing = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA';

  if (e.code === 'Space' && currentView === 'play' && !typing) {
    e.preventDefault();
    togglePlayback(false);
  }
  if (e.key === 'Escape') {
    if (!sheet.hidden) closeSheet();
    else if (currentView === 'scan') showView('home');
  }
});

/* ───────────── Indítás ───────────── */

paintRing(MAX_PLAY_MS);
setBtUi('off', 'Gomb csatlakoztatása');

// Az alkalmazásban natív Bluetooth van, ott ez a figyelmeztetés félrevezető lenne.
if (!natívE() && !navigator.bluetooth) {
  setTimeout(() => toast('A fizikai gombhoz Chrome vagy Edge böngésző kell.', 'warn'), 1400);
}
