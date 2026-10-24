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
nginx="$base/nginx-bioscom.conf"
bootstrap="$base/nginx-bioscom-bootstrap.conf"
script="$base/deploy.sh"
enabler="$base/enable-on-vm.sh"

for f in "$unit" "$nginx" "$bootstrap" "$script" "$enabler"; do
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

need "$nginx" '^(\s*)server_name bioscom\.ubch\.sci\.muni\.cz 147\.251\.22\.180;' 'nginx server_name (dns + ip)'
need "$nginx" 'listen 443 ssl;' 'nginx TLS listener'
need "$nginx" 'ssl_certificate /etc/letsencrypt/live/bioscom\.ubch\.sci\.muni\.cz/fullchain\.pem;' 'nginx ssl_certificate'
need "$nginx" 'ssl_certificate_key /etc/letsencrypt/live/bioscom\.ubch\.sci\.muni\.cz/privkey\.pem;' 'nginx ssl_certificate_key'
need "$nginx" 'proxy_pass http://127\.0\.0\.1:8004;' 'nginx proxy_pass to app port'
need "$nginx" 'proxy_http_version 1\.1;' 'nginx proxy_http_version 1.1'
need "$nginx" 'proxy_set_header Upgrade \$http_upgrade;' 'nginx WS Upgrade header'
need "$nginx" 'proxy_set_header Connection "upgrade";' 'nginx WS Connection header'
need "$nginx" 'proxy_read_timeout 300s;' 'nginx WS read timeout'
need "$nginx" 'return 301 https://bioscom\.ubch\.sci\.muni\.cz\$request_uri;' 'nginx http->https redirect'
need "$nginx" 'location \^~ /\.well-known/acme-challenge/' 'nginx acme-challenge location'

need "$bootstrap" 'listen 80;' 'bootstrap port-80 listener'
need "$bootstrap" 'server_name bioscom\.ubch\.sci\.muni\.cz 147\.251\.22\.180;' 'bootstrap server_name (dns + ip)'
need "$bootstrap" 'proxy_pass http://127\.0\.0\.1:8004;' 'bootstrap proxy_pass'
need "$bootstrap" 'location \^~ /\.well-known/acme-challenge/' 'bootstrap acme-challenge location'
if grep -qE 'listen 443|ssl_certificate' "$bootstrap"; then
  echo "FAIL: bootstrap conf must not reference TLS (certs do not exist yet)"
  fail=1
else
  echo "ok: bootstrap conf is HTTP-only"
fi

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
