#!/usr/bin/env bash
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then
  echo "run with sudo on proxmox1: sudo /home/kowalski/BioSCom/deploy/enable-on-vm.sh"
  exit 1
fi
cd /home/kowalski/BioSCom

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

CERT_DIR=/etc/letsencrypt/live/bioscom.ubch.sci.muni.cz
if [ ! -d "$CERT_DIR" ]; then
  cp deploy/nginx-bioscom-bootstrap.conf /etc/nginx/sites-available/bioscom
  if [ ! -L /etc/nginx/sites-enabled/bioscom ]; then
    ln -s /etc/nginx/sites-available/bioscom /etc/nginx/sites-enabled/bioscom
  fi
  nginx -t
  systemctl reload nginx
  if ! getent hosts bioscom.ubch.sci.muni.cz >/dev/null; then
    systemctl restart bioscom
    echo "DNS for bioscom.ubch.sci.muni.cz is not live yet"
    echo "bootstrap site active: http://147.251.22.180 (rerun after the DNS record exists)"
    systemctl is-active bioscom
    exit 0
  fi
  certbot certonly --webroot -w /var/www/html -d bioscom.ubch.sci.muni.cz
fi

cp deploy/nginx-bioscom.conf /etc/nginx/sites-available/bioscom
if [ ! -L /etc/nginx/sites-enabled/bioscom ]; then
  ln -s /etc/nginx/sites-available/bioscom /etc/nginx/sites-enabled/bioscom
fi
nginx -t
systemctl reload nginx
systemctl restart bioscom
echo "final TLS site active"
curl -fsS https://bioscom.ubch.sci.muni.cz/api/health
echo
systemctl is-active bioscom
