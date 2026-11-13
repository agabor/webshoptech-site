// Runs the Worker logic in plain Node by stubbing the Cloudflare-only email import.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const src = fs.readFileSync(new URL('../src/index.js', import.meta.url), 'utf8')
  .replace("import { EmailMessage } from 'cloudflare:email';",
    'class EmailMessage { constructor(from, to, raw) { this.from = from; this.to = to; this.raw = raw; } }');
const tmp = path.join(os.tmpdir(), `worker-under-test-${process.pid}.mjs`);
fs.writeFileSync(tmp, src);
const worker = await import(pathToFileURL(tmp).href);
fs.unlinkSync(tmp);

const sent = [];
const env = {
  FROM_ADDRESS: 'kapcsolat@webshop.tech', TO_ADDRESS: 'gabor@webshop.tech',
  ALLOWED_ORIGINS: 'https://agabor.github.io,https://webshop.tech',
  EMAIL: { async send(m) { sent.push(m); } },
};
const good = { name: 'Teszt Elek', url: 'pelda.hu', service: 'Őrszem', email: 'elek@pelda.hu', message: 'Szia!\nÁrvíztűrő tükörfúrógép', reply: 'on' };
const call = (body, { method = 'POST', origin = 'https://agabor.github.io', path = '/api/contact', e = env } = {}) =>
  worker.default.fetch(new Request('https://webshop.tech' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    body: method === 'POST' ? JSON.stringify(body) : undefined,
  }), e);

const call_ = (body, e) => call(body, { e });
let n = 0; const t = async (name, fn) => { await fn(); n++; console.log('ok -', name); };

await t('valid submission sends one mail and returns ok', async () => {
  const r = await call(good);
  assert.equal(r.status, 200); assert.deepEqual(await r.json(), { ok: true });
  assert.equal(sent.length, 1);
  assert.equal(r.headers.get('Access-Control-Allow-Origin'), 'https://agabor.github.io');
});
await t('MIME is well formed and decodes back to the message', async () => {
  const raw = sent[0].raw; const [head, body] = raw.split('\r\n\r\n');
  assert.match(head, /^From: =\?UTF-8\?B\?.+\?= <kapcsolat@webshop\.tech>/m);
  assert.match(head, /^To: gabor@webshop\.tech$/m);
  assert.match(head, /^Reply-To: elek@pelda\.hu$/m);
  assert.match(head, /^Message-ID: <[0-9a-f-]+@webshop\.tech>$/m);
  const subj = head.match(/^Subject: =\?UTF-8\?B\?(.+)\?=$/m)[1];
  assert.equal(Buffer.from(subj, 'base64').toString('utf8'), 'Kapcsolatfelvétel – Teszt Elek');
  const text = Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.match(text, /Név: Teszt Elek/); assert.match(text, /Árvíztűrő tükörfúrógép/); assert.match(text, /Visszajelzést kér: igen/);
  for (const line of raw.split('\r\n')) assert.ok(line.length <= 998);
});
await t('header injection in name cannot add headers', async () => {
  sent.length = 0;
  await call({ ...good, name: 'Evil\r\nBcc: victim@x.com' });
  const head = sent[0].raw.split('\r\n\r\n')[0];
  assert.ok(!/^Bcc:/mi.test(head));
});
await t('header injection in email is rejected', async () => {
  const r = await call({ ...good, email: 'a@b.com\r\nBcc: x@y.com' });
  assert.equal(r.status, 422);
});
await t('missing fields give 422 with per-field errors', async () => {
  const r = await call({ name: '', email: 'nope', message: '' });
  assert.equal(r.status, 422); const j = await r.json();
  assert.ok(j.fields.name && j.fields.email && j.fields.message);
});
await t('bad service and bad url are rejected', async () => {
  const r = await call({ ...good, service: 'Hack', url: 'not a url' });
  const j = await r.json(); assert.ok(j.fields.service && j.fields.url);
});
await t('honeypot returns ok but sends nothing', async () => {
  sent.length = 0; const r = await call({ ...good, website: 'http://spam' });
  assert.equal(r.status, 200); assert.equal(sent.length, 0);
});
await t('unknown origin is rejected', async () => {
  sent.length = 0; const r = await call(good, { origin: 'https://evil.example' });
  assert.equal(r.status, 403); assert.equal(sent.length, 0);
});
await t('preflight works for allowed origin', async () => {
  const r = await call(null, { method: 'OPTIONS' });
  assert.equal(r.status, 204); assert.equal(r.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
});
await t('GET is 405, other paths 404', async () => {
  assert.equal((await call(null, { method: 'GET' })).status, 405);
  assert.equal((await call(good, { path: '/api/other' })).status, 404);
});
await t('turnstile required when secret set, token checked with Cloudflare', async () => {
  const e2 = { ...env, TURNSTILE_SECRET: 's' };
  sent.length = 0;
  assert.equal((await call(good, { e: e2 })).status, 400);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u) => { assert.match(String(u), /turnstile\/v0\/siteverify/); return new Response(JSON.stringify({ success: true })); };
  try { const r = await call({ ...good, 'cf-turnstile-response': 'tok' }, { e: e2 }); assert.equal(r.status, 200); }
  finally { globalThis.fetch = realFetch; }
  assert.equal(sent.length, 1);
});
await t('mail failure returns 502', async () => {
  const e3 = { ...env, EMAIL: { async send() { throw new Error('boom'); } } };
  assert.equal((await call(good, { e: e3 })).status, 502);
});
await t('Resend delivery when RESEND_API_KEY is set (no Email Routing needed)', async () => {
  const realFetch = globalThis.fetch; let call;
  globalThis.fetch = async (u, o) => { call = { u: String(u), o }; return new Response('{"id":"1"}', { status: 200 }); };
  try {
    const r = await call_(good, { ...env, RESEND_API_KEY: 'k', EMAIL: undefined });
    assert.equal(r.status, 200);
  } finally { globalThis.fetch = realFetch; }
  assert.equal(call.u, 'https://api.resend.com/emails');
  const b = JSON.parse(call.o.body);
  assert.equal(b.reply_to, 'elek@pelda.hu'); assert.deepEqual(b.to, ['gabor@webshop.tech']);
  assert.match(b.text, /Árvíztűrő tükörfúrógép/); assert.equal(b.subject, 'Kapcsolatfelvétel – Teszt Elek');
  assert.equal(call.o.headers.Authorization, 'Bearer k');
});
console.log(`\n${n} tests passed`);
