#!/usr/bin/env bash
set -uo pipefail
base="$(cd "$(dirname "$0")" && pwd)"
fail=0

need() {
  local file="$1" pattern="$2" label="$3"
  if grep -qE "$pattern" "$file"; then
    echo "ok: $label ($file)"
  else
    echo "FAIL: $label missing in $file"
    fail=1
  fi
}

unit="$base/bioscom.service"
nginx="$base/nginx-lab.ubch.sci.muni.cz.conf"
script="$base/deploy.sh"
enabler="$base/enable-on-vm.sh"

for f in "$unit" "$nginx" "$script" "$enabler"; do
  if [ ! -f "$f" ]; then
    echo "FAIL: $f not found"
    exit 1
  fi
done

need "$unit" '^User=kowalski$' 'systemd User=kowalski'
need "$unit" '^EnvironmentFile=/home/kowalski/BioSCom/.env$' 'systemd EnvironmentFile'
need "$unit" '^WorkingDirectory=/home/kowalski/BioSCom$' 'systemd WorkingDirectory'
need "$unit" '^ExecStart=/usr/bin/node server/dist/index.js$' 'systemd ExecStart (absolute node path)'
need "$unit" '^Restart=always$' 'systemd Restart=always'
need "$unit" '^WantedBy=multi-user.target$' 'systemd WantedBy'
if grep -qE '^[A-Z_]*(SECRET|KEY|PASSWORD)[A-Z_]*=' "$unit"; then
  echo "FAIL: inline secret in $unit (EnvironmentFile only)"
  fail=1
else
  echo "ok: no inline secrets in unit"
fi

need "$nginx" '^\s*server_name lab\.ubch\.sci\.muni\.cz;' 'nginx server_name'
need "$nginx" 'listen 80;' 'nginx port-80 listener (certbot --nginx adds 443)'
need "$nginx" 'proxy_pass http://127\.0\.0\.1:8004;' 'nginx proxy_pass to app port'
need "$nginx" 'proxy_http_version 1\.1;' 'nginx proxy_http_version 1.1'
need "$nginx" 'proxy_set_header X-Forwarded-Proto \$scheme;' 'nginx X-Forwarded-Proto header'
need "$nginx" 'proxy_set_header Upgrade +\$http_upgrade;' 'nginx WS Upgrade header'
need "$nginx" 'proxy_set_header Connection +"upgrade";' 'nginx WS Connection header'
need "$nginx" 'proxy_read_timeout 300s;' 'nginx WS read timeout'
if grep -qE '^\s*(listen [^;]*443|ssl_certificate)' "$nginx"; then
  echo "FAIL: nginx template must not reference TLS (certbot --nginx adds it on the VM)"
  fail=1
else
  echo "ok: nginx template is pre-certbot (HTTP-only)"
fi
need "$enabler" '^DOMAIN=lab\.ubch\.sci\.muni\.cz$' 'enabler DOMAIN'
need "$enabler" 'certbot --nginx -d "\$DOMAIN" --redirect' 'enabler certbot --nginx'

if bash -n "$script" && bash -n "$enabler"; then
  echo "ok: deploy.sh + enable-on-vm.sh parse (bash -n)"
else
  echo "FAIL: deploy script does not parse"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "PASS: all deploy artifact checks green"
else
  echo "SUMMARY: deploy artifact validation FAILED"
fi
exit "$fail"
