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

---

Az oldalt készítette: [Kisskorboy](https://kisskorboy.hu/)
