// Nyelvfelismerés a daladatbázishoz.
//
// Miért kell: a kvízben az elterelő válaszoknak ugyanabból a nyelvi körből kell
// jönniük, mint a helyes válasznak. Ha egy angol dalnál három magyar előadó van
// a négy közül, a kérdés magától megfejtődik.
//
// Hogyan: NEM dalonként döntünk, hanem ELŐADÓNKÉNT, az összes daluk alapján.
// Így a Republic vagy a Bikini is magyarnak minősül, pedig a nevük nem az; és
// egy magyar előadó egy angol nyelvű dala sem sorolódik rossz helyre.
//
// A jelek súlyozva:
//   ő / ű            — gyakorlatilag csak a magyarban van, erős jel
//   magyar kötőszavak, névelők, gyakori szavak — erős jel
//   á é í ó ö ú ü    — gyenge jel, sok más nyelvben is előfordul

const CSAK_MAGYAR_BETU = /[őűŐŰ]/;

// Olyan ékezetek, amelyek a magyarban NEM léteznek. Ha ilyet látunk, az előadó
// szinte biztosan nem magyar (Måneskin, Björk, Beyoncé nem, mert az é magyar is).
const IDEGEN_EKEZET = /[åæøñçèêàâùûïëäßýžšćčđłńśźżãõ]/i;
const EKEZET = /[áéíóöúüÁÉÍÓÖÚÜ]/;

// Rövid, nagyon gyakori magyar szavak, amelyek más nyelvekben nem jelentenek
// ugyanezt. Szándékosan kimaradnak a nemzetközileg is előforduló alakok
// (pl. "a", "is", "no", "de"), hogy ne adjanak téves találatot.
const MAGYAR_SZAVAK = new Set([
  'az', 'és', 'nem', 'hogy', 'van', 'vagyok', 'vagy', 'volt', 'lesz', 'lenne',
  'csak', 'még', 'már', 'majd', 'mint', 'mert', 'ha', 'ez', 'ezt', 'azt', 'ott',
  'itt', 'így', 'úgy', 'egy', 'egyszer', 'soha', 'mindig', 'minden', 'semmi',
  'nekem', 'neked', 'neki', 'nekünk', 'velem', 'veled', 'vele', 'rólam', 'rólad',
  'szeretlek', 'szerelem', 'szerelmes', 'szív', 'szívem', 'élet', 'életem',
  'világ', 'álom', 'álmok', 'éjjel', 'éjszaka', 'nappal', 'reggel', 'este',
  'lány', 'lányok', 'fiú', 'fiúk', 'baba', 'kislány', 'asszony', 'anya', 'apa',
  'gyere', 'menj', 'maradj', 'vissza', 'tovább', 'haza', 'hazafelé',
  'dal', 'dalom', 'ének', 'zene', 'tánc', 'táncolj',
  'boldog', 'boldogság', 'bánat', 'könny', 'könnyek', 'sírok', 'nevetés',
  'kell', 'kellesz', 'akarok', 'akarlak', 'várok', 'várlak', 'hiányzol',
  'tudom', 'tudod', 'látom', 'látlak', 'hallom', 'érzem', 'érted', 'veled',
  'nélküled', 'örökké', 'végre', 'talán', 'talpra', 'fel', 'le', 'ki', 'be',
  'jaj', 'hé', 'ó',
]);

// Szóvégek, amelyek magyar toldalékra utalnak.
const MAGYAR_VEGZODESEK = [
  'nak', 'nek', 'ban', 'ben', 'ból', 'ből', 'ról', 'ről', 'tól', 'től',
  'val', 'vel', 'hoz', 'hez', 'höz', 'ra', 're', 'ba', 'be', 'ig',
  'unk', 'ünk', 'tok', 'tek', 'nak', 'nek', 'om', 'em', 'am', 'ok', 'ek', 'ak',
];

// Magyar keresztnevek. Szándékosan csak azok, amelyek angol/nemzetközi
// környezetben nem fordulnak elő ugyanígy — a "Linda", "Erik", "Laura" típusú
// kétértelmű nevek kimaradnak, hogy ne minősítsünk magyarnak külföldi előadót.
const MAGYAR_KERESZTNEVEK = new Set([
  "lászló","istván","józsef","jános","zoltán","sándor","gábor","ferenc","attila",
  "péter","tamás","zsolt","tibor","andrás","csaba","imre","balázs","károly",
  "lajos","györgy","béla","gyula","róbert","krisztián","máté","bence","ádám",
  "dániel","norbert","szabolcs","levente","gergő","gergely","ákos","árpád",
  "bálint","benedek","dezső","endre","előd","géza","győző","kálmán","kornél",
  "kristóf","márk","márton","miklós","mihály","nándor","ottó","pál","richárd",
  "szilárd","vilmos","zsombor","jenő","zsigmond","ödön","kázmér","barnabás",
  "mária","erzsébet","katalin","ilona","éva","zsuzsanna","margit","judit",
  "ágnes","andrea","krisztina","gabriella","szilvia","mónika","beáta","julianna",
  "tímea","anikó","nikolett","renáta","dóra","eszter","nóra","orsolya","réka",
  "tünde","viktória","zita","zsófia","hajnalka","csilla","emese","enikő",
  "ibolya","kinga","klára","magdolna","melinda","piroska","sarolta","bernadett",
  "brigitta","csenge","dalma","dorina","flóra","gréta","jázmin","lilla","ildikó",
  "erika","márta","irén","aranka","etelka","boglárka","villő","hédi","zsuzsa",
  // becenevek — ezek nagyon jellegzetesek
  "veca","joci","rozi","orsi","krisz","zsuzsi","kati","marci","gabi","feri",
  "jani","pisti","laci","bandi","gyuri","sanyi","tomi","robi","dani","peti",
  "andris","misi","karcsi","csabi","zsófi","niki","kriszta","bori","juci",
  "krúbi","dzsúdló","tibi","gazsi","berci","matyi","pali","jocó","zolika",
  "marika","mariska","juliska","böske","ilus","terike","piri","annuska",
  "évi","emő","enci","panni","sári","kata","dorka","luca","hanga",
]);

