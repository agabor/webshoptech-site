/* Booking modal: links marked [data-booking] open the Google Calendar appointment
   page in a modal dialog (iframe) instead of a new tab. Without JS they stay
   normal links that open in a new tab. */
(function () {
  'use strict';

  var overlay, frame, closeBtn, lastFocus;

  function build() {
    overlay = document.createElement('div');
    overlay.className = 'wst-modal';
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="wst-modal-box" role="dialog" aria-modal="true" aria-label="Időpontfoglalás">' +
      '<button type="button" class="wst-modal-close" aria-label="Bezárás">&times;</button>' +
      '<div class="wst-modal-loading" aria-hidden="true"></div>' +
      '<iframe class="wst-modal-frame" title="Időpontfoglalás" allow="payment"></iframe>' +
      '</div>';
    document.body.appendChild(overlay);
    frame = overlay.querySelector('iframe');
    closeBtn = overlay.querySelector('button');
    frame.addEventListener('load', function () { overlay.classList.add('is-loaded'); });
    closeBtn.addEventListener('click', close);
    overlay.addEventListener('mousedown', function (e) { if (e.target === overlay) close(); });
  }

  function open(url) {
    if (!overlay) build();
    lastFocus = document.activeElement;
    overlay.classList.remove('is-loaded');
    frame.src = url;
    overlay.hidden = false;
    document.documentElement.classList.add('wst-modal-open');
    closeBtn.focus();
  }

  function close() {
    if (!overlay || overlay.hidden) return;
    overlay.hidden = true;
    frame.src = 'about:blank';
    document.documentElement.classList.remove('wst-modal-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[data-booking]');
    if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
    e.preventDefault();
    open(a.href);
  });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') close();
  });
})();
