/* webshop.tech contact form endpoint (Cloudflare Worker).
   POST /api/contact  { name, url, service, email, message, reply, website, "cf-turnstile-response" }
   -> validates, checks Turnstile (when TURNSTILE_SECRET is set) and mails the message
      through Cloudflare Email Routing (send_email binding). No dependencies. */
import { EmailMessage } from 'cloudflare:email';

const SERVICES = ['Őrszem', 'Üzemeltetés'];
const MAX = { name: 120, url: 300, email: 254, message: 5000 };

/* ---------- helpers ---------- */

const clean = (v, max) => String(v ?? '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const oneLine = (v) => String(v ?? '').replace(/[\r\n\u2028\u2029]+/g, ' ').trim();
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]{2,}$/;

function b64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const wrap76 = (s) => s.replace(/(.{76})/g, '$1\r\n');
const encodeHeader = (s) => `=?UTF-8?B?${b64(s)}?=`;

export function validate(input) {
  const data = {
    name: clean(input.name, MAX.name),
    url: clean(input.url, MAX.url),
    service: clean(input.service, 40),
    email: clean(input.email, MAX.email),
    message: clean(input.message, MAX.message),
    reply: ['1', 'true', 'on', 'yes', true].includes(input.reply),
  };
  const errors = {};
  if (!data.name) errors.name = 'Add meg a neved.';
  if (!EMAIL_RE.test(data.email)) errors.email = 'Adj meg érvényes e-mail címet.';
  if (!data.message) errors.message = 'Írj üzenetet.';
  if (data.url) {
    const candidate = /^https?:\/\//i.test(data.url) ? data.url : `https://${data.url}`;
    try {
      const u = new URL(candidate);
      if (!u.hostname.includes('.')) throw new Error('host');
    } catch {
      errors.url = 'Ez nem tűnik érvényes webcímnek.';
    }
  }
  if (data.service && !SERVICES.includes(data.service)) errors.service = 'Válassz a listából.';
  return { data, errors };
}

export function buildMime({ from, to, data, ip }) {
  const subject = `Kapcsolatfelvétel – ${oneLine(data.name)}`.slice(0, 150);
  const body = [
    `Név: ${data.name}`,
    `E-mail: ${data.email}`,
    `Webáruház: ${data.url || '–'}`,
    `Szolgáltatás: ${data.service || '–'}`,
    `Visszajelzést kér: ${data.reply ? 'igen' : 'nem'}`,
    '',
    data.message,
    '',
    '--',
    `Küldve a webshop.tech kapcsolat űrlapról${ip ? ` (IP: ${ip})` : ''}.`,
  ].join('\r\n').replace(/\r?\n/g, '\r\n');

  const domain = from.split('@')[1];
  const headers = [
    `From: ${encodeHeader('webshop.tech')} <${from}>`,
    `To: ${to}`,
    `Reply-To: ${oneLine(data.email)}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
  ].join('\r\n');
  return `${headers}\r\n\r\n${wrap76(b64(body))}\r\n`;
}

async function verifyTurnstile(secret, token, ip) {
  if (!token) return false;
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const j = await r.json();
    return j.success === true;
  } catch {
    return false;
  }
}

/* Delivery: Resend HTTP API when RESEND_API_KEY is set (works with any mailbox provider,
   e.g. Google Workspace), otherwise Cloudflare Email Routing via the send_email binding. */
async function deliver(env, data, ip) {
  const from = env.FROM_ADDRESS;
  const to = env.TO_ADDRESS;
  if (env.RESEND_API_KEY) {
    const mime = buildMime({ from, to, data, ip });
    const subject = `Kapcsolatfelvétel – ${oneLine(data.name)}`.slice(0, 150);
    const text = new TextDecoder().decode(Uint8Array.from(atob(mime.split('\r\n\r\n')[1].replace(/\r\n/g, '')), (c) => c.charCodeAt(0)));
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `webshop.tech <${from}>`, to: [to], reply_to: oneLine(data.email), subject, text }),
    });
    if (!res.ok) throw new Error(`resend ${res.status}`);
    return;
  }
  await env.EMAIL.send(new EmailMessage(from, to, buildMime({ from, to, data, ip })));
}

/* ---------- HTTP ---------- */

function corsHeaders(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin');
  const h = { Vary: 'Origin' };
  if (origin && allowed.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Content-Type';
    h['Access-Control-Max-Age'] = '86400';
  }
  return h;
}

function json(body, status, extra) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra },
  });
}

async function readBody(request) {
  const type = request.headers.get('Content-Type') || '';
  if (type.includes('application/json')) return await request.json();
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);
    const url = new URL(request.url);

    if (url.pathname.replace(/\/$/, '') !== '/api/contact') return json({ ok: false }, 404, cors);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ ok: false, error: 'method' }, 405, { ...cors, Allow: 'POST, OPTIONS' });

    // Browsers always send Origin on cross-site POSTs; reject origins we don't know.
    const origin = request.headers.get('Origin');
    if (origin && !cors['Access-Control-Allow-Origin']) return json({ ok: false, error: 'origin' }, 403, cors);

    let input;
    try {
      input = await readBody(request);
    } catch {
      return json({ ok: false, error: 'bad_request' }, 400, cors);
    }
    if (!input || typeof input !== 'object') return json({ ok: false, error: 'bad_request' }, 400, cors);

    // Honeypot: bots fill the hidden "website" field. Pretend success, send nothing.
    if (clean(input.website, 200)) return json({ ok: true }, 200, cors);

    const ip = request.headers.get('CF-Connecting-IP') || '';

    if (env.TURNSTILE_SECRET) {
      const ok = await verifyTurnstile(env.TURNSTILE_SECRET, input['cf-turnstile-response'], ip);
      if (!ok) return json({ ok: false, error: 'captcha' }, 400, cors);
    }

    const { data, errors } = validate(input);
    if (Object.keys(errors).length) return json({ ok: false, error: 'validation', fields: errors }, 422, cors);

    try {
      await deliver(env, data, ip);
    } catch (err) {
      console.error('send failed', err && err.message);
      return json({ ok: false, error: 'send' }, 502, cors);
    }
    return json({ ok: true }, 200, cors);
  },
};
