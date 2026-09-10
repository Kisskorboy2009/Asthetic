// Asthetic gomb - ESP32 kettos Bluetooth (Classic SPP + BLE) gombvezerlo
//
// KET FIZIKAI GOMB, KET KULON PARANCS:
//   NAGY gomb  (GPIO23) -> "STOP"  : megallitja a zenet
//   KIS  gomb  (GPIO25) -> "PLAY"  : elinditja / folytatja a zenet
//
// Mindket parancs egyszerre ket csatornan megy ki:
//   1) Klasszikus Bluetooth SPP  -> a Kodular app (BluetoothClient)
//   2) BLE (Nordic UART Service) -> az Asthetic weboldal (Web Bluetooth)
// A ket stack egyszerre fut: a SerialBT.begin() alapertelmezetten dual-mode-ban
// (BTDM) inditja a radiot, ezert a BLE memoria nem szabadul fel.
//
// LED es hangjelzes:
//   - a piros gomb LED-je (GPIO18) villog, amig nincs Bluetooth-kapcsolat,
//     utana pedig csak akkor vilagit, amikor zene szol
//   - csatlakozaskor rovid "ting" hangot ad a buzzer (GPIO33)
//
// A LED valos allapotat a fogado oldal is visszakuldheti ("PLAYING"/"STOPPED"),
// addig is a gombnyomas azonnal atallitja (optimista visszajelzes), hogy soha
// ne tunjon lassunak.
//
// ---------------------------------------------------------------------------
// BEKOTES
//
//   NAGY gomb : egyik laba -> P23 (GPIO23), masik laba -> 3V3
//               (nyomaskor 3.3V-ra huz, belso pulldown tartja alacsonyan)
//   KIS  gomb : egyik laba -> GPIO25, masik laba -> GND
//               (meressel derult ki, hogy ide van kotve - a panelre irt "P22"
//                jeloles nem ezt a labat jelentette)
//               (belso pullup tartja magasan, nyomaskor GND-re huz)
//   LED       : anod (hosszabb lab) -> 220 ohm ellenallas -> GPIO18
//               katod (rovidebb lab) -> GND
//   Buzzer    : + -> GPIO33,  - -> GND   (passziv piezo buzzer)
//               FONTOS: a masodik vezetek GND-re valo, NEM a tapra. Amig a
//               tapon logott, a Bluetooth-radio aramlokeseibol szarmazo
//               taphullamzas atesett a piezon, es halkan, folyamatosan kattogott.
//
//   FONTOS: a "SD0/SD1/SD2/SD3/CMD/CLK" (vagy "SDD") jelolesu labak a belso
//   flash memoriahoz tartoznak (GPIO6-11), azokra SEMMIT nem szabad kotni -
//   onnan soha nem jon jel, es a panel le is fagyhat tolluk.
// ---------------------------------------------------------------------------
//
// FONTOS FORDITASI BEALLITAS (Arduino IDE):
//   Tools > Partition Scheme > "Huge APP (3MB No OTA/1MB SPIFFS)"
// A ket Bluetooth stack egyutt nem fer bele az alapertelmezett particiomeretbe.
//
// FIGYELEM: a klasszikus Bluetooth SPP csak az eredeti ESP32-n (ESP32-WROOM/
// WROVER stb.) erheto el. ESP32-S3/C3/C6 nem tamogatja, csak BLE-t tud.

#include "BluetoothSerial.h"
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#if !defined(CONFIG_BT_ENABLED) || !defined(CONFIG_BLUEDROID_ENABLED)
#error Bluetooth nincs engedelyezve! Valassz Bluetooth-t is tartalmazo particiosemat.
#endif

// Nordic UART Service (NUS) - ezt varja a weboldal is
#define NUS_SERVICE_UUID "6E400001-B5A3-F393-E0A9-E50E24DCCA9E"
#define NUS_TX_CHAR_UUID "6E400003-B5A3-F393-E0A9-E50E24DCCA9E"  // ESP32 -> bongeszo (notify)
#define NUS_RX_CHAR_UUID "6E400002-B5A3-F393-E0A9-E50E24DCCA9E"  // bongeszo -> ESP32 (write)

