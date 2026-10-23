#!/usr/bin/env bash
set -euo pipefail
cd /home/kowalski/BioSCom
git pull --ff-only
npm ci
npm run build -ws
sudo systemctl restart bioscom
