#!/usr/bin/env bash
set -euo pipefail
cd /home/ubuntu/.openclaw/workspace
nohup npm run dev >/tmp/wallet-dashboard.log 2>&1 &
echo "Wallet dashboard starting. Open http://localhost:4173/"