// Gyakori magyar vezetéknevek.
const MAGYAR_VEZETEKNEVEK = new Set([
  "nagy","kovács","tóth","szabó","horváth","varga","kiss","molnár","németh",
  "farkas","balogh","papp","takács","juhász","lakatos","mészáros","oláh",
  "rácz","fekete","szilágyi","török","fehér","gál","szűcs","kocsis","pintér",
  "fodor","szalai","sipos","magyar","lukács","gulyás","bíró","király","katona",
  "jakab","boros","somogyi","baranyi","bogdán","fábián","orosz","budai",
  "szinetár","demjén","zámbó","koós","aradszky","szécsi","máté","csepregi",
  "kovácsovics","dolhai","vikidál","hegedűs","balázs","halász","pásztor",
  "vámosi","korda","zalatnay","cserháti","kovács","szandi","müller",
]);

function szavakra(szoveg) {
  return String(szoveg || '')
    .toLowerCase()
    .replace(/[^a-záéíóöőúüű]+/gi, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Az előadó NEVE alapján adott pontszám. Ez erősebb jel, mint a dalcím: egy
    magyar előadó énekelhet angolul, de a nevét ritkán cseréli le. */
function eloadoPontszam(nev) {
  if (!nev) return 0;
  let pont = 0;

  if (IDEGEN_EKEZET.test(nev)) return -6;   // biztosan nem magyar
  if (CSAK_MAGYAR_BETU.test(nev)) pont += 4;
  if (EKEZET.test(nev)) pont += 2;

  for (const szo of szavakra(nev)) {
    if (MAGYAR_KERESZTNEVEK.has(szo)) pont += 5;
    if (MAGYAR_VEZETEKNEVEK.has(szo)) pont += 5;
  }
  return pont;
}

/** Egyetlen szöveg (cím vagy előadónév) magyarságának pontszáma. */
function szovegPontszam(szoveg) {
  if (!szoveg) return 0;
  let pont = 0;

  if (CSAK_MAGYAR_BETU.test(szoveg)) pont += 4;
  if (EKEZET.test(szoveg)) pont += 1;

  const szavak = szavakra(szoveg);
  for (const szo of szavak) {
    if (MAGYAR_SZAVAK.has(szo)) pont += 3;
    // Magyar keresztnev a dalcimben is eros jel ("Hajmási Péter, Hajmási Pál").
    else if (MAGYAR_KERESZTNEVEK.has(szo) || MAGYAR_VEZETEKNEVEK.has(szo)) pont += 3;
    else if (szo.length >= 6 && MAGYAR_VEGZODESEK.some((v) => szo.endsWith(v))) pont += 1;
  }

  return pont;
}

/**
 * Előadónként osztályoz: az adott előadó ÖSSZES dalcíme (és a neve) alapján dönt.
 * @returns {Map<string, 'hu'|'egyeb'>} normalizált előadónév -> nyelv
 */
function eloadokOsztalyozasa(songs, kuszob = 4) {
  const eloadok = new Map();   // norm -> { pont, dalok }

  for (const dal of songs) {
    const norm = normalizaltEloado(dal.artist);
    if (!eloadok.has(norm)) {
      eloadok.set(norm, { pont: eloadoPontszam(dal.artist), dalok: 0, nev: dal.artist });
    }
    const be = eloadok.get(norm);
    be.pont += szovegPontszam(dal.title);
    be.dalok++;
  }

  const eredmeny = new Map();
  for (const [norm, be] of eloadok) {
    eredmeny.set(norm, be.pont >= kuszob ? 'hu' : 'egyeb');
  }
  return eredmeny;
}

function normalizaltEloado(nev) {
  return String(nev || '')
    .toLowerCase()
    .replace(/\s*(feat\.?|ft\.?|featuring|vs\.?|&|x)\s+.*$/i, '')  // csak a fő előadó számít
    .replace(/[^a-záéíóöőúüű0-9]+/gi, ' ')
    .trim();
}

/** A teljes dallistát kiegészíti a `nyelv` mezővel. */
function nyelvvelKiegeszit(songs) {
  const terkep = eloadokOsztalyozasa(songs);
  return songs.map((dal) => ({
    ...dal,
    nyelv: terkep.get(normalizaltEloado(dal.artist)) || 'egyeb',
  }));
}

module.exports = {
  szovegPontszam,
  eloadoPontszam,
  eloadokOsztalyozasa,
  normalizaltEloado,
  nyelvvelKiegeszit,
};
