/* Logo marquee: turns every .wst-logos row into a continuous right-to-left loop
   with faded edges, pausing on hover. With reduced motion (or without JS) the
   logos stay a static, centered row. Mirrors the behavior of the original site. */
(function () {
  'use strict';

  var CONFIG = { root: '.wst-home .wst-logos', speed: 125 }; // px per second

  function whenImagesReady(imgs, cb) {
    var pending = 0;
    Array.prototype.forEach.call(imgs, function (img) {
      if (img.loading === 'lazy') img.loading = 'eager';
      if (img.complete && img.naturalWidth) return;
      pending++;
      var done = function () { if (--pending === 0) cb(); };
      img.addEventListener('load', done, { once: true });
      img.addEventListener('error', done, { once: true });
    });
    if (pending === 0) cb();
  }

  function setup(root) {
    var originals = Array.prototype.slice.call(root.children);
    if (originals.length < 2) return;

    var gap = getComputedStyle(root).columnGap;
    if (!gap || gap === 'normal') gap = '62px';

    var track = document.createElement('div');
    track.className = 'wst-marquee-track';
    originals.forEach(function (el) { track.appendChild(el); });
    root.appendChild(track);
    root.style.setProperty('--wst-marquee-gap', gap);
    root.classList.add('is-marquee');

    function addCopy() {
      originals.forEach(function (el) {
        var c = el.cloneNode(true);
        c.setAttribute('aria-hidden', 'true');
        c.classList.add('wst-marquee-clone');
        Array.prototype.forEach.call(c.querySelectorAll('img'), function (img) {
          img.alt = '';
          img.loading = 'eager';
        });
        track.appendChild(c);
      });
    }

    function measure() {
      if (!track.querySelector('.wst-marquee-clone')) addCopy();
      var distance = track.querySelector('.wst-marquee-clone').offsetLeft - originals[0].offsetLeft;
      var needed = Math.ceil(root.clientWidth / distance) + 1;
      var sets = track.querySelectorAll('.wst-marquee-clone').length / originals.length + 1;
      while (sets < needed + 1) { addCopy(); sets++; }
      root.style.setProperty('--wst-marquee-distance', distance + 'px');
      root.style.setProperty('--wst-marquee-duration', (distance / CONFIG.speed).toFixed(2) + 's');
    }

    measure();
    var t;
    window.addEventListener('resize', function () {
      clearTimeout(t);
      t = setTimeout(measure, 150);
    });
  }

  function init() {
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var rows = document.querySelectorAll(CONFIG.root);
    Array.prototype.forEach.call(rows, function (root) {
      if (root.classList.contains('is-marquee')) return;
      whenImagesReady(root.querySelectorAll('img'), function () { setup(root); });
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
