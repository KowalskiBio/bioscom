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
   - `RESEND_API_KEY` + `RESEND_FROM="BioSCom <notifications@octoslave.karamazov.website>"` — email delivery via the same Resend account Oligool uses (key copied on the VM from `~/Oligool/backend/.env`; it never enters the repo)
   - `RESET_REDIRECT_EMAIL` — during the trial all password-reset emails go to this single address (the Oligool `REPORT_NOTIFY_EMAIL` address) instead of each account's own inbox; REMOVE at cutover so members get their own reset links
4. When DNS is live: rerun `sudo ./deploy/enable-on-vm.sh` (cert + final TLS site) AND flip `.env` to production values — `PUBLIC_URL=https://bioscom.ubch.sci.muni.cz`, remove `RESET_REDIRECT_EMAIL`, keep `RESEND_API_KEY` — then `sudo systemctl restart bioscom`.

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

1. Preconditions: DNS live, `sudo ./deploy/enable-on-vm.sh` run (unit active + TLS), `.env` flipped to production values — `PUBLIC_URL=https://bioscom.ubch.sci.muni.cz`, `RESET_REDIRECT_EMAIL` removed, `RESEND_API_KEY` present — and `sudo systemctl restart bioscom`.
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

## Collaborator VM access (read-only, ACLs)

A colleague with a VM account (e.g. `zble`) gets read access to the deployed tree — but NOT to secrets or lab data. One-time setup (sudo):

```bash
sudo apt-get install -y acl
sudo setfacl -m u:zble:x /home/kowalski
sudo setfacl -R -m u:zble:rX /home/kowalski/BioSCom
sudo setfacl -m u:zble:--- /home/kowalski/BioSCom/.env /home/kowalski/BioSCom/bioscom.db /home/kowalski/BioSCom/bioscom.db-wal /home/kowalski/BioSCom/bioscom.db-shm
```

- `/home/kowalski` gets traversal-only (`x`, no listing) for the account
- the whole `BioSCom` tree is readable (source, dists, deploy configs — the repo is public on GitHub anyway)
- `.env` (Resend key, session secret) and the SQLite DB files (real lab PII) are explicitly denied
- new files created by later deploys are NOT automatically readable (no default ACLs — deliberate); re-run the recursive grant after deploys if needed
- the colleague develops via GitHub (clone `https://github.com/KowalskiBio/bioscom.git`, see `DEVELOPMENT.md`); the VM tree is for inspecting what is actually running

## Routine updates

From the dev machine:

```bash
git push proxmox1:BioSCom.git main
ssh proxmox1 'cd BioSCom && ./deploy/deploy.sh'   # git pull, npm ci, build -ws, systemctl restart
```

## Rolling out the inventory refactor (typed materials)

What the release changes under the hood: the legacy per-group **JSON inventory document
stays the read/write driver** for now, but the schema gains a relational core
(materials → products → batches → stocks, locations, shares), mirrored transactionally on
every write. On the FIRST boot of this build, the server creates those tables and runs an
**idempotent backfill** (JSON docs → relational rows) plus a **parity check**, all inside
the same code path as normal migrations (`server/src/db/migrate.ts`). Nothing else in this
runbook changes.

### Pre-flight (before `git push proxmox1:BioSCom.git main`)

1. Snapshot the only production data copy:
   ```bash
   ssh proxmox1 'sqlite3 /home/kowalski/BioSCom/bioscom.db "VACUUM INTO \"/home/kowalski/backups/bioscom-pre-inventory-refactor.db\"" && sha256sum /home/kowalski/backups/bioscom-pre-inventory-refactor.db'
   ```
2. (Sanity re-run locally: `npm test -w server` must be green before pushing.)

### Deploy

Same as Routine updates:

```bash
git push proxmox1:BioSCom.git main
ssh proxmox1 'cd BioSCom && ./deploy/deploy.sh'   # git pull, npm ci, build -ws, systemctl restart
```

### Expected boot logs (first boot of the new build)

