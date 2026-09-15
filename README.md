# Asthetic Game

Hitster-stílusú zenei társasjáték: QR-kódos kártyákról indul egy dal, és ki kell találni a címét, előadóját vagy a megjelenés évét.

A projekt három részből áll, és mindhárom ugyanabból a kódbázisból él:

| Rész | Hol |
|---|---|
| **Weboldal** | a repó gyökere — statikus HTML/CSS/JS |
| **Android alkalmazás** | ugyanaz a weboldal, [Capacitorral](https://capacitorjs.com/) becsomagolva (`android/`) |
| **Fizikai gomb** | ESP32-es firmware (`arduino/asthetic_gomb/`) |

## Játékmódok

- **QR-mód** — beolvasol egy kártyát, a dal a 45. másodperctől szól 30 másodpercig. A fizikai gombbal (vagy a képernyőn) állítható meg és indítható újra.
- **Kvízcsata (Kahoot-szerű)** — szobát nyitsz, a többiek kóddal csatlakoznak, mindenki ugyanazt a dalt hallja, és négy válasz közül választ. Aki jól és gyorsan válaszol, több pontot kap.

## Helyi futtatás

```bash
npm install
npm start
```

Ezután nyisd meg: <http://localhost:4173>

A kamera és a Web Bluetooth csak „biztonságos kontextusban" működik, ezért nem elég a HTML-t duplán kattintani — ezen a kis kiszolgálón keresztül kell megnyitni. A Kvízcsatához a telefonok a helyi hálózatról is csatlakozhatnak (a kiszolgáló kiírja a címet induláskor).

## Android APK

Minden `main`-re küldött változtatásnál a GitHub Actions lefordítja az alkalmazást. Az APK a **Actions → Android APK → az adott futás → Artifacts** alatt tölthető le (`asthetic-apk`).

Helyi fordításhoz Android Studio kell:

```bash
npm run android
```

## Fizikai gomb

ESP32-WROOM, klasszikus Bluetooth és BLE egyszerre. A bekötés és a lábkiosztás az [`arduino/asthetic_gomb/asthetic_gomb.ino`](arduino/asthetic_gomb/asthetic_gomb.ino) fejlécében van leírva.

| Alkatrész | Láb |
|---|---|
| Nagy gomb (STOP) | GPIO23, másik lába 3V3 |
| Fehér gomb (PLAY) | GPIO25, másik lába GND |
| Piros LED | GPIO18, 220 Ω ellenálláson át |
| Buzzer | GPIO26 |

A gomb `STOP` / `PLAY` sort küld, a játék pedig `PLAYING` / `STOPPED` sorral válaszol vissza — ettől világít a gomb LED-je pontosan akkor, amikor szól a zene.

## Dalok adatbázisa

Az `adatbazis/` mappa építi a `songs.json`-t az Excel-táblából, és ez generálja a kvízkérdéseket is (`question_engine.js`).

### Rossz YouTube-linkek kiszűrése

A linkek idővel elromlanak: a videót törlik, privátra állítják, letiltják Magyarországon, vagy a feltöltő megtiltja a beágyazást. Két ellenőrző van rá.

```bash
node adatbazis/link_ellenoriz.js            # csak megnézi, jelentést ír
node adatbazis/link_ellenoriz.js --frissit  # a találatokat a tiltólistára is felveszi
node adatbazis/takarits.js                  # a tiltólistán lévőket kiveszi a songs.json-ból
```

A `link_ellenoriz.js` a YouTube oEmbed- és player-válaszából dolgozik: a **törölt**, a **Magyarországon letiltott** és a **beágyazást tiltó** videókat találja meg. Csak akkor jelöl meg egy dalt, ha mindkét forrás egyetért — egy elakadt hálózati kérés így nem dob ki jó dalt.

Ami HTTP-szinten rendben van, az még megbukhat magában a lejátszóban. Erre való a böngészős ellenőrzés: futtasd az `npm start`-ot, és nyisd meg a <http://localhost:4173/adatbazis/link_ellenoriz.html> címet. Ez ugyanabban a YouTube-lejátszóban indítja el a dalokat, mint a játék — **hagyd a lapot előtérben**, különben a böngésző felfüggeszti a videókat, és minden hibásnak látszik.

A megtalált videók a `tiltott_videok.json`-ba kerülnek. Ezt a `build_dataset.js` is figyelembe veszi, tehát az adatbázis újraépítése után sem jönnek vissza a rossz linkek.

---

Az oldalt készítette: [Kisskorboy](https://kisskorboy.hu/)
