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

No Firebase access exists (user directive 2026-10-24) — no service account, no hash parameters, no console. User data comes from the captured RTDB export (see "Staged data import"); all accounts are reset-first-login (email a reset link on first login attempt).

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

## Temporary access via IP (until DNS is live)

The MUNI network only passes 22/80/443 to the VM — the app port 8004 is NOT reachable from outside (verified: connection to 147.251.22.180:8004 times out; 80/443 answer). Until the DNS record exists, the app is served over plain HTTP on port 80 by IP:

1. Run `sudo /home/kowalski/BioSCom/deploy/enable-on-vm.sh` (installs the systemd unit + bootstrap nginx site — its server_name matches both `bioscom.ubch.sci.muni.cz` and `147.251.22.180`, so the same site later serves the DNS name pre-TLS).
2. Browse `http://147.251.22.180`.
3. Trial values in `/home/kowalski/BioSCom/.env` (set 2026-10-24, flip back at TLS time):
   - `PUBLIC_URL=http://147.251.22.180` — keeps the session cookie non-Secure (HTTP) and makes reset links directly clickable
   - `EMAIL_CAPTURE_FILE=/home/kowalski/bioscom-trial-emails.jsonl` — reset links land in a file instead of email (no Resend yet). Get the latest: `ssh proxmox1 tail -1 bioscom-trial-emails.jsonl`
4. When DNS is live: rerun `sudo ./deploy/enable-on-vm.sh` (cert + final TLS site) AND flip `.env` to production values — `PUBLIC_URL=https://bioscom.ubch.sci.muni.cz`, remove `EMAIL_CAPTURE_FILE`, set `RESEND_API_KEY` — then `sudo systemctl restart bioscom`.

## TLS issuance (after DNS is live — user action 1)

Either rerun `sudo /home/kowalski/BioSCom/deploy/enable-on-vm.sh` (it detects DNS + missing cert and completes the swap), or manually:

```bash
sudo certbot certonly --webroot -w /var/www/html -d bioscom.ubch.sci.muni.cz
sudo cp /home/kowalski/BioSCom/deploy/nginx-bioscom.conf /etc/nginx/sites-available/bioscom
sudo nginx -t && sudo systemctl reload nginx
curl -sS https://bioscom.ubch.sci.muni.cz/api/health
```

Renewal: the port-80 block keeps the `/.well-known/acme-challenge/` webroot location, so plain `sudo certbot renew` works (certbot's standard timer). WS check through nginx: open the app in a browser, `wss://bioscom.ubch.sci.muni.cz/ws` must stay connected >60s (30s server heartbeat).

## Staged data import (todo 21 — no-Firebase variant, executed 2026-10-24)

Source: the captured RTDB export `migration/bioscom-db-export.json` on the dev machine (real lab data as of 2026-10-21; PII — gitignored, never committed; never leaves dev machine + VM). No Firebase export is possible or needed.

```bash
rsync -a migration/bioscom-db-export.json proxmox1:bioscom-db-export.json
ssh proxmox1 'chmod 600 ~/bioscom-db-export.json'
ssh proxmox1 'cd BioSCom && node migrate/dist/import.js --legacy ../bioscom-db-export.json --db bioscom.db && node migrate/dist/seed-admin.js --db bioscom.db'
```

All users import with `hash_version='unverified'` → first login attempt triggers a reset email; after resetting, the account is argon2id. Verified on the VM loopback (EMAIL_CAPTURE_FILE stand-in): unverified login → 401 reset-required → reset via token → login 200 + session. Zero drift vs local import; 0 quarantined rows.

Read-heavy E2E only against production data; destructive tests run against a scratch DB first. The VM-side `~/bioscom-db-export.json` is kept (chmod 600) for the cutover re-import and deleted at decommission.

## Cutover (todo 22 — no-Firebase variant)

Data source is FINAL per user decision (2026-10-24): the 2026-10-21 export already staged on the VM — no fresh capture. Checklist, in order:

1. Preconditions: DNS live, `sudo ./deploy/enable-on-vm.sh` run (unit active + TLS), `.env` flipped to production values — `PUBLIC_URL=https://bioscom.ubch.sci.muni.cz`, `RESEND_API_KEY` set, `EMAIL_CAPTURE_FILE` removed — and `sudo systemctl restart bioscom`.
2. Pre-cutover archive: `ssh proxmox1 'sqlite3 /home/kowalski/BioSCom/bioscom.db "VACUUM INTO \"/home/kowalski/backups/bioscom-pre-cutover.db\""'`.
3. Re-import + seed (idempotent, confirms the staged state is the cutover state): `ssh proxmox1 'cd BioSCom && node migrate/dist/import.js --legacy ../bioscom-db-export.json --db bioscom.db && node migrate/dist/seed-admin.js --db bioscom.db'`.
4. Verify: `curl -sS https://bioscom.ubch.sci.muni.cz/api/health` → `{"status":"ok"}`; two real logins via reset emails (one must be the superadmin).
5. Send the announcement (template below) — the legacy app CANNOT be frozen or redirected (no Firebase access), so the message must be explicit about deprecation.
6. Monitor 24h: `ssh proxmox1 'journalctl -u bioscom --since "1 hour ago" | grep -iE "error|warn"'` and WS stability (browser stays connected >60s).

Announcement template (user composes/sends):

> Subject: BioSCom is moving — new address, set your password
>
> Hi everyone,
>
> BioSCom now runs on our own server: **https://bioscom.ubch.sci.muni.cz**
> The old address (bioscom-ca01a.web.app) is DEPRECATED — please stop using it. Anything entered there after Oct 21, 2026 will NOT be carried over.
>
> First login: go to the new address, enter your email and any password — you'll get an email with a link to set your new password. Your data (inventories, history, notices, bookings) is all there as of Oct 21.
>
> If anything looks missing or broken, reply here.

Rollback (documented drill): stop the unit, restore `bioscom-pre-cutover.db` into place, start the unit, verify the app serves the pre-cutover state. Returning to the legacy app is possible (it stays live) but data entered in the NEW app after a rollback must be manually re-entered — no automated reverse-import exists (no Firebase write access).

Execution log (fill during cutover):

- [ ] DNS live (date/time)
- [ ] enable-on-vm.sh run, health 200 over https
- [ ] RESEND_API_KEY set, unit restarted
- [ ] pre-cutover archive taken (path + sha256)
- [ ] re-import + seed-admin, 0 quarantined
- [ ] ≥2 real logins verified (incl. superadmin)
- [ ] announcement sent
- [ ] 24h monitoring clean

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