`ssh proxmox1 'journalctl -u bioscom -n 80 --no-pager'`:

- The migration runner is silent for the SQL files themselves; after any newly applied
  migration it prints one line per backfill run, per group-checked:
  ```
  [inventory-backfill] synced N group(s), anomalies: 0
  ```
  (`synced N` = how many group docs were reconciled this boot; on later boots this rule is
  silent unless a doc version drifted or an anomaly was found — silence is the healthy state.)
- `[inventory-parity]` must NOT appear at all. Any `[inventory-parity] ... mismatch(es)`
  line is an alarm: it means relational and document disagree; investigate before letting
  colleagues in (see probe below).
- `[inventory-sync] mirror failed` lines during operation indicate a per-write mirror
  failure — the legacy write still succeeded (document is authoritative here); investigate
  and then just re-edit anything in that group (sync re-heals on every mutation; the boot
  backfill also re-heals stale docs).

### Verification checklist (post-release smoke, ~5 min)

1. Parity probe per lab (once, needs a logged-in session cookie; a member login of that
   lab works): visit `https://bioscom.ubch.sci.muni.cz/api/groups/<group-id>/inventory/parity`
   in that browser session — must answer `{ "ok": true, "issues": [] }`.
   Alternatively without cookies, on the VM:
   ```bash
   ssh proxmox1 'sqlite3 /home/kowalski/BioSCom/bioscom.db "SELECT COUNT(*) FROM inventory_sync_state"'  # 1 row per synced group
   ```
2. Open the app: **Catalog** tab lists your materials with types; create/edit one legacy
   chemical (existing flow must work exactly as before); open the **Stocks** tab and
   confirm legacy rows show CAS etc.; create one typed item (e.g. antibody with target/
   host) via Add Chemical → Item type; confirm it appears in Catalog with a type chip.
3. Next `systemctl restart bioscom` → journal shows NO `[inventory-backfill] synced 0`
   anomalies and still no `[inventory-parity]` line (data converged 1:1).

### Rollback for this release

The legacy document, history, shares, exports and percents of current writes all live in
the old schema and remain authoritative; the relational side is a transactional mirror.
- **Rollback**: deploy previous tag (standard "Bad app release" above). The new tables
  (`materials`, `products`, `batches`, `stocks`, `locations`, `container_shares`,
  `batch_inputs`, `legacy_chemical_map`, `inventory_sync_state`, `schema_migrations`) are
  simply ignored by the old build and carry **no unique data** yet (everything in them is
  derivable from the doc). Nothing needs reversal or conversion.
- A boot killed mid-migration cannot half-apply a migration (each applies inside its own
  transaction) or half-sync a group (per-group transactions).
- If the newer build already created typed items (antibodies etc.) BEFORE you roll back:
  those rows exist as extended fields inside the JSON document rows, which the old build
  parses as legacy chemicals (extra fields are preserved as-is by the legacy zod tolerance)
  — usable, but the typed experience disappears with the old build. Data is not lost.

### Soak gate before the flip-read review (Phase C)

Watch the journal for **1–2 weeks**:

```bash
ssh proxmox1 'journalctl -u bioscom --since "24 hours ago" | grep -E "inventory-(backfill|sync|parity)"'
```

Expected: only `[inventory-backfill]` lines with `anomalies: 0` (or silence). The
**flip-read** (making the relational core the read driver; assemble-to-document path
already exists and is parity-checked at boot) is scheduled in a **separately reviewed
rear-guard step** after clean soak + this checklist passes, not from this deployment.

Execution log (fill during rollout):

- [ ] pre-refactor DB snapshot taken (path + sha256)
- [ ] deploy.sh completed, unit restarted
- [ ] first-boot journal: no `[inventory-parity]`, backfill anomalies: 0
- [ ] parity probe `{ok: true}` per lab in browser session
- [ ] legacy chem edit OK; one typed item created; Catalog renders it
- [ ] next-boot journal: anomalies: 0, no parity alarm
- [ ] 1–2 week soak journal clean (flip-read review date: ____)

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
