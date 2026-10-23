# BioSCom deployment runbook (proxmox1)

Target: **https://bioscom.ubch.sci.muni.cz** — Fastify + SQLite app bound to `127.0.0.1:8004`, behind the shared nginx on proxmox1, managed by systemd (`bioscom.service`). No Docker (house pattern).

## Layout

| Piece | Location |
| --- | --- |
| VM | `ssh proxmox1` (user `kowalski`, Ubuntu 24.04, Node v22 at `/usr/bin/node`) |
| Bare git repo | `/home/kowalski/BioSCom.git` (VM has no GitHub SSH key — code flows dev machine → ssh push) |
| Working tree | `/home/kowalski/BioSCom` (origin = `/home/kowalski/BioSCom.git`, branch `main`) |
| App env | `/home/kowalski/BioSCom/.env` (chmod 600, referenced by the unit's `EnvironmentFile`) |
| Database | `/home/kowalski/BioSCom/bioscom.db` (SQLite, WAL) |
| systemd unit | `/etc/systemd/system/bioscom.service` (copy of `deploy/bioscom.service`) |
| nginx site | `/etc/nginx/sites-available/bioscom` (copy of `deploy/nginx-bioscom.conf`) |
| TLS cert | `/etc/letsencrypt/live/bioscom.ubch.sci.muni.cz/` (certbot) |

## Port note

The migration plan originally specified port 8003 (free at recon time). The sibling app **thermool has since taken 8003** on proxmox1 — BioSCom uses **8004**. Verify with `ss -tln | grep 8004` before provisioning; if 8004 is ever taken too, pick the next free port and update `.env`, both nginx confs, and this file together.

## User actions (the only steps that need a human)

1. **DNS**: A record `bioscom.ubch.sci.muni.cz` → `147.251.22.180` (MUNI network team).
2. **sudo** on proxmox1 for the unit / nginx / certbot steps (kowalski's account, password sudo).
3. **Resend**: API key + a verified sender for `bioscom@ubch.sci.muni.cz` — set `RESEND_API_KEY` in `/home/kowalski/BioSCom/.env` (needed for forgot-password / reset emails).
4. **Firebase data export** (staged import only): service-account key JSON + password hash parameters (Firebase console → Authentication → Users → ⋮ → Password hash parameters) into `migrate/.env` on the dev machine.

## First provisioning (one-time)

Already done from the dev machine (reproduce if starting fresh):

```bash
ssh proxmox1 'git init --bare /home/kowalski/BioSCom.git'
git push proxmox1:BioSCom.git main
ssh proxmox1 'git clone BioSCom.git BioSCom && chmod 600 /home/kowalski/BioSCom/.env'   # .env created below
ssh proxmox1 'cd BioSCom && npm ci && npm run build -ws'
```

Create `/home/kowalski/BioSCom/.env` (chmod 600):

```
PORT=8004
DB_PATH=/home/kowalski/BioSCom/bioscom.db
SESSION_SECRET=<openssl rand -hex 32>
PUBLIC_URL=https://bioscom.ubch.sci.muni.cz
RESEND_API_KEY=<user action 3>
FIREBASE_SCRYPT_SIGNER_KEY=<user action 4, staged import only>
FIREBASE_SCRYPT_SALT_SEPARATOR=<user action 4>
FIREBASE_SCRYPT_ROUNDS=<user action 4>
FIREBASE_SCRYPT_MEM_COST=<user action 4>
```

Smoke (no sudo needed): `ssh proxmox1 'cd BioSCom && PORT=8004 DB_PATH=$PWD/bioscom.db SESSION_SECRET=dev node server/dist/index.js &'` then `curl http://127.0.0.1:8004/api/health` → `{"status":"ok"}` (verified 2026-10-24).

### Remaining privileged steps (user action 2)

One command (idempotent — installs the unit + bootstrap site, and once DNS resolves + cert issued, swaps in the final TLS site):

```bash
sudo /home/kowalski/BioSCom/deploy/enable-on-vm.sh
```

If DNS is not live yet it installs the HTTP bootstrap and exits 0 — rerun after the record exists. Manual equivalent:

```bash
sudo cp /home/kowalski/BioSCom/deploy/bioscom.service /etc/systemd/system/bioscom.service
sudo systemctl daemon-reload
sudo systemctl enable --now bioscom
sudo cp /home/kowalski/BioSCom/deploy/nginx-bioscom-bootstrap.conf /etc/nginx/sites-available/bioscom
sudo ln -s /etc/nginx/sites-available/bioscom /etc/nginx/sites-enabled/bioscom
sudo nginx -t && sudo systemctl reload nginx
```

The bootstrap site (HTTP-only) exists because the final conf references TLS certs that do not exist yet.

## TLS issuance (after DNS is live — user action 1)

Either rerun `sudo /home/kowalski/BioSCom/deploy/enable-on-vm.sh` (it detects DNS + missing cert and completes the swap), or manually:

```bash
sudo certbot certonly --webroot -w /var/www/html -d bioscom.ubch.sci.muni.cz
sudo cp /home/kowalski/BioSCom/deploy/nginx-bioscom.conf /etc/nginx/sites-available/bioscom
sudo nginx -t && sudo systemctl reload nginx
curl -sS https://bioscom.ubch.sci.muni.cz/api/health
```

Renewal: the port-80 block keeps the `/.well-known/acme-challenge/` webroot location, so plain `sudo certbot renew` works (certbot's standard timer). WS check through nginx: open the app in a browser, `wss://bioscom.ubch.sci.muni.cz/ws` must stay connected >60s (30s server heartbeat).

## Staged data import (todo 21)

Run on the dev machine (dumps contain PII — they never leave dev machine + VM; `migrate/dumps/` and `migrate/.env` are gitignored):

```bash
npm run export -w migrate        # needs FIREBASE_SERVICE_ACCOUNT (user action 4)
npm run report -w migrate -- --check
rsync -a --delete migrate/dumps/ proxmox1:BioSCom/migrate/dumps/   # OR run steps on VM
npm run import -w migrate         # against the VM DB: DB_PATH=... node migrate/dist/import.js
npm run verify-hashes -w migrate  # TEST account must PASS (task-6 gate)
node migrate/dist/seed-admin.js  # promote the legacy admin email to superadmin
```

Read-heavy E2E only against production data; destructive tests run against a scratch DB first.

## Routine updates

From the dev machine:

```bash
git push proxmox1:BioSCom.git main
ssh proxmox1 'cd BioSCom && ./deploy/deploy.sh'   # git pull, npm ci, build -ws, systemctl restart
```

## Backups

```bash
ssh proxmox1 'sqlite3 /home/kowalski/BioSCom/bioscom.db "VACUUM INTO \"/home/kowalski/backups/bioscom-$(date +%Y%m%d).db\"" && sha256sum /home/kowalski/backups/bioscom-*.db'
```

(In-app manual backups via the History tab land in the `group_backups` table.)

## Rollback

- **Bad app release**: `ssh proxmox1 'cd BioSCom && git checkout <previous-tag> && npm ci && npm run build -ws && sudo systemctl restart bioscom'`.
- **Take the site down**: `sudo systemctl stop bioscom` → nginx answers 502 (proves proxying, no stale content).
- **DB incident**: restore the latest dated copy — `cp /home/kowalski/backups/bioscom-YYYYMMDD.db /home/kowalski/BioSCom/bioscom.db` (stop the unit first, WAL files `.db-wal`/`.db-shm` are recreated).
- **Full Firebase-era rollback (cutover, todo 22)**: redeploy original RTDB rules + reverse-import the SQLite delta back to RTDB + remove the Hosting redirect — full procedure lives in the cutover checklist (`deploy/DECOMMISSION.md` once written).
