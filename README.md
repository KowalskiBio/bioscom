<div align="center">
  <img src="logo_preview.png" alt="BioSCom" width="160" />
  <h1>BioSCom</h1>
  <p><strong>Laboratory Chemical Inventory Management System</strong></p>
  <p>
    Track chemicals across rooms, cabinets, shelves and containers: per-lab isolated inventories,
    shared containers between labs, barcode labels, full history logging and offline resilience.
  </p>
</div>

---

## Overview

BioSCom is the inventory system used by the biochemistry labs at the Faculty of Science, Masaryk
University. It used to run on Google Firebase; since October 2026 it is fully self-hosted on the
faculty VM at **https://bioscom.ubch.sci.muni.cz** and has no Firebase dependency of any kind:
no Firebase database, no Firebase authentication, no Firebase hosting.

All existing data was migrated from the Firebase Realtime Database (snapshot from October 21,
2026): inventories, rooms and containers, history logs, notices, instrument bookings, print
requests and game challenges.

> **First login:** user accounts were migrated, but Firebase passwords could not be carried over.
> On your first login, enter your email with any password and you will receive an email with a
> link to set a new password. After that you log in normally.
>
> Until the DNS record is live, the app is temporarily reachable at http://147.251.22.180.
> The old address bioscom-ca01a.web.app is deprecated; anything entered there after
> October 21, 2026 was not carried over.

### Features

- 🧪 **Multi-lab support**: each laboratory group gets its own isolated inventory
- 📦 **Physical structure**: rooms → containers (cabinets, fridges…) → shelves → chemicals with positions
- 🤝 **Shared containers**: containers can be shared between neighbouring labs with mirrored history
- 🏷️ **Barcode labels** powered by JsBarcode
- 🔐 **Auth + biology-themed visual captcha** (poison dart frogs, naturally)
- 📜 **History logging**: every change is recorded per lab, with manual backups and restore
- 📡 **Offline banner + realtime sync** over WebSocket
- 🧬 Extra lab tools: noticeboard, instrument booking, 3D print requests, protocols, minigames, lab radio

## Tech Stack

| Layer     | Technology                                                            |
| --------- | --------------------------------------------------------------------- |
| Frontend  | Svelte 5 + Vite (TypeScript), legacy CSS ported verbatim               |
| Backend   | Fastify (Node.js) + SQLite (better-sqlite3) + WebSocket realtime      |
| Shared    | zod schemas and types, one npm-workspaces monorepo                     |
| Email     | Resend (password reset links)                                         |
| Tests     | vitest + supertest (unit/API), Playwright (E2E incl. visual parity)    |

## Project Structure

```
├── server/          Fastify backend: REST + WebSocket, SQLite, session auth
├── web/             Svelte 5 frontend
├── shared/          zod schemas shared by server and web
├── migrate/         one-shot migration tooling (legacy export → SQLite import)
├── deploy/          systemd unit, nginx sites, deployment runbook
├── tests/           Playwright E2E suites (self-contained scratch stack)
├── DEVELOPMENT.md   how to set up and work on the code
└── deploy/DEPLOY.md how the app is deployed and operated on the VM
```

## Developing

See [DEVELOPMENT.md](DEVELOPMENT.md) for the full quickstart. In short:

```bash
git clone https://github.com/KowalskiBio/bioscom.git
cd bioscom
npm ci
npm run build -ws
npm test -w server && npm test -w web && npm test -w shared
npx playwright test
```

## Deployment

The app runs on the faculty VM (proxmox1) as a systemd service behind nginx, with a Let's
Encrypt certificate. Routine updates and the full runbook (provisioning, TLS, backups,
rollback, cutover) are documented in [deploy/DEPLOY.md](deploy/DEPLOY.md). There is no Docker
and no Firebase anywhere in the pipeline.

## Running Tests

Playwright E2E tests spawn their own scratch server and throwaway database, so they never
touch real data:

```bash
npm ci
npx playwright install chromium
npm test
```

> [!WARNING]
> Never commit `.env` files or database files. They are git-ignored; keep it that way.

## License

ISC
