// Hipster gomb - ESP32 Bluetooth (Classic SPP) gomb vezérlő
// Párosítás után a Kodular app BluetoothClient1 komponense csatlakozik erre az eszközre.
// A gomb minden lenyomásakor (debounce-olva) egyszerűen "TOGGLE"-t küld -> az app
// dönti el a saját, mindig pontos állapota alapján, hogy meg kell-e állítani vagy
// folytatni a videót. (Szándékosan NEM a mikrokontroller tartja nyilván a
// lejátszás/megállítás állapotát, mert az könnyen szétcsúszik a valós app-állapottól,
// ha pl. a gomb Bluetooth-kapcsolat nélkül lett megnyomva korábban.)
//
// FIGYELEM: a "classic" Bluetooth SPP (BluetoothSerial.h) csak az eredeti ESP32-n
// (és ESP32-WROOM/WROVER stb.) érhető el. ESP32-S3/C3/C6 nem támogatja (csak BLE-t tud).

#include "BluetoothSerial.h"

#if !defined(CONFIG_BT_ENABLED) || !defined(CONFIG_BLUEDROID_ENABLED)
#error Bluetooth nincs engedélyezve! Arduino IDE-ben: Tools > Partition Scheme, válassz egy Bluetooth-t is tartalmazó sémát.
#endif

BluetoothSerial SerialBT;

const char* DEVICE_NAME = "Hipster Gomb";   // ez a név jelenik meg a telefonon párosításkor
const int BUTTON_PIN = 23;                  // gomb a GPIO23-ra kötve, nyomáskor 3.3V-ra húz (belső lehúzó ellenállással)
const unsigned long DEBOUNCE_MS = 250;      // pergésmentesítési idő

bool lastButtonState = LOW;
unsigned long lastPressTime = 0;

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLDOWN);

  SerialBT.begin(DEVICE_NAME);
  Serial.printf("Bluetooth elindítva, eszköznév: %s\n", DEVICE_NAME);
  Serial.println("Várakozás párosításra / csatlakozásra...");
}

void loop() {
  bool buttonState = digitalRead(BUTTON_PIN);

  // Lenyomás észlelése (LOW -> HIGH él, mert a gomb 3.3V-ra húz nyomáskor)
  if (lastButtonState == LOW && buttonState == HIGH) {
    unsigned long now = millis();
    if (now - lastPressTime > DEBOUNCE_MS) {
      lastPressTime = now;

      if (SerialBT.hasClient()) {
        SerialBT.println("TOGGLE");
        Serial.println("Gomb megnyomva -> TOGGLE elküldve");
      } else {
        Serial.println("Gomb megnyomva, de nincs csatlakozott Bluetooth kliens");
      }
    }
  }

  lastButtonState = buttonState;
  delay(10);
}
