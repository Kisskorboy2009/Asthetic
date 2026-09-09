// Gombkereso - ketfazisu.
//
// A masodik gomb nem jelentkezett a lehuzos meresen. Ennek ket oka lehet:
//   a) olyan labon van, amit nem neztunk (34-39: csak bemenet, nincs belso ellenallas)
//   b) FOLDRE huz nyomaskor (nem 3.3V-ra, mint a nagy piros gomb) - ilyenkor a
//      lehuzo modban vegig LOW-t latunk, valtozas nelkul
//
// Ezert most valtogatva merunk: 8 mp lehuzo, 8 mp felhuzo. Egy labhoz egyszerre
// csak egy beallitas tartozhat, ezert nem lehet a kettot parhuzamosan nezni.

const int pins[] = { 4, 5, 13, 14, 15, 16, 17, 18, 19, 21, 22, 25, 26, 27, 32, 33, 2, 0, 12 };
const int numPins = sizeof(pins) / sizeof(pins[0]);

// Csak bemenetre alkalmas labak: nincs beluk belso felhuzo/lehuzo, ezert lebegnek.
// Ha ezek egyikere van kotve a gomb, kulso ellenallas nelkul zajos lesz - de a
// valtozas akkor is latszik, ha nyomaskor hatarozottan 3.3V-ra vagy GND-re kerul.
const int inputOnly[] = { 34, 35, 36, 39 };
const int numInputOnly = sizeof(inputOnly) / sizeof(inputOnly[0]);

bool lastState[24];
bool lastInputOnly[4];

bool pulldownFazis = true;
unsigned long fazisKezdet = 0;
const unsigned long FAZIS_HOSSZ = 8000;

void fazisBeallit(bool pulldown) {
  for (int i = 0; i < numPins; i++) {
    pinMode(pins[i], pulldown ? INPUT_PULLDOWN : INPUT_PULLUP);
  }
  delay(30);
  for (int i = 0; i < numPins; i++) lastState[i] = digitalRead(pins[i]);

  Serial.println();
  Serial.println(pulldown
    ? ">>> LEHUZO fazis (nyomasra HIGH-t varunk) - nyomd meg a MASODIK gombot!"
    : ">>> FELHUZO fazis (nyomasra LOW-t varunk) - nyomd meg a MASODIK gombot!");
}

void setup() {
  Serial.begin(115200);
  delay(600);
  Serial.println("=== Ketfazisu gombkereso ===");
  Serial.println("A nagy piros gomb ismerten a GPIO23-on van (3.3V-ra huz).");
  Serial.println("Most a MASODIK gombot keressuk. Nyomogasd folyamatosan!");

  for (int i = 0; i < numInputOnly; i++) {
    pinMode(inputOnly[i], INPUT);
    lastInputOnly[i] = digitalRead(inputOnly[i]);
  }

  fazisBeallit(true);
  fazisKezdet = millis();
}

void loop() {
  // fazisvaltas
  if (millis() - fazisKezdet > FAZIS_HOSSZ) {
    pulldownFazis = !pulldownFazis;
    fazisBeallit(pulldownFazis);
    fazisKezdet = millis();
  }

  for (int i = 0; i < numPins; i++) {
    bool s = digitalRead(pins[i]);
    if (s != lastState[i]) {
      Serial.printf("*** GPIO%d valtozott: %s -> %s   (%s fazis)\n",
                    pins[i],
                    lastState[i] ? "HIGH" : "LOW",
                    s ? "HIGH" : "LOW",
                    pulldownFazis ? "lehuzo" : "felhuzo");
      lastState[i] = s;
    }
  }

  for (int i = 0; i < numInputOnly; i++) {
    bool s = digitalRead(inputOnly[i]);
    if (s != lastInputOnly[i]) {
      Serial.printf("*** GPIO%d (csak bemenet) valtozott: %s -> %s\n",
                    inputOnly[i], lastInputOnly[i] ? "HIGH" : "LOW", s ? "HIGH" : "LOW");
      lastInputOnly[i] = s;
    }
  }

  delay(15);
}