// A klasszikus BT nev valtoztatasa ujraparositast igenyel a telefonon,
// ezert marad az eredeti nev, hogy a mar mukodo Kodular app ne toerjen el.
const char *DEVICE_NAME = "Hipster Gomb";

const int STOP_BUTTON_PIN = 23;  // NAGY gomb: nyomaskor 3.3V-ra huz  (pulldown, felfuto el)
const int PLAY_BUTTON_PIN = 25;  // KIS gomb : nyomaskor GND-re huz   (pullup,  lefuto el)
const int LED_PIN = 18;          // piros gomb LED-je (220 ohm ellenallason at)
const int BUZZER_PIN = 33;       // buzzer jellaba (meressel: a 33-on szolal meg)

// Ketfele buzzer letezik:
//   - ketvezetekes passziv piezo: mi hajtjuk a hangot, nyugalomban LOW a jo
//   - haromlabu aktiv modul (VCC/GND/jel): sajat oszcillatora van, es a legtobb
//     ilyen FORDITOTT logikaju - akkor szol, ha a jellab ALACSONY. Ilyenkor
//     nyugalomban HIGH-ra kell huzni, kulonben folyamatosan sziszeg/kattog.
// FIGYELEM: ezt NE allitsd HIGH-ra. Kiprobaltuk, es a panel ujrainditasi hurokba
// esett tole: ha a buzzer magneses (tekercses) tipusu, a tartosan magas szint
// folyamatos aramot hajt at rajta, ami tobb, mint amit egy GPIO elbir.
// Nyugalomban mindig LOW a helyes.
const int BUZZER_NYUGALMI_SZINT = LOW;

// Minden tobbi labat is hajtott alacsony szinten tartunk. Egy szabadon logo lab
// felszedi a Bluetooth-radio zajat, es a ra kotott piezo attol halkan kattog -
// pontosan ez okozta a rejtelyes kattogast. Igy akkor sem szolalhat meg
// veletlenul, ha valamit maskepp kotunk be kesobb.
// (A GPIO1/3 a soros port, a GPIO6-11 a belso flash, a 34-39 pedig csak bemenet.)
const int SZABAD_LABAK[] = { 2, 4, 5, 12, 13, 14, 15, 16, 17, 19, 21, 22, 26, 27, 32 };
const int SZABAD_LABAK_SZAMA = sizeof(SZABAD_LABAK) / sizeof(SZABAD_LABAK[0]);

const unsigned long DEBOUNCE_MS = 250;  // pergesmentesites

BluetoothSerial SerialBT;
BLECharacteristic *txCharacteristic = nullptr;
bool bleClientConnected = false;

bool sppVoltCsatlakozva = false;  // klasszikus BT kliens elozo allapota
bool zeneSzol = false;            // ezt mutatja a LED

bool stopElozo = LOW;   // pulldown: alapallapot LOW
bool playElozo = HIGH;  // pullup:   alapallapot HIGH
unsigned long stopUtolsoMs = 0;
unsigned long playUtolsoMs = 0;

// A BLE write callback sajat taskban fut, ezert csak jelzest hagy itt,
// a tenyleges feldolgozas a loop()-ban tortenik.
volatile bool bleUzenetErkezett = false;
String bleUzenet;

// A csatlakozaskori "ting" hangot sem a BLE taskbol jatsszuk le (ott a delay()
// blokkolna a stacket), hanem a loop() kovetkezo korebol.
volatile bool tingKert = false;

// ----------------------- hang- es fenyjelzes -----------------------

bool vanKapcsolat() {
  return bleClientConnected || sppVoltCsatlakozva;
}

// A LED harom allapotot mutat:
//   nincs Bluetooth-kapcsolat -> villog (el a gomb, de meg varja a parositast)
//   csatlakozva, csend         -> nem vilagit
//   csatlakozva, szol a zene   -> folyamatosan vilagit
const unsigned long VILLOGAS_MS = 400;

void ledFrissit() {
  if (!vanKapcsolat()) {
    digitalWrite(LED_PIN, (millis() / VILLOGAS_MS) % 2 == 0 ? HIGH : LOW);
    return;
  }
  digitalWrite(LED_PIN, zeneSzol ? HIGH : LOW);
}

