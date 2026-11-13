/* Contact form: validates in the browser, posts JSON to the Cloudflare Worker
   (data-endpoint) and shows the result inline. Without JS the form falls back to a
   normal POST to the same endpoint. */
(function () {
  'use strict';

  var form = document.getElementById('contact-form');
  if (!form) return;

  var endpoint = form.getAttribute('data-endpoint');
  var siteKey = form.getAttribute('data-turnstile-sitekey');
  var status = document.getElementById('cf-status');
  var button = form.querySelector('button[type=submit]');
  var token = '';

  var MESSAGES = {
    name: 'Add meg a neved.',
    email: 'Adj meg érvényes e-mail címet.',
    message: 'Írj üzenetet.',
    url: 'Ez nem tűnik érvényes webcímnek.',
    service: 'Válassz a listából.'
  };
  var EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

  function setError(name, text) {
    var input = form.elements[name];
    var out = document.getElementById('cf-' + name + '-err');
    if (!input || !out) return;
    var field = input.closest('.ct-field');
    if (text) {
      out.textContent = text;
      out.hidden = false;
      field.classList.add('has-error');
      input.setAttribute('aria-invalid', 'true');
      input.setAttribute('aria-describedby', out.id);
    } else {
      out.hidden = true;
      field.classList.remove('has-error');
      input.removeAttribute('aria-invalid');
      input.removeAttribute('aria-describedby');
    }
  }

  function validUrl(v) {
    if (!v) return true;
    try {
      var u = new URL(/^https?:\/\//i.test(v) ? v : 'https://' + v);
      return u.hostname.indexOf('.') > 0;
    } catch (e) { return false; }
  }

  function check() {
    var errors = {};
    if (!form.elements.name.value.trim()) errors.name = MESSAGES.name;
    if (!EMAIL_RE.test(form.elements.email.value.trim())) errors.email = MESSAGES.email;
    if (!form.elements.message.value.trim()) errors.message = MESSAGES.message;
    if (!validUrl(form.elements.url.value.trim())) errors.url = MESSAGES.url;
    return errors;
  }

  function showStatus(kind, text) {
    status.className = 'ct-status ' + (kind === 'ok' ? 'is-ok' : 'is-error');
    status.textContent = text;
    status.hidden = false;
    status.focus();
  }

  function applyErrors(errors) {
    ['name', 'url', 'service', 'email', 'message'].forEach(function (n) { setError(n, errors[n] || ''); });
    var first = Object.keys(errors)[0];
    if (first && form.elements[first]) form.elements[first].focus();
  }

  /* Cloudflare Turnstile (only when a site key is configured on the form) */
  if (siteKey) {
    var s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = function () {
      window.turnstile.render('#cf-turnstile', {
        sitekey: siteKey,
        callback: function (t) { token = t; },
        'expired-callback': function () { token = ''; },
        'error-callback': function () { token = ''; }
      });
    };
    document.head.appendChild(s);
  }

  ['name', 'url', 'service', 'email', 'message'].forEach(function (n) {
    var el = form.elements[n];
    el.addEventListener('input', function () { setError(n, ''); });
  });

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    status.hidden = true;

    var errors = check();
    applyErrors(errors);
    if (Object.keys(errors).length) return;

    if (siteKey && !token) {
      showStatus('error', 'Kérlek, várd meg az ellenőrzés lefutását, majd küldd el újra.');
      return;
    }

    var payload = {
      name: form.elements.name.value,
      url: form.elements.url.value,
      service: form.elements.service.value,
      email: form.elements.email.value,
      message: form.elements.message.value,
      reply: form.elements.reply.checked,
      website: form.elements.website.value,
      'cf-turnstile-response': token
    };

    button.disabled = true;
    var label = button.textContent;
    button.textContent = 'Küldés…';

    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) { return { res: res, body: body }; });
    }).then(function (r) {
      if (r.res.ok && r.body.ok) {
        form.classList.add('is-sent');
        showStatus('ok', 'Köszönöm az üzeneted! Hamarosan válaszolok.');
        form.reset();
        return;
      }
      if (r.res.status === 422 && r.body.fields) {
        applyErrors(r.body.fields);
      } else if (r.body.error === 'captcha') {
        showStatus('error', 'Az ellenőrzés nem sikerült. Frissítsd az oldalt, és próbáld újra.');
      } else {
        showStatus('error', 'Az üzenetet most nem sikerült elküldeni. Kérlek, próbáld újra később, vagy írj a gabor@webshop.tech címre.');
      }
      resetTurnstile();
    }).catch(function () {
      showStatus('error', 'Hálózati hiba történt. Kérlek, próbáld újra, vagy írj a gabor@webshop.tech címre.');
      resetTurnstile();
    }).then(function () {
      button.disabled = false;
      button.textContent = label;
    });
  });

  function resetTurnstile() {
    token = '';
    if (window.turnstile && siteKey) { try { window.turnstile.reset(); } catch (e) { /* ignore */ } }
  }
})();
