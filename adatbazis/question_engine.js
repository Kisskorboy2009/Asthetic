// Asthetic / Hitster - kerdesgenerator
//
// Harom kerdestipus, a megrendelt logika szerint:
//   'year'   - 4 evszam, egymastol 5-10 ev tavolsagra
//   'artist' - 4 eloado, mind hasonlo korszakbol
//   'title'  - 4 dalcim; lehetoleg UGYANATTOL az eloadotol, kulonben hasonlo korszakbol
//
// A generator determinisztikus lehet: adj at egy seedet, es ugyanazt a kerdest kapod.
// Igy a szoba minden jatekosanal pontosan ugyanaz a kerdes jelenik meg.

// ---------- veletlenszam (seedelheto, hogy minden kliens ugyanazt lassa) ----------
function makeRng(seed) {
  let s = seed >>> 0 || 1;
  return function rng() {
    // xorshift32
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5;  s >>>= 0;
    return s / 4294967296;
  };
}

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function normalize(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ---------- nyelvi szures ----------
// A dalokhoz tartozik egy 'nyelv' mezo ('hu' vagy 'egyeb'), amit az
// adatbazis epitesekor az adatbazis/nyelv_felismeres.js allapit meg eloadonkent.
// Ha valamiert hianyzik, nem szurunk - jobb egy vegyes kerdes, mint semmilyen.
function azonosNyelv(song, songs) {
  if (!song.nyelv) return songs;
  const szurt = songs.filter((s) => s.nyelv === song.nyelv);
  return szurt.length >= 8 ? szurt : songs;
}

// ---------- 1) EVSZAM ----------
// A 4 evszam ugy all elo, hogy a szomszedos ertekek 5-10 ev tavolsagra legyenek egymastol,
// es a helyes valasz veletlenszeru helyen alljon a sorban.
//
// FONTOS: minden evszamnak realisnak kell lennie. Egy jovobeli ev (pl. 2027) azonnal
// elarulna magat, ezert a teljes ablakot beleszoritjuk az ERV_MIN..ERV_MAX tartomanyba:
// ha a helyes evszam a tartomany szelen van, a helyes valasz automatikusan a sor
// elejere/vegere kerul, es az elteritok a masik iranyba nyulnak.
const ERV_MIN = 1900;
const ERV_MAX = new Date().getFullYear();

function yearOptions(correctYear, rng, minYear = ERV_MIN, maxYear = ERV_MAX) {
  const gaps = [0, 1, 2].map(() => 5 + Math.floor(rng() * 6)); // 3 db 5-10 eves lepes

  // Melyik pozicioba kerulhet a helyes valasz ugy, hogy minden ev a tartomanyon belul maradjon?
  const lehetseges = [];
  for (let slot = 0; slot < 4; slot++) {
    let ala = 0;
    for (let i = 0; i < slot; i++) ala += gaps[i];
    let fole = 0;
    for (let i = slot; i < 3; i++) fole += gaps[i];

    if (correctYear - ala >= minYear && correctYear + fole <= maxYear) lehetseges.push(slot);
  }

  // Ha egyik pozicio sem fer bele (nagyon szuk tartomany), a legkisebb lepesekkel probaljuk ujra.
  if (lehetseges.length === 0) {
    const kicsiGaps = [5, 5, 5];
    for (let slot = 3; slot >= 0; slot--) {
      const ala = slot * 5;
      const fole = (3 - slot) * 5;
      if (correctYear - ala >= minYear && correctYear + fole <= maxYear) {
        return buildYears(correctYear, slot, kicsiGaps);
      }
    }
    // vegso esetben a tartomany also szelehez igazitunk
    return buildYears(correctYear, 3, kicsiGaps);
  }

  const correctSlot = lehetseges[Math.floor(rng() * lehetseges.length)];
  return buildYears(correctYear, correctSlot, gaps);
}

function buildYears(correctYear, correctSlot, gaps) {
  const years = new Array(4);
  years[correctSlot] = correctYear;

  let y = correctYear;
  for (let i = correctSlot - 1; i >= 0; i--) {
    y -= gaps[i];
    years[i] = y;
  }
  y = correctYear;
  for (let i = correctSlot + 1; i < 4; i++) {
    y += gaps[i - 1];
    years[i] = y;
  }

  return { options: years.map(String), correctIndex: correctSlot };
}

// A kozremukodoket levagva kapjuk a "fo eloadot". Enelkul a "Peller Karoly" es a
// "Peller Karoly feat. Szendy Szilvy" kulon eloadonak szamitana, es mind a negy
// valasz ugyanaz az eloado lehetne - ertelmetlen kerdes.
function foEloado(nev) {
  const csonkolt = String(nev || '')
    .replace(/\s*(?:feat\.?|ft\.?|featuring|vs\.?|&|,|\bx\b|\bés\b)\s+.*$/i, '');
  return normalize(csonkolt);
}

// ---------- 2) ELOADO ----------
// Hasonlo korszakbol valo eloadok: elobb szuk (+-8 ev), majd tagabb ablakkal probalkozunk.
function artistOptions(song, songs, rng) {
  const correctNorm = foEloado(song.artist);
  const windows = [8, 15, 25, 100];
  let candidates = [];

  // Csak azonos nyelvi korbol valaszthatunk elteritot: egy angol dal mellett
  // harom magyar nev azonnal elarulna a helyes valaszt (es forditva).
  const jeloltDalok = azonosNyelv(song, songs);

  for (const w of windows) {
    const seen = new Set([correctNorm]);
    candidates = [];
    for (const s of jeloltDalok) {
      if (Math.abs(s.year - song.year) > w) continue;
      const n = foEloado(s.artist);
      if (seen.has(n)) continue;
      seen.add(n);
      candidates.push(s.artist);
    }
    if (candidates.length >= 3) break;
  }

  if (candidates.length < 3) return null;

  const distractors = shuffle(candidates, rng).slice(0, 3);
  const all = shuffle([song.artist, ...distractors], rng);
  return { options: all, correctIndex: all.indexOf(song.artist), source: 'korszak' };
}

// ---------- 3) DALCIM ----------
// Elsodleges: ugyanannak az eloadonak mas dalai. Ha nincs eleg, hasonlo korszakbol toltunk fel.
function titleOptions(song, songs, rng) {
  const correctArtist = normalize(song.artist);
  const correctTitle = normalize(song.title);

  const sameArtist = [];
  const seenTitles = new Set([correctTitle]);
  for (const s of songs) {
    if (normalize(s.artist) !== correctArtist) continue;
    const n = normalize(s.title);
    if (seenTitles.has(n)) continue;
    seenTitles.add(n);
    sameArtist.push(s.title);
  }

  let distractors = shuffle(sameArtist, rng).slice(0, 3);
  const source = distractors.length >= 3 ? 'sajat' : (distractors.length > 0 ? 'vegyes' : 'korszak');

  if (distractors.length < 3) {
    // feltoltes hasonlo korszakbol (mas eloadotol)
    const jeloltDalok = azonosNyelv(song, songs);
    for (const w of [10, 20, 40, 200]) {
      const pool = [];
      for (const s of jeloltDalok) {
        if (Math.abs(s.year - song.year) > w) continue;
        if (normalize(s.artist) === correctArtist) continue;
        const n = normalize(s.title);
        if (seenTitles.has(n)) continue;
        pool.push(s);
      }
      const shuffled = shuffle(pool, rng);
      for (const s of shuffled) {
        if (distractors.length >= 3) break;
        const n = normalize(s.title);
        if (seenTitles.has(n)) continue;
        seenTitles.add(n);
        distractors.push(s.title);
      }
      if (distractors.length >= 3) break;
    }
  }

  if (distractors.length < 3) return null;

  const all = shuffle([song.title, ...distractors], rng);
  return { options: all, correctIndex: all.indexOf(song.title), source };
}

// ---------- fo belepesi pont ----------
const KERDES_SZOVEG = {
  year: 'Melyik évben jelent meg ez a dal?',
  artist: 'Ki az előadója ennek a dalnak?',
  title: 'Mi a címe ennek a dalnak?',
};

/**
 * Egy kerdes eloallitasa.
 * @param {object} song      a dal (songs.json egy eleme)
 * @param {Array}  songs     a teljes dallista (elteritokhoz)
 * @param {string} type      'year' | 'artist' | 'title'
 * @param {number} seed      ugyanaz a seed = ugyanaz a kerdes minden jatekosnal
 * @param {{min:number,max:number}} [evAblak]
 *        A szoba evtartomanya. Ha meg van adva es eleg szeles ahhoz, hogy negy
 *        evszam elferjen benne, az evszam-kerdes elteritoi is ezen belul
 *        maradnak. Kulonben egy szuk tartomanyu szobaban a tartomanyon kivul
 *        eso evszamok magukat zarnak ki, es elarulnak a helyes valaszt.
 */
function generateQuestion(song, songs, type, seed, evAblak) {
  const rng = makeRng(seed);
  let res = null;

  // Negy evszam 5-10 eves lepesekkel legalabb 15, a biztonsag kedveert 30 ev
  // szelessegu ablakot igenyel. Ennel szukebb szobanal marad a teljes skala.
  const ablakJo = evAblak
    && Number.isFinite(evAblak.min) && Number.isFinite(evAblak.max)
    && evAblak.max - evAblak.min >= 30;

  if (type === 'year') {
    res = ablakJo
      ? yearOptions(song.year, rng, Math.max(ERV_MIN, evAblak.min), Math.min(ERV_MAX, evAblak.max))
      : yearOptions(song.year, rng);
  } else if (type === 'artist') res = artistOptions(song, songs, rng);
  else if (type === 'title') res = titleOptions(song, songs, rng);
  else throw new Error('Ismeretlen kerdestipus: ' + type);

  if (!res) return null;

  return {
    type,
    kerdes: KERDES_SZOVEG[type],
    songId: song.id,
    videoId: song.videoId,
    options: res.options,
    correctIndex: res.correctIndex,
    source: res.source || null,
    // A helyes valasz csak a kiertekeleshez kell - a kliensnek NEM szabad elkuldeni,
    // amig a valaszadasi ido le nem jart.
    correctAnswer: res.options[res.correctIndex],
  };
}

/** Veletlen kerdestipus a szoba beallitasai szerint (pl. csak evszam, vagy mind). */
function pickType(enabledTypes, rng) {
  const list = enabledTypes && enabledTypes.length ? enabledTypes : ['year', 'artist', 'title'];
  return pick(list, rng);
}

// Node-ban és böngészőben is használjuk: a Firestore-os játékban a szobavezető
// böngészője állítja elő a kérdéseket, ezért ott globálisként kell elérni.
const KIFELE = { generateQuestion, pickType, makeRng, shuffle, normalize };

if (typeof module !== 'undefined' && module.exports) {
  module.exports = KIFELE;
} else {
  (typeof globalThis !== 'undefined' ? globalThis : this).AstheticKerdesek = KIFELE;
}
