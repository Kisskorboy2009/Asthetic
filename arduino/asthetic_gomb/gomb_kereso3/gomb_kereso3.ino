// Gombkereső — harmadik kör.
//
// Az előző körökben azért nem találtunk semmit, mert a gomb egyik vezetéke a
// belső flash lábára (SD0-3/CMD/CLK = GPIO6-11) volt kötve, onnan pedig soha
// nem jön jel. Most az egyik vezeték rendes GND-n van, ezért elég egyetlen,
// egyszerű pásztázás: minden használható lábat felhúzunk, és azt figyeljük,
// melyik esik le nullára gombnyomáskor.
//
// A GPIO1 és GPIO3 (soros port) és a GPIO6-11 (flash) szándékosan kimarad.

const int labak[] = { 2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33 };
const int LABAK_SZAMA = sizeof(labak) / sizeof(labak[0]);

// Ezeken nincs belső felhúzás, ezért csak tájékoztatásul olvassuk őket.
const int csakBemenet[] = { 34, 35, 36, 39 };
const int CSAK_BEMENET_SZAMA = sizeof(csakBemenet) / sizeof(csakBemenet[0]);

int elozo[LABAK_SZAMA];
int elozoCsakBemenet[CSAK_BEMENET_SZAMA];
unsigned long utolsoSzivdobbanas = 0;

void setup() {
  Serial.begin(115200);
  delay(400);

  for (int i = 0; i < LABAK_SZAMA; i++) {
    pinMode(labak[i], INPUT_PULLUP);
  }
  for (int i = 0; i < CSAK_BEMENET_SZAMA; i++) {
    pinMode(csakBemenet[i], INPUT);
  }
  delay(50);

  Serial.println();
  Serial.println("=== GOMBKERESO 3 ===");
  Serial.println("Minden lab felhuzva (INPUT_PULLUP). Nyomd a feher gombot!");
  Serial.print("Kiindulo allapot: ");
  for (int i = 0; i < LABAK_SZAMA; i++) {
    elozo[i] = digitalRead(labak[i]);
    Serial.printf("%d=%d ", labak[i], elozo[i]);
  }
  Serial.println();

  Serial.print("Csak bemeneti labak (nincs felhuzas): ");
  for (int i = 0; i < CSAK_BEMENET_SZAMA; i++) {
    elozoCsakBemenet[i] = digitalRead(csakBemenet[i]);
    Serial.printf("%d=%d ", csakBemenet[i], elozoCsakBemenet[i]);
  }
  Serial.println();
  Serial.println("Amelyik lab 0-ra esik, arra van kotve a gomb.");
  Serial.println("--------------------------------------------");
}

void loop() {
  for (int i = 0; i < LABAK_SZAMA; i++) {
    int most = digitalRead(labak[i]);
    if (most != elozo[i]) {
      Serial.printf(">>> GPIO%d valtozott: %d -> %d\n", labak[i], elozo[i], most);
      elozo[i] = most;
    }
  }

  for (int i = 0; i < CSAK_BEMENET_SZAMA; i++) {
    int most = digitalRead(csakBemenet[i]);
    if (most != elozoCsakBemenet[i]) {
      Serial.printf(">>> GPIO%d (csak bemenet) valtozott: %d -> %d\n", csakBemenet[i], elozoCsakBemenet[i], most);
      elozoCsakBemenet[i] = most;
    }
  }

  if (millis() - utolsoSzivdobbanas > 5000) {
    utolsoSzivdobbanas = millis();
    Serial.println("... figyelek, nyomd a gombot ...");
  }

  delay(5);
}