// A tone()/noTone() parost szandekosan NEM hasznaljuk.
// A noTone() egy hatterben futo taskon keresztul ledcDetach()-et hiv, ami
// "nincs buszhoz rendelve" allapotban hagyja a labat - vagyis szabadon logva,
// es a piezo ilyenkor kattog. Mivel a tone() aszinkron, ez a levalasztas azutan
// is megtortenhet, hogy mi mar visszaallitottuk a labat kimenetnek; ezert nem
// segitett az elozo javitas. Sajat kezuleg billegtetjuk a labat: igy vegig
// hajtott marad, es a hang utan garantaltan alacsony szinten all.
void hangSzol(unsigned int frekvencia, unsigned int msHossz) {
  if (frekvencia == 0) return;
  const unsigned long felPeriodusUs = 500000UL / frekvencia;
  const unsigned long ciklusok = ((unsigned long)msHossz * 1000UL) / (felPeriodusUs * 2UL);

  for (unsigned long i = 0; i < ciklusok; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delayMicroseconds(felPeriodusUs);
    digitalWrite(BUZZER_PIN, LOW);
    delayMicroseconds(felPeriodusUs);
  }
  digitalWrite(BUZZER_PIN, BUZZER_NYUGALMI_SZINT);
}

// Rovid ket hangos "ting" - ezt hallod, amikor sikerult a csatlakozas.
// Ha a Bluetooth-kapcsolat pillanatokra ki-be ugral, egymast ero tingek helyett
// legalabb ket masodpercenkent szolal meg.
unsigned long utolsoTingMs = 0;
const unsigned long TING_SZUNET_MS = 2000;

void tingHang() {
  unsigned long most = millis();
  if (utolsoTingMs != 0 && most - utolsoTingMs < TING_SZUNET_MS) return;
  utolsoTingMs = most;

  hangSzol(1760, 70);   // A6
  delay(40);
  hangSzol(2637, 110);  // E7
}

// ----------------------- bejovo allapot -----------------------

// A fogado oldal (app vagy weboldal) visszakuldheti a valos lejatszasi allapotot.
// Igy a LED akkor is helyes marad, ha a felhasznalo a kepernyon allitja meg a zenet.
void allapotFeldolgoz(const String &nyers) {
  String p = nyers;
  p.trim();
  p.toUpperCase();
  if (p.length() == 0) return;

  if (p == "PLAYING" || p == "PLAY" || p == "1") {
    zeneSzol = true;
    ledFrissit();
    Serial.println("<- allapot: zene szol");
  } else if (p == "STOPPED" || p == "STOP" || p == "PAUSED" || p == "0") {
    zeneSzol = false;
    ledFrissit();
    Serial.println("<- allapot: zene all");
  } else if (p == "PING") {
    // eletjel, nincs teendo
  } else {
    Serial.print("<- ismeretlen uzenet: ");
    Serial.println(p);
  }
}

class AstheticRxCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *pCharacteristic) override {
    bleUzenet = pCharacteristic->getValue();
    bleUzenetErkezett = true;
  }
};

class AstheticServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer *server) override {
    bleClientConnected = true;
    tingKert = true;
    Serial.println("BLE kliens csatlakozott (weboldal)");
  }

  void onDisconnect(BLEServer *server) override {
    bleClientConnected = false;
    zeneSzol = false;
    Serial.println("BLE kliens lecsatlakozott, hirdetes ujraindul");
    server->startAdvertising();
  }
};

// ----------------------- setup -----------------------

