# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Persian (RTL) pre-order site for a farewell party (~50 guests): guests enter their name,
browse the restaurant menu, add items (food / appetizers / drinks) to an order, and confirm.
Two restaurant reports live behind a password at `/admin`: per-guest orders and an
item-quantity summary. **Prices are intentionally never shown.**

Repo/remote name is `mehmooni` (GitHub `alirahmani93/mehmooni`); local dir is `goodbyparty`.

## Commands

```bash
npm install
npm start                      # node server.js — serves site + API on PORT (default 4123)
# local override example:
ADMIN_PASSWORD='...' PARTY_SUBTITLE='...' PORT=4199 node server.js
```

There is **no build step, no test suite, no linter**. To verify a change, run the server and
exercise it (the repo has no framework — plain Express + static files). A headless-Chrome
screenshot check is the practical way to validate UI/RTL changes.

## Architecture

Single Node.js + Express process (`server.js`), no database:

- **`data/menu.json`** — the menu (15 categories, 107 items), committed. Loaded once at boot into
  an `id → item` map for order validation.
- **`data/orders.json`** — runtime guest orders, `nameKey → {name, items, note, updatedAt}`.
  Gitignored. **Corruption-safety is the core design constraint**: every write goes through one
  in-process async mutex (`enqueueWrite`) → temp file → `fsync` → atomic `rename`. Never write
  this file by any other path. Rolling backups in `data/backups/`.
- **`public/`** — guest app (`index.html`/`app.js`) and admin (`admin.html`/`admin.js`), one
  `styles.css`, bundled Vazirmatn font. Served statically from the image (NOT volume-mounted), so
  **any change under `public/` or `config.js` requires an image rebuild to deploy**.
- **`config.js`** — `port`, `adminPassword`, `partyTitle`, `partySubtitle`, all env-overridable.

API: `GET /api/menu`, `GET /api/order?name=`, `POST /api/order` (validates every item id against
the menu, qty capped at 20), `POST /api/admin/report` (password-gated).

### Conventions that matter
- **Persian everywhere**: RTL, Persian digits via `toFa()`, Vazirmatn. User-facing strings are Persian.
- **XSS**: guest name/note are user input. The guest app renders them via `textContent`; the admin
  report escapes via `esc()`. Menu titles/descriptions are trusted (static data). Keep it that way.
- **Name identity**: guests are keyed by `nameKey()` (normalized, spaces/case-insensitive) so
  re-entering the same name loads/edits their existing order.
- **Header title/subtitle**: `PARTY_TITLE` empty/unset ⇒ the title line is hidden (see `app.js`
  `loadMenu`). `PARTY_SUBTITLE` splits on `\n` (literal backslash-n in `.env`) into multiple lines.

## Refreshing the menu

`data/menu.json` was reverse-engineered from `boxrestaurant.ir` (an Angular SPA on the
`live-menu.ir` SaaS whose API sits behind a WAF that blocks curl). To re-extract: render the page
in headless Chrome (puppeteer-core + system Chrome), capture the `POST .../api/Menu/Config5/`
response, then for each category parse the `p` field (a JSON *string*) into items
`{id, t:title, d:desc, pic}`; prefix images with `https://img01.live-app.ir`; exclude categories
`gOrder` 100/101 (delivery/packaging). A raw capture is in `docs/menu-source-capture.json`.

## Deployment (Docker + host Nginx)

Runs on Ali's VPS `administrator@69.197.142.133` at `/home/administrator/mehmooni`, alongside many
other production containers. **Do not use the bundled Caddy approach** (removed) — the host already
runs Nginx on 80/443.

- App container publishes to localhost only (`127.0.0.1:4123` in repo). Host Nginx site
  `deploy/nginx/menu.vazgroup.ir` proxies the domain → the app; `certbot --nginx` adds TLS.
- **Server-local override**: on the server, `docker-compose.yml` is edited to `0.0.0.0:4123` (an
  intentional, uncommitted local change) so the app is testable at `http://69.197.142.133:4123`
  before DNS/TLS. Repo keeps the secure `127.0.0.1` default. When syncing the server, preserve
  this override (discard other local edits, pull, re-apply the `0.0.0.0` sed).
- Deploy code changes: `git pull && docker compose up -d --build`. `.env` (gitignored) holds
  `ADMIN_PASSWORD` + party text; changing it needs `docker compose up -d` (recreate).
- **Pending**: `menu.vazgroup.ir` DNS still points to Vercel, not the VPS. Certbot/HTTPS can't run
  until the A-record → `69.197.142.133`. After that, run certbot and revert the port to `127.0.0.1`.

## Working agreement

Never commit/push without explicit per-action authorization from Ali.
