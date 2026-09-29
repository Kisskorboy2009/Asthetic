// Két kimenet ugyanabból a forrásból:
//
//   node scripts/build-www.js         → www/  az Android alkalmazásnak (Capacitor)
//   node scripts/build-www.js --web   → web/  a weboldalnak (Firebase Hosting)
//
// A web/ változatban:
//   • a belső linkek kiterjesztés nélküliek (/jatek, /kahoot, /letoltes …) —
//     a Firebase a cleanUrls beállítással szolgálja ki őket;
//   • a HTML, CSS és JS tömörítve, megjegyzések nélkül kerül ki.
// Az alkalmazásban maradnak a .html-es linkek: a Capacitor beépített kiszolgálója
// minden kiterjesztés nélküli útvonalat az index.html-re irányítana.

const fs = require('fs');
const path = require('path');

const GYOKER = path.join(__dirname, '..');
const WEB = process.argv.includes('--web');
const CEL = path.join(GYOKER, WEB ? 'web' : 'www');

const MASOLANDO = [
  'index.html',
  'jatek.html',
  'kahoot.html',
  'szabalyok.html',
  'adatvedelem.html',
  'feltetelek.html',
  'letoltes.html',
  '404.html',
  'bingo.html',
  'admin.html',
  'css',
  'js',
  'assets',
  'robots.txt',
  'sitemap.xml',
  // A Firestore-os játékban a szobavezető böngészője állítja elő a kérdéseket,
  // ezért a daladatbázisnak is ki kell kerülnie.
  'adatbazis/songs.json',
  'adatbazis/question_engine.js',
];

// A Rubik-Bingó csak az alkalmazásban érhető el — a weboldalra nem kerül ki.
// Az admin oldal csak a weboldalon van.
const CSAK_WEB = ['admin.html', 'js/admin.js', 'css/admin.css'];

const CSAK_APP = ['bingo.html', 'css/bingo.css', 'js/bingomotor.js', 'js/bingo-asztal.js', 'js/bingo-firestore.js', 'js/bingo.js'];

const OLDALAK = ['admin', 'index', 'jatek', 'kahoot', 'szabalyok', 'adatvedelem', 'feltetelek', 'letoltes', '404'];

function masol(honnan, hova) {
  if (fs.statSync(honnan).isDirectory()) {
    fs.mkdirSync(hova, { recursive: true });
    for (const nev of fs.readdirSync(honnan)) masol(path.join(honnan, nev), path.join(hova, nev));
  } else {
    fs.mkdirSync(path.dirname(hova), { recursive: true });
    fs.copyFileSync(honnan, hova);
  }
}

function fajlok(mappa, kiterjesztes) {
  const lista = [];
  for (const nev of fs.readdirSync(mappa)) {
    const ut = path.join(mappa, nev);
    if (fs.statSync(ut).isDirectory()) lista.push(...fajlok(ut, kiterjesztes));
    else if (ut.endsWith(kiterjesztes)) lista.push(ut);
  }
  return lista;
}

/** index.html#gyik → /#gyik, jatek.html → /jatek */
function tisztaLinkek(html) {
  const minta = new RegExp(`(href=")(?:\\.?/)?(${OLDALAK.join('|')})\\.html((?:[?#][^"]*)?")`, 'g');
  return html.replace(minta, (_, eleje, oldal, vege) => eleje + (oldal === 'index' ? '/' : '/' + oldal) + vege);
}

async function tomorit() {
  const esbuild = require('esbuild');
  const { minify } = require('html-minifier-terser');

  for (const fajl of fajlok(CEL, '.js')) {
    const forras = fs.readFileSync(fajl, 'utf8');
    const { code } = await esbuild.transform(forras, { loader: 'js', minify: true, target: 'es2020', legalComments: 'none' });
    fs.writeFileSync(fajl, code);
  }
  for (const fajl of fajlok(CEL, '.css')) {
    const forras = fs.readFileSync(fajl, 'utf8');
    const { code } = await esbuild.transform(forras, { loader: 'css', minify: true, legalComments: 'none' });
    fs.writeFileSync(fajl, code);
  }
  for (const fajl of fajlok(CEL, '.html')) {
    const forras = fs.readFileSync(fajl, 'utf8');
    const kesz = await minify(tisztaLinkek(forras), {
      collapseWhitespace: true,
      conservativeCollapse: true,
      removeComments: true,
      minifyCSS: true,
      minifyJS: true,
      removeRedundantAttributes: true,
      sortAttributes: false,
    });
    fs.writeFileSync(fajl, kesz);
  }
}

async function main() {
  fs.rmSync(CEL, { recursive: true, force: true });
  fs.mkdirSync(CEL, { recursive: true });

  let db = 0;
  for (const nev of MASOLANDO) {
    const forras = path.join(GYOKER, nev);
    if (!fs.existsSync(forras)) { console.warn('  ! hiányzik, kihagyva: ' + nev); continue; }
    masol(forras, path.join(CEL, nev));
    db++;
  }

  // A kezdőlapon kiírt dalszám mindig a tényleges adatbázisból jön.
  const dalokSzama = JSON.parse(fs.readFileSync(path.join(GYOKER, 'adatbazis', 'songs.json'), 'utf8')).length;
  for (const fajl of fajlok(CEL, '.html')) {
    const eredeti = fs.readFileSync(fajl, 'utf8');
    const uj = eredeti.replace(/(<[^>]*\bdata-dalszam\b[^>]*>)\d+(<)/g, `$1${dalokSzama}$2`);
    if (uj !== eredeti) fs.writeFileSync(fajl, uj);
  }

  if (!WEB) for (const nev of CSAK_WEB) fs.rmSync(path.join(CEL, nev), { force: true });
  if (WEB) {
    for (const nev of CSAK_APP) fs.rmSync(path.join(CEL, nev), { force: true });
    await tomorit();
  }

  console.log(`${path.basename(CEL)}/ elkészült — ${db} elem, ${dalokSzama} dal${WEB ? ', tömörítve' : ''}.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
