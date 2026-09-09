/* ═══════════════════════════════════════════════════════════════
   ASTHETIC GAME — közös felületi viselkedések
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ───────────── Téma: világos / sötét ─────────────
   A kezdeti beállítást már a fejlécbe ágyazott kis szkript elvégzi, hogy ne
   villanjon fel a rossz szín. Itt csak a kapcsolgatás és a mentés történik. */

const THEME_KEY = 'asthetic-theme';
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');

function storedTheme() {
  try { return localStorage.getItem(THEME_KEY); } catch { return null; }
}

function activeTheme() {
  const explicit = document.documentElement.getAttribute('data-theme');
  return explicit || (systemDark.matches ? 'dark' : 'light');
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* privát mód */ }

  const toggle = document.getElementById('themeToggle');
  if (toggle) toggle.setAttribute('aria-pressed', String(theme === 'dark'));
}

const themeToggle = document.getElementById('themeToggle');
if (themeToggle) {
  themeToggle.setAttribute('aria-pressed', String(activeTheme() === 'dark'));
  themeToggle.addEventListener('click', () => {
    applyTheme(activeTheme() === 'dark' ? 'light' : 'dark');
  });
}

// Ha a látogató nem választott kézzel, kövessük a rendszer beállítását
systemDark.addEventListener('change', () => {
  if (storedTheme()) return;
  if (themeToggle) themeToggle.setAttribute('aria-pressed', String(systemDark.matches));
});

/* ───────────── Évszám a láblécben ───────────── */

const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

/* ───────────── Fejléc + görgetésjelző ───────────── */

const header = document.getElementById('siteHeader');
const progress = document.getElementById('progress');

function onScroll() {
  const y = window.scrollY;
  if (header) header.classList.toggle('is-stuck', y > 8);
  if (progress) {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    progress.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
  }
}
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

/* ───────────── Mobilmenü ───────────── */

const navToggle = document.getElementById('navToggle');
const navLinks = document.getElementById('navLinks');

if (navToggle && navLinks) {
  navToggle.addEventListener('click', () => {
    const open = navLinks.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', String(open));
  });
  navLinks.addEventListener('click', (e) => {
    if (e.target.tagName === 'A') {
      navLinks.classList.remove('is-open');
      navToggle.setAttribute('aria-expanded', 'false');
    }
  });
}

/* ───────────── Címsor szavakra bontása ───────────── */

document.querySelectorAll('[data-split]').forEach((el) => {
  if (reduceMotion) return;
  const words = el.textContent.trim().split(/\s+/);
  // Ettől a szótól kezdve kiemelt színt kap a szöveg (a data-em-from adja meg).
  const emphasisFrom = el.dataset.emFrom !== undefined ? Number(el.dataset.emFrom) : -1;

  el.textContent = '';
  words.forEach((word, i) => {
    const outer = document.createElement('span');
    outer.className = 'word';
    outer.style.setProperty('--w', i);

    const inner = document.createElement('span');
    inner.textContent = word;
    if (emphasisFrom >= 0 && i >= emphasisFrom) inner.style.color = 'var(--accent)';

    outer.appendChild(inner);
    el.appendChild(outer);
    if (i < words.length - 1) el.appendChild(document.createTextNode(' '));
  });
});

/* ───────────── Görgetéses megjelenés ───────────── */

const revealables = document.querySelectorAll('.reveal');

if (reduceMotion || !('IntersectionObserver' in window)) {
  revealables.forEach((el) => el.classList.add('is-in'));
} else {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      }
    });
  }, { rootMargin: '0px 0px -10% 0px', threshold: 0.05 });

  revealables.forEach((el) => observer.observe(el));

  // Biztonsági háló: ha a megfigyelő valamiért nem szólal meg (pl. a lap nem
  // rajzolódik, mert háttérben van), a képernyőn lévő tartalmat így is megmutatjuk.
  setTimeout(() => {
    revealables.forEach((el) => {
      if (el.classList.contains('is-in')) return;
      const rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight && rect.bottom > 0) {
        el.classList.add('is-in');
        observer.unobserve(el);
      }
    });
  }, 2500);
}

/* ───────────── Gombhullám ───────────── */

document.addEventListener('pointerdown', (e) => {
  const btn = e.target.closest('.btn, .status__pill');
  if (!btn || reduceMotion) return;
  const rect = btn.getBoundingClientRect();
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  const size = Math.max(rect.width, rect.height) * 2.4;
  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${e.clientX - rect.left}px`;
  ripple.style.top = `${e.clientY - rect.top}px`;
  btn.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
});

/* ───────────── Harmonika (GYIK és szabályok) ───────────── */

function setupAccordion(root) {
  const buttons = root.querySelectorAll('[aria-controls]');

  buttons.forEach((button) => {
    const panel = document.getElementById(button.getAttribute('aria-controls'));
    const item = button.closest('.faq__item, .rule');
    if (!panel || !item) return;

    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!open));
      item.classList.toggle('is-open', !open);
    });
  });
}

document.querySelectorAll('[data-accordion]').forEach(setupAccordion);

// Ha az URL egy szabálypontra mutat (pl. #rablas), nyissuk is ki
function openFromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) return;
  const target = document.getElementById(id);
  if (!target) return;
  const button = target.querySelector('[aria-controls]');
  if (button && button.getAttribute('aria-expanded') === 'false') {
    button.click();
    setTimeout(() => target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' }), 60);
  }
}
window.addEventListener('hashchange', openFromHash);
openFromHash();

/* ───────────── Egyszeri adatkezelési tájékoztatás ─────────────
   A játék maga nem használ sütiket és nem követ. A YouTube viszont
   a lejátszás pillanatában adatot tárol, ezért erről egyszer szólunk. */

const NOTICE_KEY = 'asthetic-notice-v1';

function readNoticeFlag() {
  try { return localStorage.getItem(NOTICE_KEY); } catch { return 'skip'; }
}

if (!readNoticeFlag()) {
  const bar = document.createElement('div');
  bar.className = 'notice';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Adatkezelési tájékoztatás');
  bar.innerHTML = `
    <p>Ez az oldal nem használ követő sütiket. A dalok viszont a YouTube-ról szólnak,
       ezért a lejátszás indításakor a YouTube adatokat tárolhat a böngésződben.
       <a href="adatvedelem.html">Részletek</a></p>
    <button class="btn btn--sm" type="button">Rendben</button>`;
  document.body.appendChild(bar);

  requestAnimationFrame(() => bar.classList.add('is-in'));

  bar.querySelector('button').addEventListener('click', () => {
    try { localStorage.setItem(NOTICE_KEY, '1'); } catch { /* privát mód — nem gond */ }
    bar.classList.remove('is-in');
    bar.addEventListener('transitionend', () => bar.remove(), { once: true });
  });
}

/* ───────────── Kártyák fénykövetése ───────────── */

if (!reduceMotion) {
  document.querySelectorAll('.mode').forEach((card) => {
    card.addEventListener('pointermove', (e) => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', `${((e.clientX - rect.left) / rect.width) * 100}%`);
      card.style.setProperty('--my', `${((e.clientY - rect.top) / rect.height) * 100}%`);
    });
  });
}
