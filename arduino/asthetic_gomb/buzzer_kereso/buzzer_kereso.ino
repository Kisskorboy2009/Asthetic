// BUZZER-KERESŐ — megmondja, melyik lábon van valójában a buzzer.
//
// Sorban minden használható lábon megszólaltat egy jól hallható, egy másodperces
// sípolást, és közben kiírja a soros portra, épp melyiket teszteli. Amelyiknél
// hangot hallasz, azon van a buzzer.
//
// Nincs Bluetooth: így a rádió nem zavar bele a hallgatásba, és a lábak végig
// hajtott kimenetek maradnak.
//
// Ha EGYIK lábon sem szól, akkor a buzzer nem GPIO-ra van kötve, hanem a
// tápfeszültségre (3V3/5V és GND közé) — azt a rádió áramlökései hajtják meg,
// és ezért kattog Bluetooth mellett.

const int labak[] = { 2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33 };
const int LABAK_SZAMA = sizeof(labak) / sizeof(labak[0]);

const unsigned int SIP_FREKVENCIA = 2000;   // jól hallható magasság
const unsigned int SIP_HOSSZ_MS = 1000;
const unsigned int SZUNET_MS = 1200;

void sipol(int lab, unsigned int frekvencia, unsigned int msHossz) {
  const unsigned long felPeriodusUs = 500000UL / frekvencia;
  const unsigned long ciklusok = ((unsigned long)msHossz * 1000UL) / (felPeriodusUs * 2UL);

  for (unsigned long i = 0; i < ciklusok; i++) {
    digitalWrite(lab, HIGH);
    delayMicroseconds(felPeriodusUs);
    digitalWrite(lab, LOW);
    delayMicroseconds(felPeriodusUs);
  }
  digitalWrite(lab, LOW);
}

void setup() {
  Serial.begin(115200);
  delay(300);

  for (int i = 0; i < LABAK_SZAMA; i++) {
    pinMode(labak[i], OUTPUT);
    digitalWrite(labak[i], LOW);
  }

  Serial.println();
  Serial.println("=== BUZZER-KERESO ===");
  Serial.println("Minden labon sorban sipolok egy masodpercig.");
  Serial.println("Amelyiknel hangot hallasz, azon van a buzzer.");
  Serial.println("Ha egyiknel sem szol, a buzzer a tapra van kotve, nem GPIO-ra.");
  Serial.println("------------------------------------------------");
}

void loop() {
  for (int i = 0; i < LABAK_SZAMA; i++) {
    Serial.printf(">>> most a GPIO%d szol\n", labak[i]);
    Serial.flush();
    sipol(labak[i], SIP_FREKVENCIA, SIP_HOSSZ_MS);
    delay(SZUNET_MS);
  }

  Serial.println("--- kor vege, kezdem elolrol ---");
  delay(2000);
}
