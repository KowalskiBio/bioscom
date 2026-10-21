<div align="center">
  <img src="logo_preview.png" alt="BioSCom" width="160" />
  <h1>BioSCom</h1>
  <p><strong>Laboratory Chemical Inventory Management System</strong></p>
  <p>
    Track chemicals across rooms, cabinets, shelves and containers — per-lab isolated inventories,
    shared containers between labs, barcode labels, full history logging and offline resilience.
  </p>
</div>

---

## Overview

BioSCom is a fully static web application backed by **Firebase Realtime Database** and
**Firebase Authentication**. There is no build step and no backend server — the frontend
talks directly to Firebase. It can be hosted by any static file server.

### Features

- 🧪 **Multi-lab support** — each laboratory group gets its own isolated inventory (`inventories/<groupId>`)
- 📦 **Physical structure** — rooms → containers (cabinets, fridges…) → shelves → chemicals with positions
- 🤝 **Shared containers** — containers can be shared between neighbouring labs with mirrored history
- 🏷️ **Barcode labels** — powered by JsBarcode
- 🔐 **Auth + biology-themed visual captcha** (poison dart frogs, naturally)
- 📜 **History logging** — every change is recorded per lab
- 📡 **Offline resilience** — realtime sync with long-polling fallback

## Tech Stack

| Layer     | Technology                                             |
| --------- | ------------------------------------------------------ |
| Frontend  | Vanilla HTML/CSS/JS (no build step)                    |
| Backend   | Firebase Realtime Database (europe-west1) + Firebase Auth |
| Libraries | Firebase v10.8.1 (CDN), JsBarcode                      |
| Testing   | Playwright                                             |

## Project Structure

```
├── index.html            # Main application
├── BioSCom.html          # Landing / portal page
├── app.js                # Application logic
├── core.js               # Firebase init, auth, history, shared state
├── style.css             # All styles
├── Capcha/               # Images for the visual captcha
├── database.rules.json   # Realtime Database security rules
├── firebase.json         # Firebase project config (rules + optional hosting)
├── tests/                # Playwright E2E tests
└── logo_preview.png
```

## Deployment on a VM

The app is static — serve the repository root over HTTPS and you are done.
No `npm install`, no build.

### Option A: Nginx (recommended)

```nginx
server {
    listen 443 ssl;
    server_name bioscom.example.com;

    root /var/www/bioscom;
    index BioSCom.html;

    location / {
        try_files $uri $uri/ =404;
    }

    # Cache static assets aggressively
    location ~* \.(css|js|png|jpg|webp)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
```

```bash
sudo mkdir -p /var/www/bioscom
sudo git clone https://github.com/KowalskiBio/bioscom.git /var/www/bioscom
# then install your TLS certificate (e.g. certbot) and reload nginx
```

### Option B: Quick throwaway server

```bash
cd bioscom
python3 -m http.server 8080
# or: npx serve .
```

> [!IMPORTANT]
> **Firebase Auth authorized domains** — the domain (or IP) you serve the app from must be added in
> the Firebase console: *Authentication → Settings → Authorized domains*.
> Realtime Database works from any origin, but sign-in will fail on unauthorized domains.

## Firebase Setup

The Firebase project (`bioscom-ca01a`) is configured in `core.js`. Client-side Firebase
config is not a secret — access is controlled by the database rules.

To push security rules after changing `database.rules.json`:

```bash
firebase deploy --only database
```

## Running Tests

Playwright E2E tests require Node.js and a `.env` with a test account:

```bash
npm install
cp .env.example .env   # fill in TEST_EMAIL / TEST_PASSWORD / APP_URL
npx playwright install chromium
npm test
```

> [!WARNING]
> Never commit `.env` — it contains real credentials and is git-ignored.

## License

ISC
