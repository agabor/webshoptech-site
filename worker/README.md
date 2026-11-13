# Contact form Worker

Receives the form on `/kapcsolat/` at `https://webshop.tech/api/contact`, checks it and emails it to you.
Free Cloudflare Workers plan is enough (100,000 requests/day).

What it does: CORS limited to your site, honeypot, optional Turnstile check, server-side validation,
header-injection-safe email, JSON responses the page turns into Hungarian messages.

## 1. Choose how the email is sent

**A. Cloudflare Email Routing (default, free, no extra account).**
Only pick this if `webshop.tech` mail is (or can be) handled by Cloudflare Email Routing.
> Enabling Email Routing replaces the domain's MX records. If your mailbox `gabor@webshop.tech`
> lives at Google Workspace or another provider, do **not** enable it, use option B.

1. Cloudflare dashboard → `webshop.tech` → **Email → Email Routing** → enable.
2. Add `gabor@webshop.tech` as a **destination address** and click the verification link in the mail.
3. Keep `[[send_email]]` in `wrangler.toml` and set `FROM_ADDRESS` to an address on the domain (default `kapcsolat@webshop.tech`).

**B. Resend (works with any mailbox provider, doesn't touch MX records).**
1. Create a free account at resend.com, add the domain `webshop.tech`, add the DKIM/SPF DNS records it shows.
2. Create an API key, then `npx wrangler secret put RESEND_API_KEY`.
3. Delete the `[[send_email]]` block from `wrangler.toml`.

`TO_ADDRESS` (who receives the messages) and `FROM_ADDRESS` are in `[vars]` in `wrangler.toml`.

## 2. Turnstile (recommended spam protection, free, no cookies)

1. Dashboard → **Turnstile** → add widget for `webshop.tech` and `agabor.github.io` (managed mode).
2. Put the **site key** into `kapcsolat/index.html`: `data-turnstile-sitekey="0x4AAA..."`.
3. Store the **secret key**: `npx wrangler secret put TURNSTILE_SECRET`.

Without a secret the Worker skips the check (the honeypot still runs).

## 3. Deploy

```sh
cd worker
npm install
npm test                 # optional: 13 tests of the Worker logic
npx wrangler login
npx wrangler deploy
```

The route `webshop.tech/api/contact*` is in `wrangler.toml`. Only that path goes to the Worker,
the rest of webshop.tech is untouched. The zone must be on the same Cloudflare account.
If you move the static site to `webshop.tech` later, nothing changes (same origin, CORS not needed).

## 4. Try it

```sh
curl -i https://webshop.tech/api/contact -H 'Origin: https://agabor.github.io' \
  -H 'Content-Type: application/json' \
  -d '{"name":"Teszt","email":"teszt@example.com","message":"Szia"}'
```
Expect `200 {"ok":true}` (or `400 captcha` once the Turnstile secret is set) and a mail in your inbox.
Watch problems live with `npx wrangler tail`.
