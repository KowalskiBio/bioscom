#!/usr/bin/env bash
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then
  echo "run with sudo on proxmox1: sudo /home/kowalski/BioSCom/deploy/enable-on-vm.sh"
  exit 1
fi
cd /home/kowalski/BioSCom

if [ -f /tmp/bioscom-trial.pid ]; then
  kill "$(cat /tmp/bioscom-trial.pid)" 2>/dev/null || true
  rm -f /tmp/bioscom-trial.pid
  echo "stopped direct-IP trial instance"
fi

if ! systemctl cat bioscom >/dev/null 2>&1 || ! systemctl is-active bioscom >/dev/null 2>&1; then
  cp deploy/bioscom.service /etc/systemd/system/bioscom.service
  systemctl daemon-reload
  systemctl enable --now bioscom
  echo "bioscom.service installed and started"
else
  echo "bioscom.service already active"
fi

if [ ! -L /etc/nginx/sites-enabled/bioscom ]; then
  cp deploy/nginx-bioscom-bootstrap.conf /etc/nginx/sites-available/bioscom
  ln -s /etc/nginx/sites-available/bioscom /etc/nginx/sites-enabled/bioscom
  echo "nginx bootstrap site installed"
else
  echo "nginx site already installed"
fi

nginx -t
systemctl reload nginx

CERT_DIR=/etc/letsencrypt/live/bioscom.ubch.sci.muni.cz
if [ ! -d "$CERT_DIR" ]; then
  if ! getent hosts bioscom.ubch.sci.muni.cz >/dev/null; then
    echo "DNS for bioscom.ubch.sci.muni.cz is not live yet"
    echo "bootstrap site is active (HTTP only); rerun this script after the DNS record exists"
    exit 0
  fi
  certbot certonly --webroot -w /var/www/html -d bioscom.ubch.sci.muni.cz
fi

cp deploy/nginx-bioscom.conf /etc/nginx/sites-available/bioscom
nginx -t
systemctl reload nginx
echo "final TLS site active"
curl -fsS https://bioscom.ubch.sci.muni.cz/api/health
echo
systemctl is-active bioscom
