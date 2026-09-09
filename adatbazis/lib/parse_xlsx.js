// Egyszeru .xlsx (Office Open XML) olvaso Node-hoz, kulso konyvtar nelkul.
// Csak azt tudja, ami ide kell: egy munkalap cellai, inline string / szam / sharedString.

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const os = require('os');

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function unzipTo(xlsxPath, destDir) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  const tmpZip = path.join(destDir, '_tmp.zip');
  fs.copyFileSync(xlsxPath, tmpZip);
  execSync(
    `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${tmpZip}' -DestinationPath '${destDir}' -Force"`,
    { stdio: 'pipe' }
  );
  return destDir;
}

function loadSharedStrings(dir) {
  const p = path.join(dir, 'xl', 'sharedStrings.xml');
  if (!fs.existsSync(p)) return [];
  const xml = fs.readFileSync(p, 'utf8');
  const out = [];
  for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    const parts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeEntities(t[1]));
    out.push(parts.join(''));
  }
  return out;
}

function colToIndex(ref) {
  const letters = ref.match(/^[A-Z]+/)[0];
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readSheet(xlsxPath, sheetFile = 'sheet1.xml') {
  const dir = path.join(os.tmpdir(), 'xlsxread_' + Date.now());
  unzipTo(xlsxPath, dir);
  const shared = loadSharedStrings(dir);
  const sheetPath = path.join(dir, 'xl', 'worksheets', sheetFile);
  if (!fs.existsSync(sheetPath)) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error('Nincs ilyen munkalap: ' + sheetFile);
  }
  const xml = fs.readFileSync(sheetPath, 'utf8');
  const rows = [];

  for (const rowM of xml.matchAll(/<row[^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowIdx = Number(rowM[1]) - 1;
    const cells = [];
    for (const cM of rowM[2].matchAll(/<c r="([A-Z]+\d+)"([^>]*)>([\s\S]*?)<\/c>/g)) {
      const col = colToIndex(cM[1]);
      const attrs = cM[2];
      const body = cM[3];
      const type = (attrs.match(/t="([^"]+)"/) || [])[1] || 'n';
      let value = '';
      if (type === 'inlineStr') {
        const parts = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeEntities(t[1]));
        value = parts.join('');
      } else if (type === 's') {
        const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        value = shared[Number(v)] ?? '';
      } else {
        const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        value = v === undefined ? '' : decodeEntities(v);
      }
      cells[col] = value;
    }
    rows[rowIdx] = cells;
  }

  fs.rmSync(dir, { recursive: true, force: true });
  return rows;
}

module.exports = { readSheet };

if (require.main === module) {
  const file = process.argv[2];
  const sheet = process.argv[3] || 'sheet1.xml';
  const rows = readSheet(file, sheet);
  console.log('Sorok szama: ' + rows.length);
  for (let i = 0; i < Math.min(rows.length, Number(process.argv[4] || 5)); i++) {
    console.log(i + ': ' + JSON.stringify(rows[i]));
  }
}
