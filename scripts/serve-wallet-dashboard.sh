#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu/.openclaw/workspace
npm run build >/tmp/wallet-dashboard-build.log 2>&1
nohup python3 -m http.server 4173 --directory dist >/tmp/wallet-dashboard.log 2>&1 &
echo "Wallet dashboard built and serving at http://localhost:4173/"
