#!/usr/bin/env bash
# Idempotent: installs the systemd unit and the nginx site for lab.ubch.sci.muni.cz,
# then lets certbot --nginx add TLS + the 80 -> 443 redirect (same as thermool/primerool).
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then
  echo "run with sudo on proxmox1: sudo /home/kowalski/BioSCom/deploy/enable-on-vm.sh"
  exit 1
fi
cd /home/kowalski/BioSCom

DOMAIN=lab.ubch.sci.muni.cz
SITE=/etc/nginx/sites-available/$DOMAIN
CERT_DIR=/etc/letsencrypt/live/$DOMAIN

# Kill any leftover trial process (deploy/trial-start.sh) that is not the systemd one.
mainpid="$(systemctl show -p MainPID --value bioscom 2>/dev/null || true)"
mainpid="${mainpid:-0}"
for pid in $(pgrep -u kowalski -f "server/dist/index.js" || true); do
  if [ "$pid" != "$mainpid" ]; then
    kill "$pid" 2>/dev/null || true
  fi
done
rm -f /tmp/bioscom-trial.pid

cp deploy/bioscom.service /etc/systemd/system/bioscom.service
systemctl daemon-reload
systemctl enable bioscom >/dev/null 2>&1

# Retire the old IP/bioscom.ubch bootstrap site.
rm -f /etc/nginx/sites-enabled/bioscom /etc/nginx/sites-available/bioscom

if ! getent hosts "$DOMAIN" >/dev/null; then
  echo "DNS for $DOMAIN is not live yet; rerun once the record exists"
  exit 1
fi

# Only install the template before certbot has managed the file; afterwards
# the installed copy holds certbot's TLS lines and must not be overwritten.
if [ ! -d "$CERT_DIR" ]; then
  cp deploy/nginx-$DOMAIN.conf "$SITE"
fi
ln -sf "$SITE" /etc/nginx/sites-enabled/$DOMAIN
nginx -t
systemctl reload nginx

if [ ! -d "$CERT_DIR" ]; then
  certbot --nginx -d "$DOMAIN" --redirect
fi

systemctl restart bioscom
sleep 2
curl -fsS "https://$DOMAIN/api/health"
echo
systemctl is-active bioscom