void setup() {
  Serial.begin(115200);

  pinMode(STOP_BUTTON_PIN, INPUT_PULLDOWN);
  pinMode(PLAY_BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);
  digitalWrite(BUZZER_PIN, BUZZER_NYUGALMI_SZINT);   // hajtott szint, hogy ne kattogjon

  for (int i = 0; i < SZABAD_LABAK_SZAMA; i++) {
    pinMode(SZABAD_LABAK[i], OUTPUT);
    digitalWrite(SZABAD_LABAK[i], LOW);
  }

  // 1) Klasszikus Bluetooth SPP a Kodular apphoz (dual-mode inditas)
  SerialBT.begin(DEVICE_NAME);

  // 2) BLE GATT szerver a weboldalhoz
  BLEDevice::init(DEVICE_NAME);
  BLEServer *server = BLEDevice::createServer();
  server->setCallbacks(new AstheticServerCallbacks());

  BLEService *service = server->createService(NUS_SERVICE_UUID);
  txCharacteristic = service->createCharacteristic(NUS_TX_CHAR_UUID, BLECharacteristic::PROPERTY_NOTIFY);
  txCharacteristic->addDescriptor(new BLE2902());

  BLECharacteristic *rxCharacteristic = service->createCharacteristic(
    NUS_RX_CHAR_UUID, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rxCharacteristic->setCallbacks(new AstheticRxCallbacks());

  service->start();

  BLEAdvertising *advertising = BLEDevice::getAdvertising();
  advertising->addServiceUUID(NUS_SERVICE_UUID);
  advertising->setScanResponse(true);
  BLEDevice::startAdvertising();

  Serial.printf("Elindulva. Eszkoznev: %s\n", DEVICE_NAME);
  Serial.println("NAGY gomb (GPIO23) = STOP, kis gomb (GPIO25) = PLAY");
  Serial.println("Klasszikus BT (app) + BLE (weboldal) egyszerre aktiv.");

  // Indulasi hangjelzes: ebbol hallatszik, hogy a buzzer a jo labon van.
  tingHang();
}

// ----------------------- kuldes -----------------------

void parancsKuld(const char *parancs) {
  bool elment = false;

  if (SerialBT.hasClient()) {
    SerialBT.println(parancs);
    elment = true;
  }

  if (bleClientConnected && txCharacteristic != nullptr) {
    txCharacteristic->setValue((uint8_t *)parancs, strlen(parancs));
    txCharacteristic->notify();
    elment = true;
  }

  if (elment) {
    Serial.printf("-> %s elkuldve\n", parancs);
  } else {
    Serial.printf("Gomb megnyomva (%s), de nincs csatlakozott kliens\n", parancs);
  }
}

// ----------------------- loop -----------------------

void loop() {
  unsigned long most = millis();

  // --- klasszikus BT csatlakozas figyelese (a "ting" hanghoz) ---
  bool sppMost = SerialBT.hasClient();
  if (sppMost && !sppVoltCsatlakozva) {
    Serial.println("Klasszikus BT kliens csatlakozott (app)");
    tingKert = true;
  } else if (!sppMost && sppVoltCsatlakozva) {
    Serial.println("Klasszikus BT kliens lecsatlakozott");
    if (!bleClientConnected) zeneSzol = false;
  }
  sppVoltCsatlakozva = sppMost;

  if (tingKert) {
    tingKert = false;
    tingHang();
  }

  // --- NAGY gomb: STOP (felfuto el, mert nyomaskor 3.3V-ra huz) ---
  bool stopMost = digitalRead(STOP_BUTTON_PIN);
  if (stopElozo == LOW && stopMost == HIGH && most - stopUtolsoMs > DEBOUNCE_MS) {
    stopUtolsoMs = most;
    parancsKuld("STOP");
    zeneSzol = false;  // azonnali visszajelzes, a fogado oldal ezt megerositi
  }
  stopElozo = stopMost;

  // --- KIS gomb: PLAY (lefuto el, mert nyomaskor GND-re huz) ---
  bool playMost = digitalRead(PLAY_BUTTON_PIN);
  if (playElozo == HIGH && playMost == LOW && most - playUtolsoMs > DEBOUNCE_MS) {
    playUtolsoMs = most;
    parancsKuld("PLAY");
    zeneSzol = true;
  }
  playElozo = playMost;

  // --- bejovo allapotuzenetek ---
  if (bleUzenetErkezett) {
    bleUzenetErkezett = false;
    allapotFeldolgoz(bleUzenet);
  }

  while (SerialBT.available()) {
    String sor = SerialBT.readStringUntil('\n');
    allapotFeldolgoz(sor);
  }

  ledFrissit();
  delay(10);
}
