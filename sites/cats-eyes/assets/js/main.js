/* ============================================================
   Cat's Eyes Studio — interactions
   Vanilla JS, aucune dépendance.
   ============================================================ */
(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- 1. En-tête : fond opaque au défilement ---------- */
  var header = document.getElementById('header');

  function onScroll() {
    header.classList.toggle('is-stuck', window.scrollY > 40);
  }
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* ---------- 2. Menu mobile ---------- */
  var burger = document.getElementById('burger');
  var nav = document.getElementById('nav');

  function setMenu(open) {
    nav.classList.toggle('is-open', open);
    burger.classList.toggle('is-open', open);
    header.classList.toggle('menu-open', open); // garde le logo lisible sur l'overlay
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Fermer le menu' : 'Ouvrir le menu');
    document.body.style.overflow = open ? 'hidden' : '';
  }

  burger.addEventListener('click', function () {
    setMenu(!nav.classList.contains('is-open'));
  });

  nav.addEventListener('click', function (e) {
    if (e.target.closest('a')) setMenu(false);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && nav.classList.contains('is-open')) {
      setMenu(false);
      burger.focus();
    }
  });

  // Le menu plein écran ne doit pas rester ouvert si on repasse en desktop.
  window.matchMedia('(min-width: 861px)').addEventListener('change', function (e) {
    if (e.matches) setMenu(false);
  });

  /* ---------- 3. Photos : chargement avec repli sur le dégradé ----------
     Chaque bloc .media[data-img] tente de charger sa photo. Tant que le
     fichier n'existe pas dans assets/img/, le dégradé nude du CSS reste
     affiché : le site n'est jamais « cassé ».                          */
  function loadMedia(el) {
    var src = el.getAttribute('data-img');
    if (!src) return;
    var probe = new Image();
    probe.onload = function () {
      el.style.setProperty('--img', 'url("' + src + '")');
      el.classList.add('is-loaded');
    };
    probe.src = src;
  }

  var mediaEls = Array.prototype.slice.call(document.querySelectorAll('.media[data-img]'));

  if ('IntersectionObserver' in window) {
    var mediaObserver = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        loadMedia(entry.target);
        obs.unobserve(entry.target);
      });
    }, { rootMargin: '300px' });
    mediaEls.forEach(function (el) { mediaObserver.observe(el); });
  } else {
    mediaEls.forEach(loadMedia);
  }

  /* ---------- 4. Apparition des blocs au défilement ---------- */
  var revealEls = Array.prototype.slice.call(document.querySelectorAll('.reveal'));

  if (reduceMotion || !('IntersectionObserver' in window)) {
    revealEls.forEach(function (el) { el.classList.add('is-visible'); });
  } else {
    var revealObserver = new IntersectionObserver(function (entries, obs) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        obs.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    revealEls.forEach(function (el) { revealObserver.observe(el); });
  }

  /* ---------- 5. Lien de navigation actif selon la section visible ---------- */
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.nav ul a[href^="#"]'));
  var sections = navLinks
    .map(function (link) { return document.querySelector(link.getAttribute('href')); })
    .filter(Boolean);

  if ('IntersectionObserver' in window && sections.length) {
    var spy = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        navLinks.forEach(function (link) {
          link.classList.toggle('is-active', link.getAttribute('href') === '#' + entry.target.id);
        });
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(function (s) { spy.observe(s); });
  }

  /* ---------- 6. Année du copyright ---------- */
  var year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();
})();
