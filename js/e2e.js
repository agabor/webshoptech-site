/* E2E page scripts: (1) animated "Rendelés tesztelése" test-run mockup,
   (2) client logo marquee. Mirrors the behavior of the original site. */

/* ---- 1. Test-run mockup ------------------------------------------------ */
(function () {
  'use strict';

  var CONFIG = {
    root: '.os-page .os-report',
    row: '.os-row',
    speed: 4,            // the clock runs 4x faster (63 s of steps in ~16 s)
    threshold: 0.3,      // share of the card that must be visible to start
    startDelay: 400,
    stepGap: 250,
    resetTimers: true,
    animateTotal: true,
    progress: { enabled: true, keepWhenDone: true },
    loop: true,
    loopDelay: 3500,
    pattern: ['pass', 'fail', 'pass'],   // every third run fails
    fail: { step: 'Pénztár', at: 0.55, subtitle: 'Hiba a pénztárban – jelentés elküldve' },
    subtitle: { enabled: true, idle: 'Teszt indul…', running: 'Teszt folyamatban…', done: 'Sikeres teszt' }
  };

  var svg = function (inner) {
    return '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">' + inner + '</svg>';
  };
  var ICON = {
    todo: svg('<circle cx="8" cy="8" r="6.75" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".55"/><circle cx="8" cy="8" r="2.5" fill="currentColor"/>'),
    running: svg('<circle cx="8" cy="8" r="6.75" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".25"/><path d="M8 1.25A6.75 6.75 0 0 1 14.75 8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>'),
    done: svg('<circle cx="8" cy="8" r="8" fill="currentColor"/><path d="M4.6 8.3l2.2 2.2 4.6-4.8" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>'),
    fail: svg('<circle cx="8" cy="8" r="8" fill="currentColor"/><path d="M5.5 5.5l5 5M10.5 5.5l-5 5" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/>'),
    skipped: svg('<circle cx="8" cy="8" r="6.75" fill="none" stroke="currentColor" stroke-width="1.5" opacity=".55"/><path d="M5.5 8h5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>')
  };

  var TIME_RE = /^\s*(\d+(?:[.,]\d+)?)\s*(s|mp|sec|másodperc)?\.?\s*$/i;

  function textOf(el) { return (el.textContent || '').replace(/ /g, ' ').trim(); }

  // Replace the static "✓" mark with an icon holder and keep the step name.
  function makeStatus(label) {
    var mark = label.querySelector('mark');
    var holder = document.createElement('span');
    holder.className = 'wf-status';
    if (mark) label.replaceChild(holder, mark); else label.insertBefore(holder, label.firstChild);
    var next = holder.nextSibling;
    if (next && next.nodeType === 3) next.nodeValue = next.nodeValue.replace(/^[\s ✓✔]+/, '');
    return holder;
  }

  function buildSteps(root) {
    var steps = [];
    Array.prototype.forEach.call(root.querySelectorAll(CONFIG.row), function (row) {
      var ps = row.querySelectorAll('p');
      if (ps.length < 2) return;
      var timeNode = ps[ps.length - 1];
      var match = textOf(timeNode).match(TIME_RE);
      if (!match) return;
      row.classList.add('wf-row');
      ps[0].classList.add('wf-label');
      timeNode.classList.add('wf-time');
      steps.push({
        row: row, icon: makeStatus(ps[0]), timeNode: timeNode,
        seconds: parseFloat(match[1].replace(',', '.')), unit: match[2] || 's'
      });
    });
    return steps;
  }

  // Header = first block that is not a step row: "<strong>Title</strong><br>Subtitle" + total time.
  function findHeader(root) {
    var header = null;
    Array.prototype.some.call(root.children, function (child) {
      if (child.matches(CONFIG.row)) return false;
      if (child.querySelector('p')) { header = child; return true; }
      return false;
    });
    if (!header) return {};
    var ps = header.querySelectorAll('p'), out = {};
    if (CONFIG.subtitle.enabled && ps.length) {
      var br = ps[0].querySelector('br');
      if (br) {
        var node = br.nextSibling;
        if (!node || node.nodeType !== 3) {
          node = document.createTextNode('');
          ps[0].insertBefore(node, br.nextSibling);
        }
        out.subtitle = node;
      }
    }
    if (CONFIG.animateTotal && ps.length > 1) {
      var totalP = ps[ps.length - 1], m = textOf(totalP).match(TIME_RE);
      if (m) {
        var target = totalP.querySelector('strong') || totalP;
        target.classList.add('wf-total');
        out.total = { node: target, unit: m[2] || 's' };
      }
    }
    return out;
  }

  function setProgress(step, fraction) {
    if (!CONFIG.progress.enabled) return;
    step.row.style.setProperty('--wf-p', (Math.max(0, Math.min(1, fraction)) * 100).toFixed(2) + '%');
  }
  function setState(step, state) {
    if (step.row.getAttribute('data-wf-state') === state) return;
    step.row.setAttribute('data-wf-state', state);
    step.icon.innerHTML = ICON[state];
    if (state === 'todo') setProgress(step, 0);
    if (state === 'done') setProgress(step, CONFIG.progress.keepWhenDone ? 1 : 0);
  }
  function fmt(value, max) {
    var n = Math.max(0, Math.min(value, max));
    return max === Math.floor(max) ? Math.floor(n) : n.toFixed(1);
  }
  function setTime(step, value) { step.timeNode.textContent = fmt(value, step.seconds) + ' ' + step.unit; }

  function setup(root, steps) {
    var header = findHeader(root);
    var subtitleDone = header.subtitle ? header.subtitle.nodeValue.trim() : '';
    var totalSeconds = steps.reduce(function (sum, s) { return sum + s.seconds; }, 0);
    var running = false, visible = false, waitingForView = false, runCount = 0, rafId = null;

    function later(fn, ms) { setTimeout(fn, ms); }

    function failIndex() {
      var f = CONFIG.fail;
      if (typeof f.step === 'number') return Math.min(f.step, steps.length - 1);
      for (var i = 0; i < steps.length; i++) {
        if (textOf(steps[i].row).toLowerCase().indexOf(String(f.step).toLowerCase()) !== -1) return i;
      }
      return steps.length - 1;
    }
    function setSubtitle(text) { if (header.subtitle && text) header.subtitle.nodeValue = text; }
    function setTotal(value) {
      if (header.total) header.total.node.textContent = fmt(value, totalSeconds) + ' ' + header.total.unit;
    }
    function reset() {
      root.classList.remove('wf-failed');
      steps.forEach(function (step) {
        setState(step, 'todo');
        if (CONFIG.resetTimers) setTime(step, 0);
      });
      setTotal(0);
      setSubtitle(CONFIG.subtitle.idle);
    }
    function finished() {
      running = false;
      if (!CONFIG.loop) return;
      later(function () { if (visible) start(); else waitingForView = true; }, CONFIG.loopDelay);
    }
    function finishAll() {
      steps.forEach(function (step) { setState(step, 'done'); setTime(step, step.seconds); });
      setTotal(totalSeconds);
      setSubtitle(CONFIG.subtitle.done || subtitleDone);
      finished();
    }
    function failAt(index, before, secs) {
      setState(steps[index], 'fail');
      setTime(steps[index], secs);
      setTotal(before + secs);
      for (var i = index + 1; i < steps.length; i++) {
        setState(steps[i], 'skipped');
        steps[i].timeNode.textContent = '–';
      }
      root.classList.add('wf-failed');
      setSubtitle(CONFIG.fail.subtitle);
      finished();
    }
    function runStep(index, before, willFail) {
      if (index >= steps.length) { finishAll(); return; }
      var step = steps[index];
      setState(step, 'running');
      setTime(step, 0);
      var failHere = willFail && index === failIndex();
      var durationMs = (step.seconds * 1000) / CONFIG.speed;
      var stopMs = failHere ? durationMs * CONFIG.fail.at : durationMs;
      var startedAt = null;

      function frame(now) {
        if (startedAt === null) startedAt = now;
        var elapsed = Math.min(now - startedAt, stopMs);
        var secs = (elapsed / 1000) * CONFIG.speed;
        setTime(step, secs);
        setProgress(step, elapsed / durationMs);
        setTotal(before + Math.min(secs, step.seconds));
        if (elapsed < stopMs) {
          rafId = requestAnimationFrame(frame);
        } else if (failHere) {
          failAt(index, before, Math.round(secs));
        } else {
          setTime(step, step.seconds);
          setTotal(before + step.seconds);
          setState(step, 'done');
          later(function () { runStep(index + 1, before + step.seconds, willFail); }, CONFIG.stepGap);
        }
      }
      rafId = requestAnimationFrame(frame);
    }
    function start() {
      if (running) return;
      running = true;
      waitingForView = false;
      cancelAnimationFrame(rafId);
      var pattern = CONFIG.pattern && CONFIG.pattern.length ? CONFIG.pattern : ['pass'];
      var willFail = pattern[runCount % pattern.length] === 'fail';
      runCount++;
      reset();
      setSubtitle(CONFIG.subtitle.running);
      later(function () { runStep(0, 0, willFail); }, CONFIG.startDelay);
    }

    // Reduced motion: finished state with status icons, no counting, spinning or loop.
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      CONFIG.loop = false;
      finishAll();
      return;
    }

    reset();
    if (!('IntersectionObserver' in window)) { visible = true; start(); return; }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        visible = entry.isIntersecting;
        if (!visible) return;
        if (runCount === 0 || waitingForView) start();
      });
    }, { threshold: CONFIG.threshold });
    observer.observe(root);
  }

  function init() {
    var root = document.querySelector(CONFIG.root);
    if (!root) return;
    var steps = buildSteps(root);
    if (steps.length) setup(root, steps);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

/* ---- 2. Logo marquee (right-to-left loop, faded edges, pause on hover) ---- */
(function () {
  'use strict';

  var CONFIG = { root: '.os-page .os-logos', speed: 40 }; // px per second

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
    if (!gap || gap === 'normal') gap = '48px';

    var track = document.createElement('div');
    track.className = 'os-marquee-track';
    originals.forEach(function (el) { track.appendChild(el); });
    root.appendChild(track);
    root.style.setProperty('--os-marquee-gap', gap);
    root.classList.add('is-marquee');

    function addCopy() {
      originals.forEach(function (el) {
        var c = el.cloneNode(true);
        c.setAttribute('aria-hidden', 'true');
        c.classList.add('os-marquee-clone');
        Array.prototype.forEach.call(c.querySelectorAll('img'), function (img) { img.alt = ''; img.loading = 'eager'; });
        track.appendChild(c);
      });
    }

    function measure() {
      if (!track.querySelector('.os-marquee-clone')) addCopy();
      var distance = track.querySelector('.os-marquee-clone').offsetLeft - originals[0].offsetLeft;
      var needed = Math.ceil(root.clientWidth / distance) + 1;
      var sets = track.querySelectorAll('.os-marquee-clone').length / originals.length + 1;
      while (sets < needed + 1) { addCopy(); sets++; }
      root.style.setProperty('--os-marquee-distance', distance + 'px');
      root.style.setProperty('--os-marquee-duration', (distance / CONFIG.speed).toFixed(2) + 's');
    }

    measure();
    var t;
    window.addEventListener('resize', function () { clearTimeout(t); t = setTimeout(measure, 150); });
  }

  function init() {
    var root = document.querySelector(CONFIG.root);
    if (!root || root.classList.contains('is-marquee')) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    whenImagesReady(root.querySelectorAll('img'), function () { setup(root); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
