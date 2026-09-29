/* ═══════════════════════════════════════════════════════════════
   ASTHETIC — Rubik-Bingó: a játékvezetés

   Egyetlen készüléken fut, az „asztalon”: helyi játéknál ez az egyetlen
   telefon, online játéknál a szobavezetőé. Minden döntés itt születik: a kerék
   színe, a dal, a lecsapás, a tippek értékelése, az ikszelés és a győzelem.
   Kifelé csak két dolgot ad: a nyilvános állapotot (ezt mindenki látja) és a
   titkos állapotot (a dal adatai — kör közben csak az asztal ismeri).

   A tárolásról nem tud: helyi játéknál a képernyő közvetlenül rajzol belőle,
   online a js/bingo-firestore.js írja ki. Az időt és az időzítőt kívülről
   kapja, így Node-ban gyorsított órával is tesztelhető.
   ═══════════════════════════════════════════════════════════════ */

(function (globalis, keszit) {
  if (typeof module !== 'undefined' && module.exports) module.exports = keszit(require('./bingomotor.js'));
  else globalis.AstheticBingoAsztal = keszit(globalis.AstheticBingo);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (B) {
  'use strict';

  const PORGETES_MS = 4200;
  const MINDENKI_KESZ_MS = 700;
  const JELOLES_MS = 25000;
  const MAX_JATEKOS = 12;

  const valosOra = {
    most: () => Date.now(),
    utemez: (fn, ms) => setTimeout(fn, ms),
    torol: (azon) => clearTimeout(azon),
  };

  const masol = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

  class Asztal {
    /**
     * @param opts.songs      a daladatbázis
     * @param opts.valtozas   ({ publikus, titkos }) => void — minden változás után
     * @param opts.ora        { most, utemez, torol } — alapból a valódi óra
     */
    constructor({ kod, hostUid = null, beallitas, songs, valtozas, ora = valosOra, azonosito }) {
      this.songs = songs;
      this.valtozas = valtozas || (() => {});
      this.ora = ora;
      this.ujAzon = azonosito || (() => Math.random().toString(36).slice(2, 10));
      this.idozito = null;
      this.vegIdo = null;
      this.maradtMs = null;
      this.tippek = {};
      this.lecsaptak = [];

      this.p = {
        kod,
        hostUid,
        allapot: 'lobby',
        beallitas: B.tisztitBeallitas(beallitas),
        kor: 0,
        jatekosok: [],
        fazis: null,
        szin: null,
        idoAzon: 0,
        hatralevoMs: null,
        teljesMs: null,
        lecsapas: null,
        bekuldtek: [],
        kiesettek: [],
        eredmeny: null,
        nyertesek: [],
        hasznaltDalok: [],
        uzenet: null,
      };
      this.t = { kor: 0, dal: null };
    }

    /* ───────────── kifelé ───────────── */

    kuld() {
      const most = this.ora.most();
      if (this.vegIdo !== null) this.p.hatralevoMs = Math.max(0, this.vegIdo - most);
      this.p.iroMs = most;
      this.valtozas({ publikus: masol(this.p), titkos: masol(this.t) });
    }

    idozit(ms, fn) {
      if (this.idozito !== null) this.ora.torol(this.idozito);
      this.idozito = null;
      this.vegIdo = null;
      if (ms === null) {
        if (this.p.hatralevoMs !== null) { this.p.hatralevoMs = null; this.p.idoAzon++; }
        return;
      }
      this.vegIdo = this.ora.most() + ms;
      this.p.teljesMs = ms;
      this.p.idoAzon++;
      this.idozito = this.ora.utemez(() => { this.idozito = null; fn(); }, ms);
    }

    leallit() {
      this.idozit(null);
    }

    jatszok() {
      return this.p.jatekosok.filter((j) => !j.nezo);
    }

    jatekos(id) {
      return this.p.jatekosok.find((j) => j.id === id) || null;
    }

    /** Akik ebben a körben még tippelhetnek: játszanak, és nem buktak el lecsapással. */
    aktivak() {
      return this.jatszok().filter((j) => !this.p.kiesettek.includes(j.id));
    }

    /* ───────────── játékosok ───────────── */

    jatekosFelvesz({ uid = null, nev, kep = null, host = false, nezo = false }) {
      if (uid) {
        const meglevo = this.p.jatekosok.find((j) => j.uid === uid);
        if (meglevo) return meglevo.id;
      }
      if (this.p.jatekosok.length >= MAX_JATEKOS) throw new Error('Az asztal megtelt.');
      if (this.p.allapot === 'vege') throw new Error('Ez a játék már véget ért.');

      const j = { id: this.ujAzon(), uid, nev: B.tisztitNev(nev), kep: B.tisztitKep(kep), host, nezo, kartya: null, jelolt: null };
      // Játék közben érkezőnek is jár kártya — a következő körtől játszik.
      if (!nezo && this.p.allapot !== 'lobby') this.kartyatOszt(j);
      this.p.jatekosok.push(j);
      this.kuld();
      return j.id;
    }

    jatekosTorol(uid) {
      const elotte = this.p.jatekosok.length;
      this.p.jatekosok = this.p.jatekosok.filter((j) => j.uid !== uid || j.host);
      if (this.p.jatekosok.length === elotte) return;
      if (this.p.allapot === 'kor' && this.p.fazis === 'szol') this.mindenkiKeszE();
      this.kuld();
    }

    kartyatOszt(j) {
      j.kartya = B.kartyaKeszit();
      j.jelolt = Array(25).fill(0);
    }

    /* ───────────── menet ───────────── */

    indit() {
      if (this.p.allapot !== 'lobby') throw new Error('A játék már elindult.');
      if (!this.jatszok().length) throw new Error('Legalább egy játékos kell.');
      this.jatszok().forEach((j) => this.kartyatOszt(j));
      this.p.kor = 0;
      this.p.nyertesek = [];
      this.ujKor();
    }

    /**
     * Új kör: pörög a kerék, aztán szól a dal. Kihagyásnál (rossz videó) a kör
     * száma és a szín marad, csak másik dal jön, és nincs újabb pörgetés.
     */
    ujKor({ kihagyas = false } = {}) {
      const dal = B.dalValaszt(this.songs, this.p.beallitas, this.p.hasznaltDalok);
      if (!dal) { this.vege('Elfogytak a dalok ebből a korszakból.'); return; }

      this.p.hasznaltDalok.push(dal.id);
      if (!kihagyas) {
        this.p.kor += 1;
        this.p.szin = B.szinSorsol(this.p.beallitas);
      }
      this.t = {
        kor: this.p.kor,
        dal: { id: dal.id, eloado: dal.artist, cim: dal.title, cimEredeti: dal.titleOriginal || dal.title, ev: dal.year },
        videoId: dal.videoId,
        kezdesMp: this.p.beallitas.kezdesMp,
        zeneAzon: this.p.kor + ':' + dal.id,
      };
      this.tippek = {};
      this.lecsaptak = [];
      this.maradtMs = null;
      Object.assign(this.p, {
        allapot: 'kor',
        lecsapas: null,
        bekuldtek: [],
        kiesettek: [],
        eredmeny: null,
        uzenet: null,
      });

      if (kihagyas) { this.szolIndit(); return; }
      this.p.fazis = 'porget';
      this.idozit(PORGETES_MS, () => this.szolIndit());
      this.kuld();
    }

    szolIndit() {
      this.p.fazis = 'szol';
      this.idozit(this.p.beallitas.valaszIdoMp * 1000, () => this.korVege());
      this.kuld();
    }

    dalKihagy() {
      if (this.p.allapot !== 'kor') return;
      this.ujKor({ kihagyas: true });
    }

    /* ───────────── tippek és lecsapás ───────────── */

    tipp(jatekosId, { eloado, cim } = {}) {
      if (this.p.allapot !== 'kor') return false;
      const j = this.jatekos(jatekosId);
      if (!j || j.nezo || this.p.kiesettek.includes(jatekosId)) return false;

      const tipp = { eloado: B.tisztitTipp(eloado), cim: B.tisztitTipp(cim) };

      // Lecsapás alatt csak a lecsapó írhat — a többieknek megáll az idő.
      if (this.p.fazis === 'lecsap') {
        if (!this.p.lecsapas || this.p.lecsapas.jatekosId !== jatekosId) return false;
        this.lecsapErtekel(tipp);
        return true;
      }
      if (this.p.fazis !== 'szol') return false;

      this.tippek[jatekosId] = { ...tipp, lecsap: false };
      if (!this.p.bekuldtek.includes(jatekosId)) this.p.bekuldtek.push(jatekosId);
      this.mindenkiKeszE();
      this.kuld();
      return true;
    }

    mindenkiKeszE() {
      const aktivak = this.aktivak();
      if (!this.p.beallitas.mindenkiUtanTovabb || !aktivak.length) return;
      if (aktivak.every((j) => this.p.bekuldtek.includes(j.id))) {
        this.idozit(MINDENKI_KESZ_MS, () => this.korVege());
      }
    }

    lecsap(jatekosId) {
      const b = this.p.beallitas;
      if (this.p.allapot !== 'kor' || this.p.fazis !== 'szol' || !b.lecsapas) return false;
      const j = this.jatekos(jatekosId);
      if (!j || j.nezo) return false;
      if (this.p.kiesettek.includes(jatekosId) || this.lecsaptak.includes(jatekosId)) return false;

      this.maradtMs = Math.max(1000, this.vegIdo - this.ora.most());
      this.lecsaptak.push(jatekosId);
      this.p.fazis = 'lecsap';
      this.p.lecsapas = { jatekosId, nev: j.nev };
      this.idozit(b.lecsapIdoMp * 1000, () => this.lecsapErtekel(null));
      this.kuld();
      return true;
    }

    lecsapErtekel(tipp) {
      const lecsapo = this.p.lecsapas && this.p.lecsapas.jatekosId;
      if (this.p.fazis !== 'lecsap' || !lecsapo) return;

      const t = tipp || { eloado: '', cim: '' };
      this.tippek[lecsapo] = { ...t, lecsap: true };
      if (!this.p.bekuldtek.includes(lecsapo)) this.p.bekuldtek.push(lecsapo);

      if (B.tippErtekel(t, this.dalAdat(), this.p.beallitas).jo) {
        this.korVege();
        return;
      }

      // Rossz tipp: a lecsapó ebből a körből kiesik, a többieknek szól tovább a dal.
      this.p.kiesettek.push(lecsapo);
      this.p.lecsapas = null;
      this.p.fazis = 'szol';
      if (!this.aktivak().length) { this.korVege(); return; }
      this.idozit(this.maradtMs, () => this.korVege());
      this.mindenkiKeszE();
      this.kuld();
    }

    dalAdat() {
      const d = this.t.dal;
      return { artist: d.eloado, title: d.cim, titleOriginal: d.cimEredeti };
    }

    /* ───────────── kiértékelés és ikszelés ───────────── */

    korVege() {
      if (this.p.allapot !== 'kor') return;
      const dal = this.dalAdat();
      const lecsapo = this.p.lecsapas && this.p.lecsapas.jatekosId;

      const tippek = [];
      const jogok = {};
      for (const j of this.jatszok()) {
        const t = this.tippek[j.id] || null;
        const kiesett = this.p.kiesettek.includes(j.id);
        const e = t ? B.tippErtekel(t, dal, this.p.beallitas) : { eloadoJo: false, cimJo: false, jo: false };
        const jo = e.jo && !kiesett;
        tippek.push({
          jatekosId: j.id,
          nev: j.nev,
          eloado: t ? t.eloado : '',
          cim: t ? t.cim : '',
          eloadoJo: e.eloadoJo,
          cimJo: e.cimJo,
          jo,
          lecsap: Boolean(t && t.lecsap),
          kiesett,
          kuldott: Boolean(t),
        });
        if (jo) jogok[j.id] = j.id === lecsapo ? 'joker' : 'szin';
      }

      this.p.allapot = 'eredmeny';
      this.p.fazis = null;
      this.p.lecsapas = null;
      this.p.eredmeny = {
        dal: { eloado: this.t.dal.eloado, cim: this.t.dal.cim, ev: this.t.dal.ev },
        szin: this.p.szin,
        tippek,
        jogok,
        jelolesek: {},
      };
      if (Object.keys(jogok).length) this.idozit(JELOLES_MS, () => this.jelolesLezar());
      else this.idozit(null);
      this.kuld();
    }

    jogosultak() {
      const e = this.p.eredmeny;
      return e ? Object.keys(e.jogok) : [];
    }

    jelol(jatekosId, mezo) {
      const e = this.p.eredmeny;
      if (this.p.allapot !== 'eredmeny' || !e) return false;
      const jog = e.jogok[jatekosId];
      const j = this.jatekos(jatekosId);
      if (!jog || !j || e.jelolesek[jatekosId] !== undefined) return false;

      const mezoSzam = Number(mezo);
      if (!B.jelolhetoMezok(j.kartya, j.jelolt, jog, this.p.szin).includes(mezoSzam)) return false;

      j.jelolt[mezoSzam] = 1;
      e.jelolesek[jatekosId] = mezoSzam;
      if (this.jogosultak().every((id) => e.jelolesek[id] !== undefined)) {
        this.idozit(null);
        if (this.nyertesKeres()) return true;
      }
      this.kuld();
      return true;
    }

    /** Aki időben nem választott, annak a legjobb mezőt ikszeljük be. */
    jelolesLezar() {
      const e = this.p.eredmeny;
      if (this.p.allapot !== 'eredmeny' || !e) return;
      for (const id of this.jogosultak()) {
        if (e.jelolesek[id] !== undefined) continue;
        const j = this.jatekos(id);
        if (!j) continue;
        const mezo = B.legjobbMezo(j.kartya, j.jelolt, e.jogok[id], this.p.szin);
        if (mezo === null) continue;
        j.jelolt[mezo] = 1;
        e.jelolesek[id] = mezo;
        e.automatikus = [...(e.automatikus || []), id];
      }
      this.idozit(null);
      if (this.nyertesKeres()) return;
      this.kuld();
    }

    /**
     * A szobavezető felülbírálhatja a gép döntését — pl. elfogad egy olyan
     * elírást, amit a gép már nem ismert fel. Ha már ikszelt, visszavesszük.
     */
    felulbiral(jatekosId, jo) {
      const e = this.p.eredmeny;
      if (this.p.allapot !== 'eredmeny' || !e) return false;
      const sor = e.tippek.find((t) => t.jatekosId === jatekosId);
      const j = this.jatekos(jatekosId);
      if (!sor || !j) return false;

      sor.jo = Boolean(jo);
      sor.felulbiralva = true;
      if (jo && !e.jogok[jatekosId]) {
        e.jogok[jatekosId] = sor.lecsap ? 'joker' : 'szin';
        if (this.vegIdo === null) this.idozit(JELOLES_MS, () => this.jelolesLezar());
      }
      if (!jo && e.jogok[jatekosId]) {
        delete e.jogok[jatekosId];
        const mezo = e.jelolesek[jatekosId];
        if (mezo !== undefined) { j.jelolt[mezo] = 0; delete e.jelolesek[jatekosId]; }
        if (!this.jogosultak().some((id) => e.jelolesek[id] === undefined)) this.idozit(null);
      }
      this.kuld();
      return true;
    }

    kovetkezo() {
      if (this.p.allapot !== 'eredmeny') return;
      this.jelolesLezar();
      if (this.p.allapot !== 'eredmeny') return;
      this.ujKor();
    }

    nyertesKeres() {
      const nyertesek = this.jatszok().filter((j) => j.jelolt && B.bingoE(j.jelolt)).map((j) => j.id);
      if (!nyertesek.length) return false;
      this.vege(null, nyertesek);
      return true;
    }

    vege(uzenet, nyertesek = []) {
      this.idozit(null);
      this.p.allapot = 'vege';
      this.p.fazis = null;
      this.p.lecsapas = null;
      this.p.nyertesek = nyertesek;
      this.p.uzenet = uzenet || null;
      this.kuld();
    }

    ujra() {
      if (this.p.allapot !== 'vege') return;
      this.idozit(null);
      this.p.jatekosok.forEach((j) => { j.kartya = null; j.jelolt = null; });
      Object.assign(this.p, {
        allapot: 'lobby', kor: 0, fazis: null, szin: null, eredmeny: null,
        nyertesek: [], bekuldtek: [], kiesettek: [], lecsapas: null, uzenet: null,
      });
      this.kuld();
    }

    /* ───────────── újratöltés után ───────────── */

    /**
     * A szobavezető frissítette az oldalt: a kiírt állapotból folytatjuk. A
     * futó időzítő elveszett, ezért a hátralévő időt a kiírás pillanatából
     * számoljuk újra (ugyanazon a készüléken, tehát ugyanazzal az órával).
     */
    visszaallit(publikus, titkos, tippek) {
      this.p = masol(publikus);
      this.t = masol(titkos) || { kor: 0, dal: null };
      this.tippek = masol(tippek) || {};
      this.lecsaptak = [];
      const eltelt = Math.max(0, this.ora.most() - (publikus.iroMs || this.ora.most()));
      const maradt = Math.max(1000, (publikus.hatralevoMs || 0) - eltelt);

      if (this.p.allapot === 'kor') {
        if (!this.t.dal || this.t.kor !== this.p.kor) { this.ujKor(); return; }
        if (this.p.fazis === 'porget') { this.szolIndit(); return; }
        if (this.p.fazis === 'lecsap') {
          // A lecsapás félbeszakadt: a lecsapó nem veszít, szól tovább a dal.
          this.p.fazis = 'szol';
          this.p.lecsapas = null;
        }
        this.idozit(maradt, () => this.korVege());
        this.kuld();
        return;
      }
      if (this.p.allapot === 'eredmeny' && this.jogosultak().some((id) => this.p.eredmeny.jelolesek[id] === undefined)) {
        this.idozit(maradt, () => this.jelolesLezar());
      }
      this.kuld();
    }
  }

  return { Asztal, PORGETES_MS, JELOLES_MS, MINDENKI_KESZ_MS, MAX_JATEKOS };
});
