// CSEND-TESZT — annak eldöntésére, honnan jön a kattogás.
//
// Ez a program szándékosan NEM csinál semmit:
//   - nincs Bluetooth (se klasszikus, se BLE), tehát nincs rádió-áramlökés
//   - minden használható láb hajtott KIMENET, alacsony szinten
//   - a főciklus üres
//
// Ha ezzel a programmal IS kattog, akkor a hang nem a firmware-től és nem a
// lábaktól jön — akkor a tápellátás (a dobozban lévő boost/töltő modul) az
// okozó, és azt hardveresen kell orvosolni.
//
// Ha viszont ELHALLGAT, akkor a rádió vagy valamelyik láb a felelős, és onnan
// tudunk célzottan tovább keresni.
//
// A GPIO6-11 (belső flash) és a GPIO1/3 (soros port) szándékosan kimarad.

const int labak[] = { 2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33 };
const int LABAK_SZAMA = sizeof(labak) / sizeof(labak[0]);

void setup() {
  Serial.begin(115200);
  delay(300);

  for (int i = 0; i < LABAK_SZAMA; i++) {
    pinMode(labak[i], OUTPUT);
    digitalWrite(labak[i], LOW);
  }

  Serial.println();
  Serial.println("=== CSEND-TESZT ===");
  Serial.println("Nincs Bluetooth. Minden lab kimenet, alacsony szinten.");
  Serial.println("Ha most is kattog, a hang nem a firmware-tol jon.");
}

void loop() {
  delay(1000);
}
