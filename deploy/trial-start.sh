#!/usr/bin/env bash
set -euo pipefail
cd /home/kowalski/BioSCom

pkill -f "server/dist/index.js" 2>/dev/null || true
for _ in $(seq 1 20); do
  ss -tln | grep -q ":8004 " || break
  sleep 0.25
done

set -a
. ./.env
set +a
HOST=0.0.0.0 PUBLIC_URL=http://147.251.22.180:8004 EMAIL_CAPTURE_FILE="$HOME/bioscom-trial-emails.jsonl" \
  nohup node server/dist/index.js > /tmp/bioscom-trial.log 2>&1 &

sleep 2
pgrep -f "server/dist/index.js" > /tmp/bioscom-trial.pid
echo "trial pid: $(cat /tmp/bioscom-trial.pid)"
ss -tln | grep "0.0.0.0:8004"
curl -s http://127.0.0.1:8004/api/health
echo
