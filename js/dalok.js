// A dallista betöltése
//
// A játékok (Kvízcsata, Rubik-Bingó) a Firestore-ban tárolt listából
// dolgoznak, amit az admin oldalon (admin.html) lehet szerkeszteni. Ha az nem
// érhető el, a weboldallal együtt kiszállított adatbazis/songs.json marad.
//
// A lista egyetlen dokumentumban van, JSON-szövegként (dalok/lista): így egy
// olvasás az egész, és a Firestore sem indexeli dalonként a mezőket.

(function () {
  'use strict';

  let igeret = null;

  function idokorlat(p, ms) {
    return Promise.race([p, new Promise((_, h) => setTimeout(() => h(new Error('időtúllépés')), ms))]);
  }

  async function firestorebol() {
    const fb = window.firebase;
    if (!fb || !fb.firestore || !window.ASTHETIC || !window.ASTHETIC.firebaseIndit) return null;
    window.ASTHETIC.firebaseIndit();
    const d = await idokorlat(fb.firestore().collection('dalok').doc('lista').get(), 10000);
    if (!d.exists) return null;
    const adat = d.data();
    const lista = JSON.parse(adat.json || '[]');
    return Array.isArray(lista) && lista.length ? { lista, meta: { ...adat, json: undefined } } : null;
  }

  async function fajlbol() {
    const v = await fetch('adatbazis/songs.json');
    if (!v.ok) throw new Error('A dalok adatbázisa nem érhető el.');
    return { lista: await v.json(), meta: { forras: 'beepitett' } };
  }

  /** @returns {Promise<{lista, meta}>} */
  function betoltReszletesen({ friss = false } = {}) {
    if (!igeret || friss) {
      igeret = (async () => {
        try {
          const f = await firestorebol();
          if (f) return f;
        } catch (e) {
          console.warn('A dallista a Firestore-ból nem töltődött be, marad a beépített:', e && e.message);
        }
        return fajlbol();
      })();
      igeret.catch(() => { igeret = null; });
    }
    return igeret;
  }

  window.AstheticDalok = {
    betolt: () => betoltReszletesen().then((x) => x.lista),
    betoltReszletesen,
    beepitett: () => fajlbol().then((x) => x.lista),
  };
})();
