// A Capacitor futtatókörnyezetét és a Bluetooth-bővítményt sima <script> taggel
// töltjük be, hogy ne kelljen bundler (webpack/vite) a projektbe.
//
// Ez a szkript másolja be a node_modules-ból a js/vendor/ mappába. A bemásolt
// fájlok a verziókövetésben is benne vannak, hogy a weboldal önmagában is működjön.
// Csomagfrissítés után futtasd újra:  node scripts/vendor.js

const fs = require('fs');
const path = require('path');

const GYOKER = path.join(__dirname, '..');
const CEL = path.join(GYOKER, 'js', 'vendor');

const FAJLOK = [
  ['node_modules/@capacitor/core/dist/capacitor.js', 'capacitor.js'],
  ['node_modules/@capacitor-community/bluetooth-le/dist/plugin.js', 'bluetooth-le.js'],
];

fs.mkdirSync(CEL, { recursive: true });

for (const [honnan, nev] of FAJLOK) {
  const forras = path.join(GYOKER, honnan);
  if (!fs.existsSync(forras)) {
    console.error('  ! nincs meg: ' + honnan + ' — futtass npm install-t');
    process.exitCode = 1;
    continue;
  }
  fs.copyFileSync(forras, path.join(CEL, nev));
  console.log('  ' + nev + '  <- ' + honnan);
}
